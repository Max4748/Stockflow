-- ============================================================
-- Borne anti-surversement.
-- ============================================================
-- enregistrer_versement() refuse d'encaisser plus que le dû. La borne est en
-- SQL, pas en TypeScript : un admin passant par PostgREST contournerait un
-- contrôle applicatif et rendrait une dette négative sans trace.
--
-- L'échappatoire p_autoriser_excedent existe pour les avances et arrondis de
-- caisse. Elle doit se DEMANDER : c'est tout l'objet du dernier test.
-- ------------------------------------------------------------

select plan(10);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_produit('T-Produit', 30) as produit \gset

select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10)),
  100, 0) as _ \gset
select transferer_stock(:'vendeur',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 5))) as _ \gset

reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 2, 'prix_vente_unitaire', 30)
)) as _ \gset

reset role;
select t_agir(:'dev') as _ \gset

select is(t_du(:'vendeur'), 50.00::numeric, 'point de départ : 50 € dus');

-- ---------- Montants invalides ----------
select throws_ok(
  format($$ select enregistrer_versement(%L, 0) $$, :'vendeur'),
  '22023', null, 'un versement de 0 est refusé');

select throws_ok(
  format($$ select enregistrer_versement(%L, -10) $$, :'vendeur'),
  '22023', null, 'un versement négatif est refusé');

select throws_ok(
  $$ select enregistrer_versement('00000000-0000-0000-0000-000000000000', 10) $$,
  '02000', null, 'un vendeur inconnu est refusé');

-- ---------- La borne ----------
select throws_ok(
  format($$ select enregistrer_versement(%L, 50.01) $$, :'vendeur'),
  '23514', null, 'un centime de trop est refusé');

select is(t_du(:'vendeur'), 50.00::numeric,
          'un versement refusé n''écrit rien : la dette est intacte');

select lives_ok(
  format($$ select enregistrer_versement(%L, 50) $$, :'vendeur'),
  'le montant exact passe');

select is(t_du(:'vendeur'), 0.00::numeric, 'la dette est soldée');

-- Une fois à zéro, tout versement supplémentaire franchit la borne.
select throws_ok(
  format($$ select enregistrer_versement(%L, 1) $$, :'vendeur'),
  '23514', null, 'sur une dette soldée, même 1 € est un excédent');

-- ---------- L'échappatoire, explicite ----------
select lives_ok(
  format($$ select enregistrer_versement(%L, 25, current_date, 'Avance', true) $$,
         :'vendeur'),
  'p_autoriser_excedent laisse passer une avance');
