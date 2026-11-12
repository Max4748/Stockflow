-- ============================================================
-- La suggestion de réassort.
-- ============================================================
-- La règle tient en une ligne — vendu sur la période + seuil − stock total —
-- et c'est ce qu'on vérifie : qu'elle regarde bien la période demandée, qu'elle
-- retranche le stock détenu par les vendeurs, et qu'elle ne propose pas de
-- recommander ce qui ne se vend plus.
-- ------------------------------------------------------------

select plan(7);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
-- Seuil de 3 par parfum (défaut de t_produit).
select t_produit('T-Rapide', 30)  as rapide  \gset
select t_produit('T-Ancien', 30)  as ancien  \gset
select t_produit('T-Dormant', 30) as dormant \gset

select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(jsonb_build_array(
  jsonb_build_object('produit_id', :'rapide',  'quantite', 4),
  jsonb_build_object('produit_id', :'ancien',  'quantite', 2),
  jsonb_build_object('produit_id', :'dormant', 'quantite', 20)), 260, 0, 'T-REASSORT') as _ \gset
select transferer_stock(:'vendeur', jsonb_build_array(
  jsonb_build_object('produit_id', :'rapide', 'quantite', 4),
  jsonb_build_object('produit_id', :'ancien', 'quantite', 2))) as _ \gset

reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'rapide', 'quantite', 3, 'prix_vente_unitaire', 30)
), 'Client récent', current_date - 1) as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'ancien', 'quantite', 2, 'prix_vente_unitaire', 30)
), 'Client ancien', current_date - 60) as _ \gset

-- ---------- La garde ----------
select throws_ok($$ select * from suggestions_reassort() $$, '42501', null,
                 'un vendeur ne lit pas les suggestions de réassort');

reset role;
select t_agir(:'dev') as _ \gset

-- ---------- La règle ----------
select is((select a_commander from suggestions_reassort() where produit_id = :'rapide'), 5,
          '3 vendues + seuil de 3 − 1 en stock (chez le vendeur) = 5');
select is((select a_commander from suggestions_reassort(30) where produit_id = :'ancien'), 3,
          'une vente hors de la période ne compte pas : seul le seuil reste à couvrir');
select is((select a_commander from suggestions_reassort(90) where produit_id = :'ancien'), 5,
          'élargir la période la fait compter');
select is((select count(*)::int from suggestions_reassort() where produit_id = :'dormant'), 0,
          'un produit largement en stock n''est pas proposé');
select is((select produit from suggestions_reassort() limit 1), 'T-Rapide',
          'le plus gros besoin vient en premier');

-- ---------- Un produit retiré du catalogue ----------
reset role;
update produits set actif = false where id = :'rapide';
select t_agir(:'dev') as _ \gset
select is((select count(*)::int from suggestions_reassort() where produit_id = :'rapide'), 0,
          'un parfum désactivé ne se recommande pas');

reset role;
