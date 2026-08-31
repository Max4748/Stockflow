-- ============================================================
-- Les opérations qui effacent une écriture laissent une trace.
-- ============================================================
-- Le journal comptable est DÉRIVÉ de l'état courant : il lit `ventes`,
-- `restocks`, `versements`, `sav`. Tout ce qu'une suppression retire disparaît
-- donc aussi du journal, et les totaux changent sans qu'aucune ligne
-- l'explique.
--
-- C'est la propriété que ce fichier protège, et elle est facile à casser :
-- il suffit de relever le libellé APRÈS le `delete`, où l'entité n'existe
-- plus, pour que la trace soit vide sans que rien n'échoue.
-- ------------------------------------------------------------

select plan(14);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_produit('T-Produit', 30) as produit \gset

-- ---------- Un achat annulé reste dans le journal ----------
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10)),
  100, 20, 'FACTURE-A') as achat \gset
select supprimer_restock(:'achat') as _ \gset

reset role;
select is((select count(*)::int from restocks where id = :'achat'), 0,
          'l''achat a bien disparu de `restocks`');
select is((select libelle from journal_operations where entite_id = :'achat'),
          'Achat annulé · FACTURE-A',
          'mais la trace garde sa référence, relevée avant la suppression');
select is((select montant from journal_operations where entite_id = :'achat'),
          120.00::numeric,
          'et son montant, frais de port compris');
select is((select quantite from journal_operations where entite_id = :'achat'), 10,
          'et ses unités');

-- La trace n'est utile que si elle remonte dans le journal comptable.
select t_agir(:'dev') as _ \gset
select is((select count(*)::int from journal_transactions()
            where type = 'op_annulation'), 1,
          'et elle apparaît dans le journal comptable');

-- ---------- Un achat corrigé garde son état d'avant ----------
reset role;
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10)),
  100, 0, 'FACTURE-B') as achat2 \gset
select modifier_restock(:'achat2',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 8)),
  96, 0, 'FACTURE-B-BIS') as _ \gset

reset role;
select is((select detail->'avant'->>'unites' from journal_operations
            where entite_id = :'achat2'), '10',
          'la correction conserve les unités d''avant');
select is((select detail->'avant'->>'total' from journal_operations
            where entite_id = :'achat2'), '100.00',
          'et le total d''avant, introuvable ailleurs après coup');

-- ---------- Un versement supprimé explique la dette qui remonte ----------
select t_agir(:'dev') as _ \gset
select transferer_stock(:'vendeur',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 5))) as _ \gset
reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 2, 'prix_vente_unitaire', 30)
)) as _ \gset

reset role;
select t_agir(:'dev') as _ \gset
select enregistrer_versement(:'vendeur', 20) as vers \gset
select supprimer_versement(:'vers') as _ \gset

reset role;
select is((select montant from journal_operations where entite_id = :'vers'),
          20.00::numeric,
          'le versement supprimé garde son montant');
select is((select libelle from journal_operations where entite_id = :'vers'),
          'Versement supprimé · T-Vendeur',
          'et le nom du vendeur dont la dette vient de remonter');

-- ---------- Un SAV supprimé garde son motif ----------
select t_agir(:'vendeur') as _ \gset
select id as vente from ventes where vendeur_id = :'vendeur' limit 1 \gset
select declarer_sav(:'vente', :'produit', 1, 'echange', 'Bouton cassé') as sav \gset

reset role;
select t_agir(:'dev') as _ \gset
select supprimer_sav(:'sav') as _ \gset

reset role;
select matches((select libelle from journal_operations where entite_id = :'sav'),
               'Bouton cassé',
               'le SAV supprimé garde son motif, que la suppression efface');

-- ---------- Une opération REFUSÉE n'écrit rien ----------
-- Le piège symétrique de celui du journal d'administration : tracer avant la
-- garde produirait une ligne pour un geste qui n'a pas eu lieu.
-- Quatre et non cinq : `declarer_sav` est une CRÉATION, déjà visible dans le
-- journal comptable. Seules les opérations qui effacent ont besoin d'une trace.
select is((select count(*)::int from journal_operations), 4,
          'quatre gestes destructeurs, quatre traces, pas une de plus');

select t_agir(:'vendeur') as _ \gset
select throws_ok(
  format($$ select supprimer_versement(%L) $$, :'vers'),
  '42501', null, 'un vendeur ne supprime aucun versement');

reset role;
select is((select count(*)::int from journal_operations), 4,
          'et la tentative refusée n''a laissé aucune trace');

-- ---------- Un vendeur ne lit pas ce journal ----------
select t_agir(:'vendeur') as _ \gset
select is((select count(*)::int from journal_operations), 0,
          'la RLS le réserve à l''encadrement');
