-- ============================================================
-- La courbe du Bilan et la recherche du journal.
-- ============================================================
-- Deux lectures ajoutées pour l'écran, et une propriété chacune :
--
--   • `ca_par_jour` doit retomber sur `bilan_global().ca`. La courbe est
--     affichée sous l'indicateur « Chiffre d'affaires » : si leurs deux
--     définitions divergent (un remboursement SAV oublié d'un côté), l'écran
--     se contredit lui-même ;
--   • la recherche du journal est faite en base PARCE QUE le journal est
--     paginé. Elle doit donc trouver une ligne qui ne serait pas sur la page
--     demandée, et ne pas traiter `%` comme un joker.
-- ------------------------------------------------------------

select plan(11);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_produit('T-Produit', 30) as produit \gset

select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10)),
  100, 0, 'FACTURE-COURBE') as _ \gset
select transferer_stock(:'vendeur',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 6))) as _ \gset

-- Deux ventes à deux dates, dont une à un client au nom piégeux pour LIKE.
reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 2, 'prix_vente_unitaire', 30)
), 'Mme Roche', current_date - 2) as vente_a \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 1, 'prix_vente_unitaire', 40)
), '100% coton', current_date) as vente_b \gset

-- ---------- La garde ----------
select throws_ok($$ select * from ca_par_jour() $$, '42501', null,
                 'un vendeur ne lit pas la courbe du chiffre d''affaires');

-- ---------- La courbe, avant tout remboursement ----------
reset role;
select t_agir(:'dev') as _ \gset
select is((select count(*)::int from ca_par_jour()), 2,
          'un point par jour qui a bougé, pas un par jour du calendrier');
select is((select ca from ca_par_jour() where jour = current_date - 2), 60.00::numeric,
          'le premier jour porte sa vente');
select is((select nb_ventes from ca_par_jour() where jour = current_date), 1,
          'et chaque jour compte ses ventes');
select is((select count(*)::int from ca_par_jour(current_date, current_date)), 1,
          'les bornes de période sont respectées');

-- ---------- Un remboursement est déduit, à SA date ----------
select declarer_sav(:'vente_a', :'produit', 1, 'remboursement',
                    'Test : remboursement accordé par la gestion', 30) as _ \gset
select is((select ca from ca_par_jour() where jour = current_date), 10.00::numeric,
          'le remboursement pèse sur le jour où il est accordé : 40 − 30');
select is((select ca from ca_par_jour() where jour = current_date - 2), 60.00::numeric,
          'et non sur le jour de la vente remboursée');
select is((select sum(ca) from ca_par_jour()), (select ca from bilan_global()),
          'la somme de la courbe retombe sur le chiffre d''affaires du bilan');

-- ---------- La recherche du journal ----------
select is((select count(*)::int from journal_transactions(p_recherche => 'roche')), 1,
          'la recherche ignore la casse et porte sur le libellé');
select is((select count(*)::int
             from journal_transactions(p_limite => 1, p_offset => 0,
                                       p_recherche => 'FACTURE-COURBE')), 1,
          'elle trouve une ligne qui ne serait pas sur la première page');
select is((select count(*)::int from journal_transactions(p_recherche => '100%')), 1,
          '`%` saisi par l''utilisateur est un caractère, pas un joker');

reset role;
