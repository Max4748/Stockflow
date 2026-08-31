-- ============================================================
-- StockFlow — Amorçage
-- ============================================================

insert into roles (cle, libelle, niveau) values
  ('dev',     'Développeur', 3),
  ('gerant',  'Gérant',      2),
  ('vendeur', 'Vendeur',     1)
on conflict (cle) do update set libelle = excluded.libelle,
                                niveau  = excluded.niveau;

-- ============================================================
-- Amorçage minimal.
-- ============================================================

-- ------------------------------------------------------------
-- Invitation du compte `dev` — le sommet de la hiérarchie.
--
-- C'est la SEULE façon d'obtenir un `dev` : aucun compte n'est créé en dur,
-- aucun mot de passe ne figure dans ce dépôt. Le trigger d'inscription lit cette
-- invitation à la première connexion et active le profil avec le rôle `dev`.
--
-- Un `dev` ne peut PAS être créé depuis l'application (la règle est « on ne
-- gère qu'un niveau strictement inférieur au sien », voir `exiger_gestion_de`) : c'est
-- volontaire, et cette invitation est donc le seul point d'entrée.
--
-- ⚠️ REMPLACER L'EMAIL avant d'exécuter, puis créer l'utilisateur dans Studio
-- (Authentication → Add user, avec « Auto Confirm User »). Sans invitation
-- correspondante, le profil serait créé actif=false et personne ne pourrait
-- l'activer — impasse volontaire.
-- ------------------------------------------------------------
--
-- `where not exists` : ce fichier est REJOUÉ à chaque déploiement. Sans cette
-- condition, l'invitation d'amorçage renaissait après chaque exécution, y
-- compris sur une base où un dev existe depuis longtemps — elle s'affichait
-- alors en « invitation sans compte associé » sur l'écran Vendeurs, et la
-- supprimer ne servait à rien puisqu'elle revenait au rejeu suivant.
--
-- Une fois qu'un dev existe, l'amorçage n'a plus d'objet. `on conflict` est
-- conservé pour le cas où l'adresse aurait été réutilisée entre-temps.
insert into invitations (email, nom, role, commission_unitaire, doit_changer_mdp)
select 'dev@stockflow.local', 'Propriétaire technique', 'dev', 0, true
 where not exists (select 1 from profils where role = 'dev')
on conflict (email) do nothing;
