-- ============================================================
-- Remise à zéro des données d'exploitation.
-- ============================================================
-- Une fonction qui vide la base mérite plus d'assertions que ce qu'elle
-- efface : ce qu'elle CONSERVE est tout aussi important, et c'est la partie
-- qu'une « simplification » future ferait sauter sans que rien n'échoue.
--
-- Le verrou qui compte n'est pas `est_dev()`, c'est la phrase de confirmation
-- exigée EN BASE : elle rend un appel direct à la RPC inopérant.
-- ------------------------------------------------------------

select plan(14);

select t_compte('t-dev@test.invalid',     'T-Dev',     'dev')        as dev     \gset
select t_compte('t-gerant@test.invalid',  'T-Gérant',  'gerant')     as gerant  \gset
select t_compte('t-vendeur@test.invalid', 'T-Vendeur', 'vendeur', 5) as vendeur \gset
select t_produit('T-Produit', 30) as produit \gset

-- De l'activité à effacer, et de l'état à conserver.
select t_agir(:'dev') as _ \gset
select creer_restock_fournisseur(
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 10)),
  100, 0) as _ \gset
select transferer_stock(:'vendeur',
  jsonb_build_array(jsonb_build_object('produit_id', :'produit', 'quantite', 5))) as _ \gset
-- En superutilisateur : `bloquer_ip` est réservée à `service_role` depuis 0034,
-- donc injoignable sous l'identité `authenticated` que pose `t_agir`.
reset role;
select bloquer_ip('198.51.100.77', 'à conserver') as _ \gset
select t_agir(:'dev') as _ \gset

reset role;
select t_agir(:'vendeur') as _ \gset
select enregistrer_vente(jsonb_build_array(
  jsonb_build_object('produit_id', :'produit', 'quantite', 2, 'prix_vente_unitaire', 30)
)) as _ \gset

-- ---------- Les deux verrous ----------
reset role;
select t_agir(:'gerant') as _ \gset
select throws_ok(
  $$ select reinitialiser_donnees('REINITIALISER') $$,
  '42501', null, 'un gérant ne réinitialise pas la base');

reset role;
select t_agir(:'dev') as _ \gset
select throws_ok(
  $$ select reinitialiser_donnees('oui') $$,
  '22023', null, 'la phrase exacte est exigée EN BASE, pas seulement à l''écran');
select throws_ok(
  $$ select reinitialiser_donnees(null) $$,
  '22023', null, 'et une confirmation absente est refusée comme une fausse');

reset role;
select is((select count(*)::int from ventes), 1,
          'aucune tentative refusée n''a effacé quoi que ce soit');

-- ---------- La remise à zéro ----------
-- Comptages RELEVÉS AVANT, jamais absolus : la base porte déjà des comptes et
-- des invitations, et une assertion du type « il y en a trois » serait vraie
-- ici et fausse ailleurs. Règle rappelée dans supabase/tests/README.md.
reset role;
select count(*)::int as profils_avant     from profils     \gset
select count(*)::int as invitations_avant from invitations \gset

select t_agir(:'dev') as _ \gset
select reinitialiser_donnees('REINITIALISER') as comptes \gset

reset role;
select is((select count(*)::int from ventes), 0, 'les ventes sont parties');
select is((select count(*)::int from mouvements_stock), 0, 'les mouvements aussi');
select is((select count(*)::int from produits), 0, 'et les produits');
select is((select count(*)::int from journal_operations), 0,
          'ainsi que le journal des opérations, qui les commentait');

-- ---------- Ce qui SURVIT, et qui compte autant ----------
select is((select count(*)::int from profils), :'profils_avant'::int,
          'tous les comptes sont intacts : c''est la demande même');
select is((select count(*)::int from invitations), :'invitations_avant'::int,
          'les invitations aussi : une invitation est un compte en cours');
select is((select count(*)::int from ip_bloquees where ip = '198.51.100.77'), 1,
          'le blocage IP survit : une remise à zéro n''est pas une porte de sortie');
select ok((select count(*) from roles) > 0,
          'les rôles sont une table de référence, pas des données');

-- ---------- La trace de l'effacement survit à l'effacement ----------
select is((select count(*)::int from journal_admin
            where action = 'réinitialisation des données'), 1,
          'la remise à zéro est inscrite au journal d''administration');
select is((select avant->>'ventes' from journal_admin
            where action = 'réinitialisation des données'), '1',
          'avec le décompte de ce qui a existé, seule trace qui en reste');
