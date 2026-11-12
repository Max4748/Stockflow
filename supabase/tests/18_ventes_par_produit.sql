-- ============================================================
-- Le classement des produits du Bilan.
-- ============================================================
-- Une seule propriété compte : `ventes_par_produit` découpe par produit ce
-- que `bilan_global` affiche en total. Si les deux définitions divergent (un
-- remboursement oublié, un échange non compté), le classement et les
-- indicateurs posés au-dessus de lui se contredisent.
-- ------------------------------------------------------------

select plan(9);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_produit('T-Ambre', 30)  as ambre  \gset
select t_produit('T-Cedre', 40)  as cedre  \gset

-- Ambre coûte 10 l'unité, Cèdre 5 : deux marges unitaires différentes.
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'ambre', 'quantite', 10)),
  100, 0, 'T-AMBRE') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'cedre', 'quantite', 10)),
  50, 0, 'T-CEDRE') as _ \gset
select transferer_stock(:'vendeur', jsonb_build_array(
  jsonb_build_object('produit_id', :'ambre', 'quantite', 6),
  jsonb_build_object('produit_id', :'cedre', 'quantite', 6))) as _ \gset

reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'ambre', 'quantite', 2, 'prix_vente_unitaire', 30),
  jsonb_build_object('produit_id', :'cedre', 'quantite', 1, 'prix_vente_unitaire', 40)
), 'Client A', current_date - 2) as vente_a \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'cedre', 'quantite', 2, 'prix_vente_unitaire', 40)
), 'Client B', current_date) as vente_b \gset

-- ---------- La garde ----------
select throws_ok($$ select * from ventes_par_produit() $$, '42501', null,
                 'un vendeur ne lit pas la marge par produit');

-- ---------- Le découpage ----------
reset role;
select t_agir(:'dev') as _ \gset
select is((select unites from ventes_par_produit() where produit_id = :'cedre'), 3,
          'les unités d''un produit sont sommées sur toutes ses ventes');
select is((select ca from ventes_par_produit() where produit_id = :'ambre'), 60.00::numeric,
          'le chiffre d''affaires est celui des lignes du produit');
select is((select marge from ventes_par_produit() where produit_id = :'ambre'), 30.00::numeric,
          'la marge retire le coût et la commission : 2 × (30 − 10 − 5)');
select is((select produit from ventes_par_produit() limit 1), 'T-Cedre',
          'le plus vendu en unités vient en premier');
select is((select count(*)::int from ventes_par_produit(current_date, current_date)), 1,
          'les bornes de période sont respectées');

-- ---------- Le SAV est imputé au produit concerné ----------
select declarer_sav(:'vente_a', :'ambre', 1, 'remboursement',
                    'Test : remboursement accordé par la gestion', 30) as _ \gset
select is((select ca from ventes_par_produit() where produit_id = :'ambre'), 30.00::numeric,
          'le remboursement réduit le chiffre du produit remboursé, et lui seul');
select is((select sum(ca) from ventes_par_produit()), (select ca from bilan_global()),
          'la somme des produits retombe sur le chiffre d''affaires du bilan');
select is((select sum(marge) from ventes_par_produit()), (select marge_nette from bilan_global()),
          'et la somme des marges sur la marge nette du bilan');

reset role;
