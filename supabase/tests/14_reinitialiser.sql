-- ============================================================
-- Remise à zéro des données d'exploitation.
-- ============================================================
-- Une fonction qui vide la base mérite plus d'assertions que ce qu'elle
-- efface : ce qu'elle CONSERVE est tout aussi important, et c'est la partie
-- qu'une « simplification » future ferait sauter sans que rien n'échoue.
--
-- `est_dev()` est LE verrou d'autorisation, et le seul. La confirmation n'en
-- est pas un : sa valeur est affichée à l'écran, et un appelant qui a déjà
-- franchi `est_dev()` la lit en une requête. C'est un garde-fou contre
-- l'ERREUR DE CONTEXTE — croire qu'on est sur la base d'essai — et les
-- assertions ci-dessous vérifient cela, pas une résistance à une attaque.
-- ------------------------------------------------------------

select plan(17);

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
-- En superutilisateur : `bloquer_ip` est réservée à `service_role`,
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
-- Le total attendu, calculé comme la fonction le calcule.
reset role;
select (select count(*) from ventes) + (select count(*) from ventes_annulees)
     + (select count(*) from mouvements_stock) + (select count(*) from versements)
     + (select count(*) from sav) + (select count(*) from demandes_restock)
     + (select count(*) from restocks) + (select count(*) from produits)
     + (select count(*) from modeles) + (select count(*) from prelevements)
     + (select count(*) from journal_operations) as total \gset

select t_agir(:'gerant') as _ \gset
select throws_ok(
  format($$ select reinitialiser_donnees(%L) $$, :'total'),
  '42501', null,
  'un gérant est refusé AVANT même l''examen de la confirmation');

reset role;
select t_agir(:'dev') as _ \gset
select throws_ok(
  $$ select reinitialiser_donnees('REINITIALISER') $$,
  '22023', null,
  'l''ancienne phrase littérale ne vaut plus rien');

-- LE CŒUR DU CORRECTIF : un total valide AILLEURS est refusé ICI. C'est le
-- scénario des deux instances, et la seule assertion qui le couvre.
select throws_ok(
  format($$ select reinitialiser_donnees(%L) $$, (:'total'::int + 1)::text),
  '22023', null,
  'un total juste pour une AUTRE base est refusé sur celle-ci');

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
select reinitialiser_donnees(:'total') as comptes \gset

reset role;
select is((select count(*)::int from ventes), 0, 'les ventes sont parties');
select is((select count(*)::int from mouvements_stock), 0, 'les mouvements aussi');
select is((select count(*)::int from produits), 0, 'et les produits');
select is((select count(*)::int from journal_operations
            where action <> 'réinitialisation'), 0,
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

-- ---------- L'encadrement voit qu'il s'est passé quelque chose ----------
-- `journal_admin` est réservé au dev : sans cette seconde trace, un gérant
-- voyait toute l'activité disparaître sans une ligne pour le dire, sur les
-- deux écrans qu'il peut ouvrir.
select is((select count(*)::int from journal_operations), 1,
          'le journal des opérations est vidé, puis reçoit UNE ligne');
select matches((select libelle from journal_operations),
               'Données réinitialisées',
               'et cette ligne explique ce qui s''est passé');

-- ---------- La trace de l'effacement survit à l'effacement ----------
-- Scopé sur `cree_le = now()` et non sur l'action seule : `journal_admin` n'est
-- PAS effacé par la remise à zéro, c'est tout son intérêt, donc la table peut
-- déjà porter des traces d'exécutions réelles. Une assertion absolue serait
-- vraie sur une base neuve et fausse sur celle d'exploitation.
select is((select count(*)::int from journal_admin
            where action = 'réinitialisation des données' and cree_le = now()), 1,
          'la remise à zéro est inscrite au journal d''administration');
select is((select avant->>'ventes' from journal_admin
            where action = 'réinitialisation des données' and cree_le = now()), '1',
          'avec le décompte de ce qui a existé, seule trace qui en reste');
