-- ============================================================
-- StockFlow — 0010_seed.sql
-- Amorçage minimal.
-- ============================================================

-- ------------------------------------------------------------
-- Invitation du compte `dev` — le sommet de la hiérarchie.
--
-- C'est la SEULE façon d'obtenir un `dev` : aucun compte n'est créé en dur,
-- aucun mot de passe ne figure dans ce dépôt. Le trigger de 0001 lit cette
-- invitation à la première connexion et active le profil avec le rôle `dev`.
--
-- Un `dev` ne peut PAS être créé depuis l'application (la règle est « on ne
-- gère qu'un niveau strictement inférieur au sien », voir 0011) : c'est
-- volontaire, et cette invitation est donc le seul point d'entrée.
--
-- ⚠️ REMPLACER L'EMAIL avant d'exécuter, puis créer l'utilisateur dans Studio
-- (Authentication → Add user, avec « Auto Confirm User »). Sans invitation
-- correspondante, le profil serait créé actif=false et personne ne pourrait
-- l'activer — impasse volontaire.
-- ------------------------------------------------------------
insert into invitations (email, nom, role, commission_unitaire, doit_changer_mdp)
values ('dev@stockflow.local', 'Propriétaire technique', 'dev', 0, true)
on conflict (email) do nothing;

-- ------------------------------------------------------------
-- Produits de démonstration — décommenter pour une base d'essai UNIQUEMENT.
-- ------------------------------------------------------------
-- insert into produits (nom, sku, prix_vente_conseille, seuil_alerte) values
--   ('Produit A', 'SKU-A', 12.00, 5),
--   ('Produit B', 'SKU-B',  9.50, 3),
--   ('Produit C', 'SKU-C', 15.00, 3)
-- on conflict do nothing;
