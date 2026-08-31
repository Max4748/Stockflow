-- ============================================================
-- Journal d'administration.
-- ============================================================
-- Sept fonctions touchent un compte. Aucune ne laissait de trace : créer un
-- accès, changer un rôle, désactiver quelqu'un ne disait ni qui, ni quoi
-- avant. Sur un dispositif à plusieurs gérants, c'est ce qui rend un
-- désaccord insoluble.
--
-- Ce fichier vérifie les trois propriétés qui rendent la trace utile : elle
-- existe pour chaque geste, elle porte la valeur d'AVANT, et une action
-- refusée n'écrit rien. La troisième est la plus facile à casser : il suffit
-- de placer l'appel avant la garde.
-- ------------------------------------------------------------

select plan(13);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-gerant@test.invalid',  'T-Gérant',  'gerant')     as gerant  \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset

-- ---------- Chaque geste laisse une ligne ----------
select t_agir(:'gerant') as _ \gset
select inviter_utilisateur('t-invite@test.invalid', 'Invité', 'vendeur', 4) as _ \gset
select modifier_compte(:'vendeur', 'T-Vendeur bis', 7)                      as _ \gset
select exiger_changement_mdp(:'vendeur')                                    as _ \gset
select changer_actif(:'vendeur', false)                                     as _ \gset

reset role;
select is((select count(*)::int from journal_admin), 4,
          'quatre gestes, quatre lignes');

-- Pas de `order by cree_le` : `now()` est figé dans la transaction, les
-- quatre lignes portent le même horodatage et l'ordre serait arbitraire.
select ok((select cible from journal_admin where action = 'invitation') is null,
          'l''invitation est tracée sans cible : le compte n''existe pas encore');

-- ---------- La valeur d'AVANT est la vraie ----------
select is((select avant->>'nom' from journal_admin where action = 'modification'),
          'T-Vendeur',
          'la modification garde l''ancien nom, relevé avant l''update');
select is((select apres->>'commission' from journal_admin where action = 'modification'),
          '7',
          'et la nouvelle commission');
select is((select avant->>'actif' from journal_admin where action = 'désactivation'),
          'true',
          'la désactivation garde l''état d''avant');

-- ---------- L'acteur et la cible sont nommés ----------
select is((select acteur_nom from journal_admin where action = 'modification'), 'T-Gérant',
          'l''acteur est nommé');
select is((select cible_nom from journal_admin where action = 'modification'), 'T-Vendeur bis',
          'la cible aussi');

-- ---------- Une action REFUSÉE n'écrit rien ----------
-- Le piège : placer l'appel à tracer_admin avant la garde produirait une
-- trace pour une action qui n'a pas eu lieu, ce qui est pire que pas de trace.
select t_agir(:'vendeur') as _ \gset
select throws_ok(
  format($$ select changer_actif(%L, false) $$, :'gerant'),
  '42501', null, 'un vendeur ne désactive personne');

reset role;
select is((select count(*)::int from journal_admin), 4,
          'et la tentative refusée n''a laissé aucune ligne');

-- ---------- Le retrait dit LEQUEL des deux dénouements ----------
-- `reset role` d'abord : `t_compte` insère en direct dans `invitations` et
-- `auth.users`, deux écritures révoquées à `authenticated`.
reset role;
select t_compte('t-vierge@test.invalid', 'T-Vierge', 'gerant') as vierge \gset

select t_agir(:'dev') as _ \gset
select retirer_compte(:'vierge') as _ \gset

reset role;
select is((select count(*)::int from journal_admin
            where action = 'suppression de compte'), 1,
          'un compte sans historique laisse une trace de SUPPRESSION');
select is((select cible_nom from journal_admin where action = 'suppression de compte'),
          'T-Vierge',
          'et le nom survit à la disparition de la ligne référencée');
select ok((select cible from journal_admin where action = 'suppression de compte') is null,
          'la clé étrangère est passée à NULL, comme prévu');

-- ---------- Lecture réservée au dev ----------
select t_agir(:'gerant') as _ \gset
select throws_ok(
  $$ select journal_admin() $$,
  '42501', null, 'un gérant ne lit pas le journal d''administration');
