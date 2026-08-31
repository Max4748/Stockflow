-- ============================================================
-- Gérant dont le stock EST l'entrepôt.
-- ============================================================
-- Le drapeau `profils.stock_lie_entrepot` évite au gérant qui héberge
-- l'entrepôt de se transférer du stock à lui-même avant chaque vente. Le
-- transfert n'est pas supprimé pour autant : il est ÉCRIT par la vente, à
-- deux jambes, parce que la contrainte `mvt_coherence` impose
-- qu'une vente sorte d'un détenteur nommé.
--
-- Ce que ce fichier protège, c'est l'invariant : le stock total de la maison
-- ne doit pas bouger d'une unité de plus que ce qui a été vendu.
-- ------------------------------------------------------------

select plan(20);

select t_compte('t-dev@test.invalid',     'T-Dev',      'dev')        as dev     \gset
select t_compte('t-lie@test.invalid',     'T-Lié',      'gerant')     as lie     \gset
select t_compte('t-terrain@test.invalid', 'T-Terrain',  'gerant')     as terrain \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur',  'vendeur', 5) as vendeur \gset
select t_produit('T-Produit', 30) as produit \gset

select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 20)),
  200, 0) as _ \gset

-- ---------- Le drapeau n'est pas ouvert aux vendeurs ----------
select throws_ok(
  format($$ select changer_stock_lie(%L, true) $$, :'vendeur'),
  '23514', null, 'un vendeur ne peut pas être lié à l''entrepôt');

select lives_ok(
  format($$ select changer_stock_lie(%L, true) $$, :'lie'),
  'un gérant, oui');

-- ---------- Lecture : il voit l'entrepôt ----------
reset role;
select t_agir(:'lie') as _ \gset
select is((select quantite from stock_disponible() where produit_id = :'produit'), 20,
          'le gérant lié voit les 20 unités de l''entrepôt comme vendables');

reset role;
select t_agir(:'terrain') as _ \gset
select is((select quantite from stock_disponible() where produit_id = :'produit'), 0,
          'le gérant NON lié ne voit toujours que ce qu''il détient, soit rien');

-- ---------- Écriture : la vente puise dans l'entrepôt ----------
reset role;
select t_agir(:'lie') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 3, 'prix_vente_unitaire', 30)
)) as vente \gset

reset role;
select is(stock_detenu(:'produit', null), 17,
          'l''entrepôt est passé de 20 à 17');
select is(stock_detenu(:'produit', :'lie'), 0,
          'et le gérant ne détient rien : tout est ressorti aussitôt');

-- L'INVARIANT : la maison a perdu exactement 3 unités, pas plus.
select is((select sum(quantite)::int from mouvements_stock where produit_id = :'produit'), 17,
          'le stock total de la maison a baissé de 3, exactement');

-- Le transfert est écrit, pas contourné.
select is((select count(*)::int from mouvements_stock
            where produit_id = :'produit' and type = 'transfert'), 2,
          'les deux jambes du transfert sont dans le registre');
select is((select sum(quantite)::int from mouvements_stock
            where produit_id = :'produit' and type = 'transfert'), 0,
          'et elles s''annulent : rien n''a été créé ni détruit');

-- La vente reste la SIENNE : seule la source du stock change.
select is((select vendeur_id from ventes where id = :'vente'), :'lie'::uuid,
          'la vente lui est attribuée, comme n''importe quelle autre');

-- ---------- Annuler une vente rend l'unité à l'ENTREPÔT ----------
-- Le piège : le `on delete cascade` d'`origine_vente_id` n'efface que la
-- sortie de vente. Les deux jambes du transfert portent un `groupe_id`, pas
-- une origine de vente, et survivent. Sans le retour écrit par
-- `supprimer_vente`, les unités restaient chez le gérant, où elles
-- sont invisibles ET invendables puisque `stock_disponible()` lit l'entrepôt.
--
-- Le total de la maison, lui, restait juste : `verifier_coherence_stock()` ne
-- signalait donc rien. C'est exactement le genre de défaut qu'aucun invariant
-- global n'attrape.
select supprimer_vente(:'vente') as _ \gset

reset role;
select is(stock_detenu(:'produit', null), 20,
          'les 3 unités sont revenues à l''entrepôt, pas ailleurs');
select is(stock_detenu(:'produit', :'lie'), 0,
          'le gérant ne détient toujours rien');
select t_agir(:'lie') as _ \gset
select is((select quantite from stock_disponible() where produit_id = :'produit'), 20,
          'et il les voit de nouveau comme vendables');
reset role;

-- Le retour est écrit et motivé : une annulation est le moment où l'on veut
-- lire ce qui s'est passé, pas le moment où le registre s'efface.
select is((select count(*)::int from mouvements_stock
            where produit_id = :'produit' and type = 'retour'), 2,
          'le retour est écrit, à deux jambes');
-- Le motif NOMME la vente : sans elle, un retour ne se rattache à rien dans
-- un journal qui en compte plusieurs le même jour.
select matches((select distinct motif from mouvements_stock
                 where produit_id = :'produit' and type = 'retour'),
               'Annulation vente depuis l''entrepôt · ' || left(:'vente', 8),
               'et il nomme la vente annulée, repérable dans le journal');

select matches((select distinct motif from mouvements_stock
                 where produit_id = :'produit' and type = 'transfert'),
               'Vente depuis l''entrepôt · ' || left(:'vente', 8),
               'le transfert de la vente la nomme aussi');

-- ---------- Un gérant non lié se comporte comme avant ----------
select t_agir(:'terrain') as _ \gset
select throws_ok(
  format($$ select enregistrer_vente(jsonb_build_array(
    jsonb_build_object('produit_id', %L, 'quantite', 1, 'prix_vente_unitaire', 30))) $$,
    :'produit'),
  '23514', null,
  'un gérant non lié ne peut toujours pas vendre ce qu''il ne détient pas');

-- ---------- Bornes ----------
reset role;
select t_agir(:'lie') as _ \gset
select throws_ok(
  format($$ select enregistrer_vente(jsonb_build_array(
    jsonb_build_object('produit_id', %L, 'quantite', 99, 'prix_vente_unitaire', 30))) $$,
    :'produit'),
  '23514', null,
  'il ne peut pas vendre plus que l''entrepôt ne contient');

-- ---------- Rétrogradation : le drapeau tombe ----------
reset role;
select t_agir(:'dev') as _ \gset
select changer_role(:'lie', 'vendeur') as _ \gset

reset role;
select is((select stock_lie_entrepot from profils where id = :'lie'), false,
          'rétrograder en vendeur baisse le drapeau au lieu de violer la contrainte');

-- ---------- Cohérence globale ----------
select t_agir(:'dev') as _ \gset
select is((select count(*)::int from verifier_coherence_stock()), 0,
          'aucune anomalie de cohérence après tout ça');
