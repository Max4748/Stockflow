-- ============================================================
-- Retrait d'un compte.
-- ============================================================
-- Jumeau de `retirer_produit()` : suppression si le compte n'a laissé aucune
-- trace, désactivation sinon. La différence est le nombre de traces
-- possibles — dix clés étrangères pointent vers `profils`, dont six en
-- `no action` qui bloquent tout autant que les quatre en `restrict`.
--
-- C'est cette seconde famille que ce fichier protège : un gérant qui n'a
-- jamais rien vendu mais qui a arbitré un SAV A un historique, et le dossier
-- doit continuer de dire qui l'a tranché.
-- ------------------------------------------------------------

select plan(20);

select t_compte('t-dev@test.invalid',     'T-Dev',      'dev')       as dev     \gset
select t_compte('t-gerant@test.invalid',  'T-Gérant',   'gerant')    as gerant  \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur',  'vendeur', 5) as vendeur \gset
select t_compte('t-vierge@test.invalid',  'T-Vierge',   'vendeur', 5) as vierge  \gset
select t_produit('T-Produit', 30) as produit \gset

-- ---------- Aucune trace : supprimé ----------
select t_agir(:'gerant') as _ \gset

select matches(retirer_compte(:'vierge'), 'supprimé',
               'un compte sans le moindre historique est supprimé');

reset role;
select is((select count(*)::int from profils where id = :'vierge'), 0,
          'son profil a disparu');
select is((select count(*)::int from auth.users where id = :'vierge'), 0,
          'et sa ligne auth.users avec, par cascade');

-- ---------- Avec des ventes : désactivé ----------
-- C'est le GÉRANT qui approvisionne et distribue : il devient ainsi
-- `mouvements_stock.cree_par` et `restocks.cree_par`, les clés en `no action`
-- que le dernier bloc vérifie.
select t_agir(:'gerant') as _ \gset
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
select t_agir(:'gerant') as _ \gset
select matches(retirer_compte(:'vendeur'), 'DÉSACTIVÉ',
               'un compte avec des ventes est désactivé, pas supprimé');

reset role;
select is((select actif from profils where id = :'vendeur'), false,
          'il n''a plus accès');
select is((select count(*)::int from ventes where vendeur_id = :'vendeur'), 1,
          'mais ses ventes sont intactes');
select is(stock_detenu(:'produit', :'vendeur'), 3,
          'et le stock qu''il détient reste calculable');

-- ---------- Deuxième retrait : pas de faux succès ----------
select t_agir(:'gerant') as _ \gset
select matches(retirer_compte(:'vendeur'), 'déjà désactivé',
               'un second retrait le dit, au lieu de mentir');

-- ---------- Les traces indirectes comptent AUSSI ----------
-- Le gérant n'a JAMAIS vendu : aucune clé en `restrict` ne le désigne. Mais il
-- a créé le restock et le transfert plus haut, donc `restocks.cree_par` et
-- `mouvements_stock.cree_par` le désignent, et ces clés en `no action` sont
-- tout aussi bloquantes. Les oublier dans le comptage supprimerait un compte
-- que la base refuserait ensuite de laisser partir.
reset role;
select t_agir(:'dev') as _ \gset
select matches(retirer_compte(:'gerant'), 'DÉSACTIVÉ',
               'un gérant qui n''a rien vendu mais a créé des mouvements est désactivé');

reset role;
select is((select count(*)::int from profils where id = :'gerant'), 1,
          'son compte existe toujours');

-- ---------- Désactiver un compte VIERGE reste possible ----------
-- C'est le cas du compte ouvert en avance : `retirer_compte()` le supprimerait
-- puisqu'il n'a aucune trace, alors qu'on veut le garder fermé jusqu'au
-- premier jour. `changer_actif()` est le chemin qui ne supprime jamais, et
-- l'interface propose les deux.
reset role;
select t_compte('t-avance@test.invalid', 'T-Avance', 'vendeur', 5) as avance \gset
select t_agir(:'dev') as _ \gset
select changer_actif(:'avance', false) as _ \gset

reset role;
select is((select actif from profils where id = :'avance'), false,
          'un compte vierge se désactive sans être supprimé');
select is((select count(*)::int from profils where id = :'avance'), 1,
          'et il est toujours là, prêt à être réactivé');

-- ---------- Hiérarchie ----------
-- Le gérant est désactivé : il faut un compte actif pour tester le refus.
select t_compte('t-gerant2@test.invalid', 'T-Gérant2', 'gerant') as gerant2 \gset
select t_compte('t-gerant3@test.invalid', 'T-Gérant3', 'gerant') as gerant3 \gset
select t_agir(:'gerant2') as _ \gset

select throws_ok(
  format($$ select retirer_compte(%L) $$, :'gerant3'),
  '42501', null, 'un gérant ne retire pas un autre gérant : niveau égal');

select throws_ok(
  format($$ select retirer_compte(%L) $$, :'dev'),
  '42501', null, 'et encore moins un dev');

select throws_ok(
  format($$ select retirer_compte(%L) $$, :'gerant2'),
  '42501', null, 'on ne retire pas son propre compte');

reset role;
select t_agir(:'gerant2') as _ \gset
select throws_ok(
  $$ select retirer_compte('00000000-0000-0000-0000-000000000000') $$,
  '02000', null, 'un identifiant inconnu est refusé, pas ignoré en silence');

-- ---------- Le lien d'invitation, transmissible hors courriel ----------
-- La fonction LIT le jeton posé par l'invitation, elle n'en fabrique pas :
-- `generateLink` de l'API d'administration remplacerait celui du courriel, qui
-- deviendrait invalide sans que rien ne le signale.
-- Comptes dédiés : les assertions précédentes ont modifié `gerant` et
-- `vendeur`, et ce fichier interdit de supposer quoi que ce soit de l'état
-- laissé par les autres.
reset role;
select t_compte('t-ger-lien@test.invalid', 'T-Gérant-Lien', 'gerant')     as gl \gset
select t_compte('t-ven-lien@test.invalid', 'T-Vendeur-Lien', 'vendeur', 5) as vl \gset
update auth.users set confirmation_token = 'jeton-essai-vendeur'
 where id = :'vl';

select t_agir(:'gl') as _ \gset
select is(lien_invitation(:'vl'), 'jeton-essai-vendeur',
          'un gérant obtient le jeton d''un vendeur qu''il gère');

select throws_ok(
  format($$ select lien_invitation(%L) $$, :'dev'),
  '42501', null,
  'mais jamais celui d''un niveau supérieur : ce jeton vaut une session');

reset role;
select t_agir(:'vl') as _ \gset
select throws_ok(
  format($$ select lien_invitation(%L) $$, :'vierge'),
  '42501', null, 'un vendeur ne peut pas l''appeler du tout');

-- Le jeton disparaît quand le compte a servi son invitation : l'écran doit dire
-- qu'il n'y a plus de lien plutôt que d'en afficher un mort.
reset role;
update auth.users set confirmation_token = '' where id = :'vl';
select t_agir(:'gl') as _ \gset
select is(lien_invitation(:'vl'), null,
          'lien déjà consommé : plus rien à donner, pas un lien mort');
