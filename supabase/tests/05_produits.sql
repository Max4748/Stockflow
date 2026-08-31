-- ============================================================
-- Retrait d'un produit du catalogue.
-- ============================================================
-- `retirer_produit()` a deux dénouements, et c'est ELLE qui choisit : elle
-- supprime un produit jamais employé, elle désactive celui qui a un
-- historique. L'interface n'a qu'un bouton et n'a rien à décider.
--
-- Ce qui se teste ici, c'est la frontière entre les deux, et surtout qu'aucun
-- des deux chemins ne perd de comptabilité.
-- ------------------------------------------------------------

select plan(11);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset

-- ---------- Jamais employé : supprimé ----------
select t_produit('T-Jetable') as jetable \gset
select t_agir(:'dev') as _ \gset

select matches(retirer_produit(:'jetable'), 'supprimé',
               'un produit jamais employé est supprimé, et le message le dit');

reset role;
select is((select count(*)::int from produits where id = :'jetable'), 0,
          'il a disparu du catalogue');

-- ---------- Avec historique : désactivé, jamais supprimé ----------
select t_produit('T-Utilise', 12) as utilise \gset
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'utilise', 'quantite', 5)),
  50, 0) as _ \gset

select matches(retirer_produit(:'utilise'), 'INACTIF',
               'un produit avec historique est désactivé, et le message l''explique');

reset role;
select is((select count(*)::int from produits where id = :'utilise'), 1,
          'il est TOUJOURS là : rien n''est supprimé');
select is((select actif from produits where id = :'utilise'), false,
          'mais il est inactif');

-- La comptabilité est le vrai enjeu : le mouvement d'achat doit survivre.
select is((select count(*)::int from mouvements_stock where produit_id = :'utilise'), 1,
          'son mouvement d''achat est intact');

-- ---------- Deuxième clic : pas de faux succès ----------
select t_agir(:'dev') as _ \gset
select matches(retirer_produit(:'utilise'), 'déjà inactif',
               'un second retrait dit qu''il ne se passe rien, au lieu de mentir');

-- ---------- Le stock dérivé reste lisible ----------
reset role;
select is(stock_detenu(:'utilise', null), 5,
          'le stock d''un produit inactif reste calculable');

-- ---------- Gardes ----------
select t_agir(:'vendeur') as _ \gset
select throws_ok(
  format($$ select retirer_produit(%L) $$, :'utilise'),
  '42501', null, 'un vendeur ne retire aucun produit');

reset role;
select t_agir(:'dev') as _ \gset
select throws_ok(
  $$ select retirer_produit('00000000-0000-0000-0000-000000000000') $$,
  '02000', null, 'un identifiant inconnu est refusé, pas ignoré en silence');

-- Réactiver reste possible : le retrait n'est pas un aller sans retour.
reset role;
update produits set actif = true where id = :'utilise';
select is((select actif from produits where id = :'utilise'), true,
          'un produit désactivé se réactive depuis Modifier');
