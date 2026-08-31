-- ============================================================
-- Invitations : retrait, et non-résurrection de l'amorçage.
-- ============================================================
-- Une invitation non consommée doit pouvoir être retirée, sinon l'écran
-- Vendeurs affiche indéfiniment un avertissement sur une création
-- interrompue qu'on ne reprendra jamais.
--
-- La garde d'`annuler_invitation` est PLUS FAIBLE que celle
-- d'`inviter_utilisateur`, et c'est le point à protéger d'une « correction »
-- future : reprendre `exiger_gestion_de` ici rendrait l'invitation `dev` de
-- l'amorçage indestructible, aucun niveau n'étant supérieur à 3.
-- ------------------------------------------------------------

select plan(9);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-gerant@test.invalid',  'T-Gérant',  'gerant')     as gerant  \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset

-- ---------- Retrait d'une invitation en attente ----------
select t_agir(:'gerant') as _ \gset
select inviter_utilisateur('t-attente@test.invalid', 'En attente', 'vendeur', 3) as _ \gset

reset role;
select is((select count(*)::int from invitations where email = 't-attente@test.invalid'), 1,
          'l''invitation est bien posée');

select t_agir(:'gerant') as _ \gset
select lives_ok(
  $$ select annuler_invitation('t-attente@test.invalid') $$,
  'un gérant retire une invitation de vendeur');

reset role;
select is((select count(*)::int from invitations where email = 't-attente@test.invalid'), 0,
          'elle a disparu');

-- ---------- L'asymétrie avec la création ----------
-- Un gérant ne peut PAS inviter un gérant, mais il peut retirer une invitation
-- de gérant : ouvrir un accès et le fermer ne portent pas le même risque.
select t_agir(:'dev') as _ \gset
select inviter_utilisateur('t-futur-gerant@test.invalid', 'G', 'gerant') as _ \gset

reset role;
select t_agir(:'gerant') as _ \gset
select throws_ok(
  $$ select inviter_utilisateur('t-autre-gerant@test.invalid', 'A', 'gerant') $$,
  '42501', null,
  'rappel : un gérant ne peut pas INVITER un gérant');

select lives_ok(
  $$ select annuler_invitation('t-futur-gerant@test.invalid') $$,
  'mais il peut RETIRER une invitation de gérant : retirer n''élève personne');

-- ---------- Une invitation consommée est une trace, pas un brouillon ----------
reset role;
select is((select utilisee from invitations
            where email = 't-vendeur@test.invalid'), true,
          'l''invitation du vendeur créé plus haut est marquée consommée');

select t_agir(:'dev') as _ \gset
select throws_ok(
  $$ select annuler_invitation('t-vendeur@test.invalid') $$,
  '23514', null,
  'une invitation déjà consommée ne se retire pas');

-- ---------- Gardes ----------
reset role;
select t_agir(:'vendeur') as _ \gset
select throws_ok(
  $$ select annuler_invitation('t-quelconque@test.invalid') $$,
  '42501', null,
  'un vendeur ne retire aucune invitation');

reset role;
select t_agir(:'dev') as _ \gset
select throws_ok(
  $$ select annuler_invitation('inconnue@test.invalid') $$,
  '02000', null,
  'une adresse inconnue est refusée, pas ignorée en silence');
