-- ============================================================
-- Prélèvements personnels : la dette monte, le chiffre d'affaires non.
-- ============================================================
-- Un vendeur repart avec de la marchandise pour lui. Il n'a encaissé aucun
-- client, donc il doit le tarif convenu. Ce fichier vérifie les deux moitiés de
-- cette phrase — que la dette bouge, et que le CA ne bouge PAS — parce que
-- confondre les deux fausserait la marge de toute la boutique sans qu'aucune
-- erreur ne se déclare.
--
-- Le tarif par défaut est `prix_vente_conseille - commission_unitaire`, soit
-- exactement ce qu'un vendeur devrait après avoir vendu l'unité au prix
-- conseillé. Prélever au tarif par défaut coûte donc le même prix que vendre.
-- ------------------------------------------------------------

select plan(18);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')         as dev     \gset
select t_compte('t-gerant@test.invalid',  'T-Gérant',  'gerant')      as gerant  \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5)  as vendeur \gset
select t_compte('t-riche@test.invalid',   'T-Riche',   'vendeur', 40) as riche   \gset
select t_produit('T-Produit', 30) as produit \gset

select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 20)),
  200, 0) as _ \gset
select transferer_stock(:'vendeur',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10))) as _ \gset
reset role;

-- ---------- Le tarif par défaut ----------
select is(prix_preleve(:'vendeur', :'produit'), 25.00::numeric,
          'tarif par défaut = conseillé 30 − commission 5');

-- Une commission supérieure au prix conseillé donnerait un tarif négatif,
-- c'est-à-dire une dette qui DIMINUE en prenant de la marchandise.
select is(prix_preleve(:'riche', :'produit'), 0.00::numeric,
          'commission supérieure au conseillé : le tarif est plancher à 0');

-- ---------- Prélever ----------
select t_agir(:'vendeur') as _ \gset
select enregistrer_prelevement(:'produit', 2) as prise \gset

select is((select reste_a_verser from ma_dette()), 50.00::numeric,
          'la dette monte de 2 × 25');
select is((select preleve from ma_dette()), 50.00::numeric,
          'et le montant prélevé est visible, sans quoi la dette serait inexplicable');
select is((select ca from ma_dette()), 0.00::numeric,
          'le chiffre d''affaires ne bouge PAS : aucun client n''a payé');
select is((select count(*)::int from mes_prelevements()), 1,
          'le vendeur retrouve sa prise dans sa liste');

-- `stock_detenu` est fermée à `authenticated` (elle donne le prix de revient
-- par ricochet) : la lire en superutilisateur, comme le font les autres
-- fichiers de test.
reset role;
select is((select stock_detenu(:'produit', :'vendeur')), 8,
          'le stock du vendeur baisse de la quantité prise');

-- ---------- Ce qu'un vendeur ne peut pas faire ----------
select t_agir(:'vendeur') as _ \gset
select throws_ok(
  format($$ select definir_prix_preleve(%L, %L, 1) $$, :'vendeur', :'produit'),
  '42501', null, 'un vendeur ne fixe pas son propre tarif');

select throws_ok(
  format($$ select enregistrer_prelevement(%L, 999) $$, :'produit'),
  '23514', null, 'prélever plus que son stock est refusé');

select throws_ok(
  format($$ select supprimer_prelevement(%L) $$, :'prise'),
  '42501', null,
  'un vendeur n''annule pas sa propre prise : ce serait effacer sa dette');

-- ---------- Le tarif est un couple (vendeur, produit) ----------
reset role;
select t_agir(:'gerant') as _ \gset
select definir_prix_preleve(:'vendeur', :'produit', 12) as _ \gset
select is(prix_preleve(:'vendeur', :'produit'), 12.00::numeric,
          'le tarif posé remplace le défaut');
select is(prix_preleve(:'riche', :'produit'), 0.00::numeric,
          'et il ne déborde pas sur un autre vendeur');

select throws_ok(
  format($$ select definir_prix_preleve(%L, %L, -1) $$, :'vendeur', :'produit'),
  '22023', null, 'un tarif négatif est refusé');

-- Le tarif est figé À LA PRISE : la première reste à 25, la seconde part à 12.
select enregistrer_prelevement(:'produit', 1, :'vendeur') as _ \gset
select is((select reste_a_verser from creances() where vendeur_id = :'vendeur'),
          62.00::numeric,
          'un tarif changé ne réécrit pas une dette déjà constituée : 50 + 12');

select definir_prix_preleve(:'vendeur', :'produit', null) as _ \gset
select is(prix_preleve(:'vendeur', :'produit'), 25.00::numeric,
          'remettre le tarif à NULL revient au défaut');

-- ---------- Annuler une prise ----------
select supprimer_prelevement(:'prise') as _ \gset
select is((select reste_a_verser from creances() where vendeur_id = :'vendeur'),
          12.00::numeric, 'annuler la prise retire sa dette');
reset role;
select is((select stock_detenu(:'produit', :'vendeur')), 9,
          'et rend les unités au stock du vendeur, par la cascade');
select is((select count(*)::int from journal_operations
            where entite = 'prelevement' and entite_id = :'prise'), 1,
          'la suppression laisse une trace, comme toute écriture effacée');
