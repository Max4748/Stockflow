-- ============================================================
-- Corriger ou annuler un achat fournisseur.
-- ============================================================
-- Un achat est la saisie la plus exposée à l'erreur du projet : un total de
-- commande et des quantités recopiés d'une facture. Mais il ne se défait pas
-- librement, pour deux raisons distinctes que ce fichier sépare.
--
--   STOCK      les unités ont pu être distribuées ou vendues ;
--   COÛT FIGÉ  une vente postérieure a figé un coût qui en dépend.
--
-- La seconde est la moins intuitive et la plus facile à casser par une
-- « simplification » future : c'est elle qui empêche la marge affichée de
-- cesser de correspondre au prix réellement payé.
-- ------------------------------------------------------------

select plan(13);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_produit('T-Produit', 30) as produit \gset

-- ---------- Correction d'un achat intact ----------
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10)),
  100, 20, 'FACTURE-1') as achat \gset

reset role;
select is(stock_detenu(:'produit', null), 10, 'les 10 unités sont en entrepôt');
select is((select prix_achat_unitaire from restocks where id = :'achat'), 12.0000::numeric,
          'coût unitaire = (100 + 20) / 10, frais de port compris');

select t_agir(:'dev') as _ \gset
select lives_ok(
  format($$ select modifier_restock(%L, jsonb_build_array(
    jsonb_build_object('produit_id', %L, 'quantite', 8)), 96, 0, 'FACTURE-1-BIS') $$,
    :'achat', :'produit'),
  'un achat que rien n''a entamé se corrige');

reset role;
select is(stock_detenu(:'produit', null), 8, 'l''entrepôt suit la correction');
select is((select prix_achat_unitaire from restocks where id = :'achat'), 12.0000::numeric,
          'et le coût unitaire est recalculé');
select is((select reference from restocks where id = :'achat'), 'FACTURE-1-BIS',
          'la référence est reprise');

-- L'en-tête survit : c'est `cree_le` que la garde compare aux ventes, le
-- renouveler desserrerait la règle qu'on vient de franchir.
select is((select count(*)::int from restocks where id = :'achat'), 1,
          'l''achat garde son identité, il n''est pas recréé');

-- ---------- Une fois le stock sorti, plus de reprise ----------
select t_agir(:'dev') as _ \gset
select transferer_stock(:'vendeur',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 5))) as _ \gset

select throws_ok(
  format($$ select supprimer_restock(%L) $$, :'achat'),
  '23514', null,
  'un achat dont les unités sont parties chez un vendeur ne se supprime plus');

select throws_like(
  format($$ select supprimer_restock(%L) $$, :'achat'),
  '%ajustement de stock%',
  'et le message dit par où passer à la place');

reset role;
select is(stock_detenu(:'produit', null), 3,
          'le refus n''écrit rien : l''entrepôt est intact');

-- ---------- Le coût figé bloque même quand le stock suffit ----------
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 20)),
  200, 0) as achat2 \gset

-- `now()` est figé à l'ouverture de la transaction : sans reculer l'achat,
-- la vente ci-dessous porterait EXACTEMENT le même horodatage et la garde ne
-- la verrait pas comme postérieure. En production la question ne se pose pas,
-- chaque action étant sa propre transaction.
reset role;
update restocks set cree_le = now() - interval '1 hour' where id = :'achat2';

select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 1, 'prix_vente_unitaire', 30)
)) as _ \gset

reset role;
select t_agir(:'dev') as _ \gset
select throws_ok(
  format($$ select supprimer_restock(%L) $$, :'achat2'),
  '23514', null,
  'une vente postérieure a figé un coût : l''achat se ferme même avec le stock présent');

-- ---------- Gardes ----------
reset role;
select t_agir(:'vendeur') as _ \gset
select throws_ok(
  format($$ select supprimer_restock(%L) $$, :'achat2'),
  '42501', null, 'un vendeur ne touche à aucun achat');

reset role;
select t_agir(:'dev') as _ \gset
select throws_ok(
  $$ select supprimer_restock('00000000-0000-0000-0000-000000000000') $$,
  '02000', null, 'un identifiant inconnu est refusé, pas ignoré en silence');
