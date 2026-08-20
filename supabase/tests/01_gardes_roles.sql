-- ============================================================
-- Gardes de rôle : « on ne gère qu'un niveau strictement inférieur au sien ».
-- ============================================================
-- C'est la règle qui empêche l'escalade de privilèges : sans elle, un gérant
-- se crée un compte dev et le projet n'a plus de plancher. Elle est portée par
-- exiger_gestion_de(), appelée par inviter_utilisateur() et changer_role().
-- ------------------------------------------------------------

select plan(11);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')         as dev     \gset
select t_compte('t-gerant@test.invalid',  'T-Gérant',  'gerant')      as gerant  \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5)  as vendeur \gset

-- ---------- Le vendeur ne gère personne ----------
select t_agir(:'vendeur') as _ \gset

select is(niveau_courant(), 1, 'un vendeur est au niveau 1');
select is(est_admin(), false, 'un vendeur n''est pas admin');

select throws_ok(
  $$ select inviter_utilisateur('x@test.invalid', 'X', 'vendeur') $$,
  '42501',
  null,
  'un vendeur ne peut inviter personne, pas même un autre vendeur');

select throws_ok(
  format($$ select enregistrer_versement(%L, 10) $$, :'vendeur'),
  '42501',
  null,
  'un vendeur ne peut pas encaisser de versement');

-- ---------- Le gérant gère en dessous, jamais à son niveau ----------
reset role;
select t_agir(:'gerant') as _ \gset

select is(niveau_courant(), 2, 'un gérant est au niveau 2');

select lives_ok(
  $$ select inviter_utilisateur('nouveau-vendeur@test.invalid', 'N', 'vendeur', 3) $$,
  'un gérant invite un vendeur');

select throws_ok(
  $$ select inviter_utilisateur('autre-gerant@test.invalid', 'A', 'gerant') $$,
  '42501',
  null,
  'un gérant ne peut PAS inviter un gérant : niveau égal, pas inférieur');

select throws_ok(
  $$ select inviter_utilisateur('un-dev@test.invalid', 'D', 'dev') $$,
  '42501',
  null,
  'un gérant ne peut pas inviter un dev');

select throws_ok(
  $$ select inviter_utilisateur('n-importe@test.invalid', 'N', 'root') $$,
  '22023',
  null,
  'un rôle inconnu est refusé avant toute écriture');

-- ---------- Le dev gère les gérants ----------
reset role;
select t_agir(:'dev') as _ \gset

select lives_ok(
  $$ select inviter_utilisateur('nouveau-gerant@test.invalid', 'G', 'gerant') $$,
  'un dev invite un gérant');

-- ---------- Le rôle seul ne suffit jamais : il faut être ACTIF ----------
-- Toutes les gardes vérifient `actif`, pas le rôle. Un gérant désactivé doit
-- retomber au niveau 0, sinon désactiver un compte ne protégerait de rien.
reset role;
update profils set actif = false where id = :'gerant';
select t_agir(:'gerant') as _ \gset

select throws_ok(
  $$ select inviter_utilisateur('apres-desactivation@test.invalid', 'Z', 'vendeur') $$,
  '42501',
  null,
  'un gérant DÉSACTIVÉ ne gère plus personne, son rôle est intact pourtant');
