-- ============================================================
-- StockFlow — 0009_rls_privileges.sql
-- TOUTE la posture de sécurité, en un seul fichier relisible d'un bloc.
-- ============================================================
--
-- Ce fichier répond seul à la question « qui peut faire quoi ». Il vient en
-- DERNIER : la base reste fermée (aucun GRANT à authenticated) pendant toute
-- l'installation du schéma.
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
-- 2. Activation de la RLS. Une table sans RLS activée est ouverte à tout
--    détenteur d'un GRANT : l'oubli ne produit aucune erreur.
-- ------------------------------------------------------------
alter table profils          enable row level security;
alter table invitations      enable row level security;
alter table produits         enable row level security;
alter table restocks         enable row level security;
alter table restock_lignes   enable row level security;
alter table ventes           enable row level security;
alter table vente_lignes     enable row level security;
alter table mouvements_stock enable row level security;
alter table demandes_restock enable row level security;
alter table demande_lignes   enable row level security;
alter table versements       enable row level security;

-- ------------------------------------------------------------
-- 3. Policies
-- ------------------------------------------------------------

-- profils : chacun lit la sienne, l'admin lit et écrit tout.
drop policy if exists profils_select    on profils;
drop policy if exists profils_admin_all on profils;
create policy profils_select on profils for select
  using (id = auth.uid() or est_admin());
create policy profils_admin_all on profils for all
  using (est_admin()) with check (est_admin());

-- invitations : admin uniquement (elles portent les conditions commerciales).
drop policy if exists invitations_admin_all on invitations;
create policy invitations_admin_all on invitations for all
  using (est_admin()) with check (est_admin());

-- produits : lecture par tout compte actif, écriture admin.
drop policy if exists produits_select    on produits;
drop policy if exists produits_admin_all on produits;
create policy produits_select on produits for select using (est_actif());
create policy produits_admin_all on produits for all
  using (est_admin()) with check (est_admin());

-- restocks : admin STRICTEMENT. Ces tables portent les prix d'achat ; un
-- vendeur qui les lirait déduirait la marge de la maison.
drop policy if exists restocks_admin_all       on restocks;
drop policy if exists restock_lignes_admin_all on restock_lignes;
create policy restocks_admin_all on restocks for all
  using (est_admin()) with check (est_admin());
create policy restock_lignes_admin_all on restock_lignes for all
  using (est_admin()) with check (est_admin());

-- ventes : un vendeur ne voit que les siennes.
drop policy if exists ventes_select on ventes;
create policy ventes_select on ventes for select
  using (vendeur_id = auth.uid() or est_admin());

-- vente_lignes : admin SEULEMENT — la colonne cout_unitaire est la marge.
-- Les vendeurs passent par la vue v_lignes_vente, qui n'expose pas le coût.
drop policy if exists vente_lignes_admin_all on vente_lignes;
create policy vente_lignes_admin_all on vente_lignes for all
  using (est_admin()) with check (est_admin());

-- mouvements_stock : un vendeur ne voit QUE son propre stock.
-- Les lignes d'entrepôt (detenteur_id IS NULL) sont exclues gratuitement :
-- « NULL = auth.uid() » vaut NULL, jamais vrai. L'isolation vient de la
-- logique à trois valeurs, pas d'une condition à maintenir.
drop policy if exists mvt_select    on mouvements_stock;
drop policy if exists mvt_admin_all on mouvements_stock;
create policy mvt_select on mouvements_stock for select
  using (detenteur_id = auth.uid() or est_admin());
create policy mvt_admin_all on mouvements_stock for all
  using (est_admin()) with check (est_admin());

-- demandes de restock : le vendeur lit les siennes, l'admin tout.
-- L'ÉCRITURE passe exclusivement par les RPC (INSERT/UPDATE révoqués plus
-- bas) : c'est ce qui rend « pas de modification après envoi » tenable.
drop policy if exists demandes_select    on demandes_restock;
drop policy if exists demandes_admin_all on demandes_restock;
create policy demandes_select on demandes_restock for select
  using (vendeur_id = auth.uid() or est_admin());
create policy demandes_admin_all on demandes_restock for all
  using (est_admin()) with check (est_admin());

drop policy if exists demande_lignes_select    on demande_lignes;
drop policy if exists demande_lignes_admin_all on demande_lignes;
create policy demande_lignes_select on demande_lignes for select
  using (exists (
    select 1 from demandes_restock d
     where d.id = demande_lignes.demande_id
       and (d.vendeur_id = auth.uid() or est_admin())
  ));
create policy demande_lignes_admin_all on demande_lignes for all
  using (est_admin()) with check (est_admin());

-- versements : le vendeur voit ce qu'il a reversé, l'admin tout.
drop policy if exists versements_select    on versements;
drop policy if exists versements_admin_all on versements;
create policy versements_select on versements for select
  using (vendeur_id = auth.uid() or est_admin());
create policy versements_admin_all on versements for all
  using (est_admin()) with check (est_admin());

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
-- Rappel : 0001 a retiré le EXECUTE par défaut au rôle PUBLIC. Une fonction
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
