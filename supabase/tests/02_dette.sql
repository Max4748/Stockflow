-- ============================================================
-- Calcul de la dette vendeur.
-- ============================================================
-- La dette n'est stockée nulle part : v_comptes_vendeurs la dérive de quatre
-- agrégats séparés (ventes, commissions, versements, remboursements SAV).
-- Trois règles s'y cachent, toutes contre-intuitives et toutes monétaires :
--   1. la commission est FIGÉE à la vente, la changer ne réécrit rien ;
--   2. un SAV ne compte qu'une fois VALIDÉ, pas à la déclaration ;
--   3. un remboursement intégral laisse un solde NÉGATIF égal à la
--      commission — le vendeur la garde, la maison assume la perte.
-- ------------------------------------------------------------

select plan(11);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_compte('t-autre@test.invalid',   'T-Autre',   'vendeur', 5) as autre   \gset
select t_produit('T-Produit', 30) as produit \gset

-- Approvisionnement : 10 unités à 100 € tout compris, donc 10 € pièce.
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10)),
  100, 0) as _ \gset
select transferer_stock(:'vendeur',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 5))) as _ \gset

-- Une vente : 2 unités à 30 €.
reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 2, 'prix_vente_unitaire', 30)
)) as vente \gset

select is((select ca from ma_dette()),             60.00::numeric, 'CA = 2 × 30');
select is((select commissions from ma_dette()),    10.00::numeric, 'commissions = 2 × 5');
select is((select reste_a_verser from ma_dette()), 50.00::numeric,
          'reste à verser = CA − commissions');

-- Cloisonnement : ma_dette() ne parle que de l'appelant.
select is((select nb_ventes from ma_dette()), 1,
          'le vendeur ne voit que ses propres ventes');

-- ---------- 1. La commission est figée à la vente ----------
reset role;
update profils set commission_unitaire = 99 where id = :'vendeur';

select is(t_du(:'vendeur'), 50.00::numeric,
          'changer la commission du vendeur ne réécrit AUCUNE dette passée');

-- ---------- 2. Un SAV ne compte qu'une fois validé ----------
select t_agir(:'vendeur') as _ \gset
select declarer_sav(:'vente', :'produit', 2, 'remboursement',
                    'Test : remboursement intégral', 60) as sav \gset

reset role;
select is(t_du(:'vendeur'), 50.00::numeric,
          'un remboursement DÉCLARÉ mais pas arbitré ne bouge pas la dette');

select t_agir(:'dev') as _ \gset
select valider_sav(:'sav') as _ \gset

reset role;
-- ---------- 3. Le solde négatif est la commission conservée ----------
select is(t_du(:'vendeur'), -10.00::numeric,
          'remboursement intégral : le solde tombe à −commission, pas à 0');

-- ---------- Révocation (0019) : l'arbitrage se défait ----------
-- refuser_sav() ne mord que sur un dossier `en_attente`. Un dossier VALIDÉ se
-- défait par revoquer_sav(), qui exige un motif et conserve la trace.
select t_agir(:'dev') as _ \gset
select revoquer_sav(:'sav', 'Test : arbitrage inverse') as _ \gset

reset role;
select is(t_du(:'vendeur'), 50.00::numeric,
          'révoquer un remboursement validé rend la dette initiale');

-- ---------- Une vente à 0 € n'est pas une vente ----------
-- Le champ de prix laissé vide donnait `Number("") === 0`, qui franchissait
-- le contrôle applicatif ET l'ancienne contrainte `>= 0`. Le chiffre
-- d'affaires restait nul mais la commission était figée : la dette passait
-- négative, la maison devait de l'argent pour une vente sans recette.
select t_agir(:'vendeur') as _ \gset

select throws_ok(
  format($$ select enregistrer_vente(jsonb_build_array(
    jsonb_build_object('produit_id', %L, 'quantite', 1, 'prix_vente_unitaire', 0))) $$,
    :'produit'),
  '23514', null,
  'une vente à 0 € est refusée par la base, pas seulement par le formulaire');

reset role;
select is(t_du(:'vendeur'), 50.00::numeric,
          'et le refus n''a pas entamé la dette : aucune ligne écrite');

-- ---------- Un vendeur sans vente n'a pas de dette ----------
select is(t_du(:'autre'), 0.00::numeric,
          'un vendeur sans vente doit zéro, pas NULL');
