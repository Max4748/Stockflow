-- ============================================================
-- SAV : les deux régimes, et la révocation.
-- ============================================================
-- Le SAV est le seul endroit où un vendeur écrit tout seul dans le stock.
-- D'où la règle asymétrique : il agit seul sur la MARCHANDISE (un échange
-- prend effet immédiatement), il demande pour l'ARGENT (un remboursement
-- attend l'arbitrage). Le contrepoids est revoquer_sav() (0019), qui défait
-- un échange validé et rend l'unité — c'est le chemin irréversible, donc
-- celui qui mérite des assertions.
--
-- Toutes les assertions de compteur sont RELATIVES : la base contient déjà
-- des dossiers, et une valeur absolue serait vraie ici et fausse ailleurs.
-- ------------------------------------------------------------

select plan(20);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_produit('T-Produit', 30) as produit \gset

-- Le badge du gérant part éteint, sinon le compteur inclurait les dossiers
-- déjà en base. Pas via marquer_sav_gestion_vu() : dans une transaction,
-- now() est figé à son ouverture, donc la marque porterait EXACTEMENT
-- l'horodatage des dossiers créés ensuite, et la comparaison stricte `>` les
-- masquerait tous. Une seconde de recul suffit à lever l'ambiguïté.
update profils set sav_gestion_vu_le = now() - interval '1 second' where id = :'dev';

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
)) as vente \gset

reset role;
select is(stock_detenu(:'produit', :'vendeur'), 3, 'après la vente : 5 − 2 = 3 en stock');

-- ---------- Garde-fous à la déclaration ----------
select t_agir(:'vendeur') as _ \gset

select throws_ok(
  format($$ select declarer_sav(%L, %L, 1, 'echange', '   ') $$, :'vente', :'produit'),
  '22023', null, 'un motif vide est refusé : « SAV » seul n''explique rien');

select throws_ok(
  format($$ select declarer_sav(%L, %L, 1, 'remboursement', 'Test', 31) $$,
         :'vente', :'produit'),
  '23514', null, 'rembourser plus que le prix payé est refusé');

-- ---------- 1. L'échange : validé d'office, effet immédiat ----------
select declarer_sav(:'vente', :'produit', 1, 'echange',
                    'Test : échange déclaré par le vendeur') as ech \gset

reset role;
select is((select statut from sav where id = :'ech'), 'valide',
          'un échange déclaré par le vendeur est validé d''office');

select is(stock_detenu(:'produit', :'vendeur'), 2,
          'l''unité de remplacement est sortie du stock DU VENDEUR');

select is((select count(*)::int from mouvements_stock where origine_sav_id = :'ech'), 1,
          'un échange écrit exactement un mouvement');

-- ---------- Le badge de gestion s'allume pour ce que le gérant n'a pas fait ----------
select t_agir(:'dev') as _ \gset
select is(sav_gestion_non_vus(), 1,
          'le gérant est averti de l''échange déclaré par le vendeur');

-- 0021 : ce qui est enregistré, c'est la borne de ce qui a été AFFICHÉ, pas
-- l'heure du clic. Une borne antérieure au dossier le laisse donc non vu —
-- c'est exactement le cas d'un dossier arrivé entre le rendu et le marquage.
select marquer_sav_gestion_vu(now() - interval '1 second') as _ \gset
select is(sav_gestion_non_vus(), 1,
          'une borne ANTÉRIEURE au dossier ne l''éteint pas');

select marquer_sav_gestion_vu() as _ \gset
select is(sav_gestion_non_vus(), 0, 'marquer vu sans borne éteint le badge');

-- Deux onglets ouverts : celui qui poste la borne la plus ancienne ne doit
-- pas faire reculer la marque et tout rallumer.
select marquer_sav_gestion_vu(now() - interval '1 hour') as _ \gset
select is(sav_gestion_non_vus(), 0,
          'une borne plus ancienne ne rallume rien : la marque ne recule jamais');

-- La borne vient du navigateur : une valeur future est ramenée à maintenant,
-- sinon l'appelant s'aveuglerait définitivement.
select marquer_sav_gestion_vu(now() + interval '1 year') as _ \gset
reset role;
select ok((select sav_gestion_vu_le from profils where id = :'dev') <= now(),
          'une borne dans le futur est ramenée à maintenant');

-- ---------- 2. La révocation ----------
reset role;
select t_agir(:'vendeur') as _ \gset
select throws_ok(
  format($$ select revoquer_sav(%L, 'Abusif') $$, :'ech'),
  '42501', null, 'un vendeur ne révoque pas son propre dossier');

reset role;
select t_agir(:'dev') as _ \gset

select throws_ok(
  format($$ select revoquer_sav(%L, '  ') $$, :'ech'),
  '23514', null, 'révoquer sans motif est refusé : c''est la trace qui compte');

select lives_ok(
  format($$ select revoquer_sav(%L, 'Test : échange non justifié') $$, :'ech'),
  'le gérant révoque un échange validé');

reset role;
select is(stock_detenu(:'produit', :'vendeur'), 3,
          'l''unité revient à SON détenteur d''origine, pas à l''entrepôt');

select is((select count(*)::int from mouvements_stock where origine_sav_id = :'ech'), 0,
          'le mouvement de l''échange a disparu');

select is((select statut || ' / ' || motif_refus from sav where id = :'ech'),
          'refuse / Test : échange non justifié',
          'le dossier reste, refusé et motivé — supprimer effacerait la répétition');

-- ---------- 3. Le remboursement attend l'arbitrage ----------
select t_agir(:'vendeur') as _ \gset
select declarer_sav(:'vente', :'produit', 1, 'remboursement',
                    'Test : remboursement demandé', 30) as remb \gset

reset role;
select is((select statut from sav where id = :'remb'), 'en_attente',
          'un remboursement déclaré par le vendeur attend l''arbitrage');

select is((select count(*)::int from mouvements_stock where origine_sav_id = :'remb'), 0,
          'un remboursement n''écrit AUCUN mouvement : l''article est déjà sorti à la vente');

-- ---------- Le cumul se compte sur les dossiers vivants ----------
-- 2 unités vendues, 1 en attente : demander 2 de plus dépasse. Le dossier
-- révoqué plus haut ne compte pas — il a rendu son unité.
select t_agir(:'vendeur') as _ \gset
select throws_ok(
  format($$ select declarer_sav(%L, %L, 2, 'echange', 'Test : dépassement') $$,
         :'vente', :'produit'),
  '23514', null, 'on ne peut pas mettre en SAV plus d''unités qu''il n''en a été vendu');
