-- ============================================================
-- Une vente annulée reste visible, sans peser sur la comptabilité.
-- ============================================================
-- Le risque de cette fonctionnalité est tout entier dans un mot : « visible ».
-- Un drapeau laissé dans `ventes` aurait obligé 21 fonctions à l'ignorer, et
-- en oublier une aurait faussé une dette ou une marge sans rien signaler.
--
-- L'archive écarte ce risque par construction. Ce fichier vérifie les deux
-- moitiés de la promesse : la vente se voit encore, et elle ne compte plus
-- nulle part.
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
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 6))) as _ \gset

reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 2, 'prix_vente_unitaire', 30)
)) as gardee \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 3, 'prix_vente_unitaire', 30)
)) as annulee \gset

reset role;
select is(t_du(:'vendeur'), 125.00::numeric,
          'avant annulation : 5 unités vendues, dette de 150 moins 25 de commission');

select t_agir(:'vendeur') as _ \gset
select supprimer_vente(:'annulee') as _ \gset

-- ---------- Elle ne compte plus ----------
reset role;
select is(t_du(:'vendeur'), 50.00::numeric,
          'la dette retombe à la seule vente restante');
select is((select count(*)::int from ventes where id = :'annulee'), 0,
          'la vente a quitté `ventes` : aucun agrégat ne peut plus la voir');
select is((select count(*)::int from vente_lignes where vente_id = :'annulee'), 0,
          'ses lignes aussi, d''où le coût moyen pondéré intact');
select is(stock_detenu(:'produit', :'vendeur'), 4,
          'les 3 unités sont revenues dans son stock');

-- ---------- Mais elle reste visible ----------
select is((select count(*)::int from ventes_annulees where id = :'annulee'), 1,
          'elle est dans l''archive');
select is((select client from ventes_annulees where id = :'annulee'), 'Anonyme',
          'avec son client, son montant et son identifiant d''origine');

select t_agir(:'vendeur') as _ \gset
select is((select count(*)::int from mes_ventes(10)), 2,
          '« Mes ventes » en montre toujours deux');
select is((select annulee_le is not null from mes_ventes(10) where id = :'annulee'), true,
          'et sait laquelle est annulée');
select is((select corrigeable from mes_ventes(10) where id = :'annulee'), false,
          'une vente annulée ne se corrige pas');
