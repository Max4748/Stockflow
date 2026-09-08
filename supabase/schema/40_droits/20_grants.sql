-- ============================================================
-- StockFlow — Droits : grants et revokes
-- ============================================================
-- APPLIQUÉ APRÈS TOUTES LES TABLES, et c'est ce qui corrige un défaut des
-- migrations numérotées : leur `revoke all on all tables in schema public from
-- anon` ne couvrait que les tables existant à cet instant. Les cinq tables
-- créées par des migrations postérieures — sav, ventes_annulees, journal_admin,
-- journal_operations, ip_bloquees — gardaient donc `select` pour `anon`
-- jusqu'à la deuxième application du schéma.
--
-- Sept `grant` ont été retirés au passage : ils visaient des signatures
-- remplacées depuis — ventes_savables(int), dossiers_sav(int),
-- marquer_sav_vu(), marquer_sav_gestion_vu(). Les signatures réelles
-- (int, boolean) et (timestamptz) ont les leurs, plus bas.

-- Deuxième barrière contre le détournement par table temporaire. Combinée au
-- `set search_path = public, pg_temp` de chaque fonction, elle empêche qu'un
-- rôle crée une fausse table `profils` dans pg_temp pour tromper est_admin().
revoke temporary on database postgres from public;

-- ============================================================
-- Le SOCLE de la posture de sécurité : le modèle de menace et les règles
-- qui valent pour tout le schéma existant à ce point.
-- ============================================================
--
-- CE FICHIER EST LE SEUL, ET IL FAUT QUE ÇA LE RESTE.
--
-- Du temps des migrations numérotées, la réponse à « qui peut faire quoi »
-- était dispersée : dix-huit fichiers posaient des `grant`, des
-- `create policy` ou un `enable row level security`, chacun pour la table
-- qu'il venait d'ajouter. L'en-tête du premier affirmait pourtant porter tout
-- le sujet, ce qui était faux et faisait manquer la moitié du sujet à qui le
-- croyait.
--
-- Ici, tous les `grant` et `revoke` du schéma sont réunis, et le
-- `enable row level security` reste avec sa table en couche 10. La règle :
--
--   TOUTE TABLE POSE SA RLS AVEC ELLE, ET SES POLICIES DANS
--   `40_droits/10_policies.sql`. Une table laissée sans RLS serait ouverte à
--   tout détenteur d'un GRANT, sans qu'aucune erreur ne le signale.
--
-- Le filet qui rattrape l'oubli est l'inventaire de `appliquer-schema.sh`,
-- ligne « tables SANS RLS (doit valoir 0) », l'assertion équivalente du
-- harnais de rejeu, et l'empreinte de schéma, qui compare les droits eux-mêmes.
--
-- MODÈLE DE MENACE — la clé anon est publique par construction. Un vendeur
-- authentifié peut donc attaquer PostgREST directement (curl, console
-- navigateur), sans passer par l'interface. Trois conséquences :
--   1. l'UI n'est JAMAIS une barrière de sécurité, seulement du confort ;
--   2. la RLS de vente_lignes, restocks et mouvements_stock fait partie du
--      modèle de menace, pas du décor : la désactiver « pour déboguer »
--      publierait la marge de l'entreprise ;
--   3. le coût d'achat ne doit être atteignable par AUCUN chemin — d'où le
--      REVOKE sur cout_moyen_pondere() et sur les vues de stock.

-- ------------------------------------------------------------
-- 1. Socle : anon n'a rien, jamais.
-- ------------------------------------------------------------
grant usage on schema public to authenticated, anon;

revoke all on all tables in schema public from anon;

-- ------------------------------------------------------------
-- 4. Privilèges de table.
--
-- Les tables COMPTABLES sont en lecture seule pour tout le monde : toute
-- écriture passe par une RPC qui prend le verrou de stock et fige les valeurs.
-- C'est ce REVOKE, pas la RLS, qui garantit qu'aucune vente ne peut naître
-- sans contrôle de stock.
-- ------------------------------------------------------------
grant select on profils, produits, ventes, vente_lignes, mouvements_stock,
                demandes_restock, demande_lignes, versements,
                restocks, restock_lignes
  to authenticated;

-- Tables de paramétrage : écriture directe par l'admin (la RLS filtre).
grant insert, update, delete on produits    to authenticated;
grant insert, update, delete on modeles     to authenticated;

grant insert, update, delete on invitations to authenticated;

grant select                 on invitations to authenticated;

grant update                 on profils     to authenticated;

grant insert, delete         on profils     to authenticated;

-- Tables comptables : AUCUNE écriture directe, jamais.
revoke insert, update, delete on ventes           from authenticated, anon;

revoke insert, update, delete on vente_lignes     from authenticated, anon;

revoke insert, update, delete on mouvements_stock from authenticated, anon;

revoke insert, update, delete on restocks         from authenticated, anon;

revoke insert, update, delete on restock_lignes   from authenticated, anon;

revoke insert, update, delete on demandes_restock from authenticated, anon;

revoke insert, update, delete on demande_lignes   from authenticated, anon;

revoke insert, update, delete on versements       from authenticated, anon;

-- ------------------------------------------------------------
-- 5. Vues.
--
-- Les vues d'agrégat ignorent la notion d'appelant : fermées, l'accès passe
-- par une fonction qui vérifie est_actif()/est_admin() DANS SON CORPS.
-- Sans ce REVOKE, un vendeur lirait le stock de ses collègues (et, via
-- v_comptes_vendeurs, leurs revenus) d'un simple GET sur PostgREST.
-- ------------------------------------------------------------
revoke all on v_stock_detenteur   from authenticated, anon;

revoke all on v_stock_produit     from authenticated, anon;

revoke all on v_comptes_vendeurs  from authenticated, anon;

-- v_lignes_vente est la SEULE vue ouverte : elle filtre sur auth.uid() dans
-- sa définition et n'expose aucun coût.
grant select on v_lignes_vente to authenticated;

-- ------------------------------------------------------------
-- 6. Fonctions.
--
-- Rappel : le prélude a retiré le EXECUTE par défaut au rôle PUBLIC. Une fonction
-- non listée ici n'est appelable par personne — c'est le comportement voulu
-- pour les rouages internes.
-- ------------------------------------------------------------

-- Helpers : indispensables à authenticated, car une policy est évaluée avec
-- les privilèges du rôle qui interroge, pas ceux du propriétaire.
grant execute on function est_admin()          to authenticated;

grant execute on function est_actif()          to authenticated;

grant execute on function marquer_mdp_change() to authenticated;

-- Écritures
grant execute on function creer_restock_fournisseur(jsonb, numeric, numeric, text, date) to authenticated;

grant execute on function enregistrer_vente(jsonb, text, date, uuid)      to authenticated;

grant execute on function retourner_stock(uuid, jsonb, text, date)        to authenticated;

grant execute on function ajuster_stock(uuid, integer, text, uuid)        to authenticated;

grant execute on function supprimer_vente(uuid)                           to authenticated;

-- Demandes de restock
grant execute on function creer_demande_restock(jsonb, text)                        to authenticated;

grant execute on function annuler_demande_restock(uuid)                             to authenticated;

grant execute on function traiter_demande_restock(uuid, text, jsonb, text)          to authenticated;

-- Dette / versements
grant execute on function ma_dette()                                                to authenticated;

grant execute on function creances()                                                to authenticated;

grant execute on function enregistrer_versement(uuid, numeric, date, text, boolean) to authenticated;

grant execute on function supprimer_versement(uuid)                                 to authenticated;

-- Lectures
grant execute on function stock_disponible()                to authenticated;

grant execute on function stock_entrepot()                  to authenticated;

grant execute on function stock_valorise()                  to authenticated;

grant execute on function stock_detenteurs(uuid)            to authenticated;

grant execute on function bilan_global(date, date)           to authenticated;

grant execute on function revenus_vendeurs(date, date)       to authenticated;

grant execute on function journal_transactions(date, date, text, uuid, int, int) to authenticated;

grant execute on function mon_journal(int)                   to authenticated;

grant execute on function verifier_coherence_stock()         to authenticated;

-- ------------------------------------------------------------
-- 7. Les interdits explicites.
--
-- cout_moyen_pondere() DONNE le prix d'achat. Aucun rôle applicatif ne doit
-- pouvoir l'appeler : les fonctions admin qui en ont besoin sont en SECURITY
-- DEFINER et l'appellent avec les privilèges de leur propriétaire.
-- ------------------------------------------------------------
revoke execute on function cout_moyen_pondere(uuid)        from authenticated, anon, public;

revoke execute on function stock_detenu(uuid, uuid)        from authenticated, anon, public;

revoke execute on function verrouiller_stock(uuid, uuid)   from authenticated, anon, public;

revoke execute on function gerer_nouvel_utilisateur()      from authenticated, anon, public;

-- ============================================================
-- Gestion des comptes : ferme l'escalade de privilèges.
-- ============================================================
--
-- CE QUE CE FICHIER CORRIGE, vérifié en conditions réelles avant écriture :
-- La couche 40 accorde `grant update on profils to authenticated` et la policy
-- `profils_admin_all` est `for all`. Rien ne protégeait la colonne `role`, donc
-- un simple PATCH sur PostgREST suffisait à promouvoir n'importe qui :
--
--   PATCH /rest/v1/profils?id=eq.<un-vendeur>  {"role":"admin"}  ->  RÉUSSI
--
-- C'était inoffensif tant qu'`admin` était le sommet : un admin qui nomme un
-- admin reste dans ses prérogatives. Avec le niveau `dev` au-dessus, cela
-- devient une escalade — un gérant se ferait `dev` en une requête. Même faille
-- sur `invitations`, dont la colonne `role` était librement insérable.
--
-- Le correctif applique le principe déjà en place pour les ventes : la
-- barrière est le REVOKE, pas l'interface.

revoke insert, update, delete on profils     from authenticated, anon;

revoke insert, update, delete on invitations from authenticated, anon;

grant select on roles to authenticated;

revoke insert, update, delete on roles from authenticated, anon;

grant execute on function est_dev()                                        to authenticated;

grant execute on function niveau_courant()                                 to authenticated;

grant execute on function inviter_utilisateur(text, text, text, numeric)   to authenticated;

grant execute on function modifier_compte(uuid, text, numeric)             to authenticated;

grant execute on function changer_actif(uuid, boolean)                     to authenticated;

grant execute on function changer_role(uuid, text)                         to authenticated;

grant execute on function exiger_changement_mdp(uuid)                      to authenticated;

grant execute on function comptes_encadrement()                            to authenticated;

-- Rouages internes : appelés uniquement depuis les fonctions ci-dessus, qui
-- sont en SECURITY DEFINER et s'exécutent donc avec les droits du propriétaire.
revoke execute on function niveau_de(text)          from authenticated, anon, public;

revoke execute on function exiger_gestion_de(text)  from authenticated, anon, public;

grant execute on function fenetre_correction() to authenticated;

revoke execute on function droit_correction(uuid) from authenticated, anon, public;

grant execute on function modifier_vente(uuid, jsonb, text, date) to authenticated;

grant execute on function mes_ventes(int) to authenticated;

grant execute on function transferer_stock(uuid, jsonb, text) to authenticated;

grant execute on function creances() to authenticated;

grant execute on function revenus_vendeurs(date, date) to authenticated;

grant select on sav to authenticated;

revoke insert, update, delete on sav from authenticated, anon;

grant execute on function declarer_sav(uuid, uuid, integer, text, text, numeric, uuid, boolean)
  to authenticated;

grant execute on function supprimer_sav(uuid) to authenticated;

revoke all on v_comptes_vendeurs from authenticated, anon;

grant execute on function ma_dette() to authenticated;

grant execute on function bilan_global(date, date) to authenticated;

grant execute on function revenus_vendeurs(date, date) to authenticated;

grant execute on function creances() to authenticated;

grant execute on function journal_transactions(date, date, text, uuid, int, int)
  to authenticated;

grant execute on function mes_ventes(int) to authenticated;

grant execute on function ventes_vendeur(uuid, int) to authenticated;


grant execute on function declarer_sav(uuid, uuid, integer, text, text, numeric, uuid, boolean)
  to authenticated;

grant execute on function valider_sav(uuid) to authenticated;

grant execute on function refuser_sav(uuid, text) to authenticated;

grant execute on function annuler_sav(uuid) to authenticated;

revoke all on v_comptes_vendeurs from authenticated, anon;

grant execute on function bilan_global(date, date) to authenticated;

grant execute on function revenus_vendeurs(date, date) to authenticated;

grant execute on function journal_transactions(date, date, text, uuid, int, int)
  to authenticated;

grant execute on function mes_ventes(int) to authenticated;

grant execute on function ventes_vendeur(uuid, int) to authenticated;




grant execute on function sav_non_vus() to authenticated;



grant execute on function totaux_stock() to authenticated;

grant execute on function dossiers_sav(int, boolean) to authenticated;

grant execute on function ventes_savables(int, boolean) to authenticated;


grant execute on function sav_gestion_non_vus() to authenticated;

grant execute on function revoquer_sav(uuid, text) to authenticated;

grant execute on function marquer_sav_vu(timestamptz) to authenticated;

grant execute on function marquer_sav_gestion_vu(timestamptz) to authenticated;

grant execute on function retirer_produit(uuid) to authenticated;

grant execute on function annuler_invitation(text) to authenticated;

grant execute on function retirer_compte(uuid) to authenticated;

grant execute on function source_stock(uuid) to authenticated;

grant execute on function changer_stock_lie(uuid, boolean) to authenticated;

grant execute on function comptes_encadrement() to authenticated;

grant execute on function supprimer_restock(uuid) to authenticated;

grant execute on function modifier_restock(uuid, jsonb, numeric, numeric, text, date)
  to authenticated;

grant select on ventes_annulees to authenticated;

revoke insert, update, delete on ventes_annulees from authenticated, anon;

grant execute on function mes_ventes(int) to authenticated;

grant execute on function ventes_vendeur(uuid, int) to authenticated;

grant execute on function mon_journal(int) to authenticated;

grant select on journal_admin to authenticated;

revoke insert, update, delete on journal_admin from authenticated, anon;

-- Pas de `grant execute` à authenticated : la fonction n'est appelée que par
-- d'autres fonctions `security definer`, qui s'exécutent avec les droits du
-- propriétaire. L'exposer permettrait de forger une trace.
revoke execute on function tracer_admin(text, uuid, jsonb, jsonb) from public, authenticated, anon;

grant execute on function journal_admin(date, date, int, int) to authenticated;

grant select on ip_bloquees to authenticated;

revoke insert, update, delete on ip_bloquees from authenticated, anon;

grant execute on function ip_est_bloquee(text) to authenticated, anon;

grant execute on function bloquer_ip(text, text) to authenticated, anon;

grant execute on function bloquer_ip_definitivement(text, text) to authenticated;

grant execute on function lever_blocage_ip(text) to authenticated;

grant execute on function ip_bloquees_actives() to authenticated;

-- ============================================================
-- Poser un blocage d'IP redevient une opération du serveur seul.
-- ============================================================
-- CORRECTIF D'UNE FAILLE, CONSERVÉ ICI POUR CE QU'IL EXPLIQUE.
--
-- `bloquer_ip(p_ip, p_motif)` a été accordée à `anon` ET `authenticated`,
-- sans aucune garde de rôle dans son corps. Or l'adresse bloquée est le
-- PARAMÈTRE `p_ip`, entièrement choisi par l'appelant : rien dans la fonction
-- ne le rapproche de l'adresse d'où vient l'appel.
--
-- Un commentaire affirmait alors « le pire qu'un appelant puisse en tirer est
-- de se bloquer lui-même ». C'était FAUX, et c'est la raison pour laquelle la
-- garde manquait. Ce que la faille permettait réellement :
--
--   1. La clé anon est publique par construction (voir la couche 40). N'importe qui la
--      détenant pouvait donc bloquer n'importe quelle adresse IP, sans compte
--      ni session.
--   2. `recidive` s'incrémente à CHAQUE appel. Quatre appels suffisaient à
--      porter la durée à sept jours, et il suffisait de recommencer ensuite.
--   3. `ip_est_bloquee` est consultée AVANT `signInWithPassword` : une adresse
--      bloquée ne peut plus ouvrir de session du tout.
--   4. `lever_blocage_ip` exige `est_dev()`, donc une session. Bloquer l'IP du
--      dev le mettait dehors SANS RECOURS depuis l'application : plus personne
--      pour lever le blocage. Le seul retour passait par un accès SSH.
--
-- Le déni de service visait donc l'exploitation entière, pas seulement
-- l'attaquant.
--
-- LE CORRECTIF : la fonction n'est plus appelable que par `service_role`, dont
-- la clé ne quitte jamais le serveur applicatif. Le corps ne change pas, et le
-- flux légitime non plus : c'est la Server Action de connexion qui l'appelle,
-- désormais avec le client à privilèges.
--
-- `service_role` reçoit son droit EXPLICITEMENT plutôt que de compter sur les
-- privilèges par défaut de l'instance : le rejeu ne doit pas dépendre d'un
-- réglage extérieur au dépôt.
-- ------------------------------------------------------------

revoke execute on function bloquer_ip(text, text) from public, anon, authenticated;

grant  execute on function bloquer_ip(text, text) to service_role;

grant select on journal_operations to authenticated;

revoke insert, update, delete on journal_operations from authenticated, anon;

revoke execute on function tracer_operation(text, uuid, text, text, int, numeric, jsonb)
  from public, authenticated, anon;

grant execute on function reinitialiser_donnees(text) to authenticated;

-- ------------------------------------------------------------
-- Prélèvements personnels.
--
-- Lecture par la RLS, écriture par les fonctions seules : une ligne de
-- `prelevements` pèse sur une dette, un INSERT direct la falsifierait.
-- ------------------------------------------------------------
grant select on prelevements  to authenticated;
grant select on prix_preleves to authenticated;

revoke insert, update, delete on prelevements  from authenticated, anon;
revoke insert, update, delete on prix_preleves from authenticated, anon;

grant execute on function prix_preleve(uuid, uuid)                        to authenticated;
grant execute on function definir_prix_preleve(uuid, uuid, numeric)       to authenticated;
grant execute on function enregistrer_prelevement(uuid, integer, uuid)    to authenticated;
grant execute on function supprimer_prelevement(uuid)                     to authenticated;
grant execute on function mes_prelevements(integer)                       to authenticated;
grant execute on function prelevements_vendeur(uuid, integer)             to authenticated;
grant execute on function tarifs_preleves(uuid)                           to authenticated;

-- Le lien d'invitation, pour le transmettre hors courriel. Gardée par
-- `est_admin()` + `exiger_gestion_de()` dans son corps.
grant execute on function lien_invitation(uuid) to authenticated;

-- Catalogue à deux niveaux : le modèle porte le prix et les seuils, le parfum
-- reste l'unité de stock.
grant select on modeles to authenticated;

grant execute on function retirer_modele(uuid) to authenticated;
