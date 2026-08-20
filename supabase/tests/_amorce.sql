-- ============================================================
-- StockFlow — en-tête commun des tests pgTAP.
-- Concaténé devant chaque fichier de test par lancer.sh.
-- ============================================================
-- Tout le fichier tourne dans UNE transaction annulée à la fin (_fin.sql).
-- Conséquences voulues :
--   • les tests s'exécutent contre le schéma réel, migrations comprises —
--     pas contre une copie qui pourrait diverger ;
--   • ils ne laissent rien derrière eux, pas même l'extension pgtap. C'est
--     important : pgtap crée ~1000 fonctions dans `public`, ce qui fausserait
--     l'inventaire affiché par appliquer-migrations.sh s'il était committé.
--
-- Le prix à payer : les tests ne doivent JAMAIS affirmer quoi que ce soit sur
-- l'état global (« il y a 3 vendeurs »). Chaque assertion porte sur les
-- identifiants créés par le fichier lui-même.
-- ------------------------------------------------------------

begin;

create extension if not exists pgtap;

-- ------------------------------------------------------------
-- Fabrique un compte ACTIF en passant par le vrai chemin d'inscription :
-- invitation, puis insertion dans auth.users. Le trigger on_auth_user_created
-- crée le profil. Court-circuiter ce chemin en insérant dans `profils`
-- testerait un état que l'application ne peut pas produire.
-- ------------------------------------------------------------
create or replace function t_compte(
  p_email      text,
  p_nom        text,
  p_role       text,
  p_commission numeric default 0
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into invitations (email, nom, role, commission_unitaire, doit_changer_mdp)
  values (lower(p_email), p_nom, p_role, p_commission, false);
  insert into auth.users (id, email) values (v_id, lower(p_email));
  return v_id;
end $$;

-- ------------------------------------------------------------
-- Endosse l'identité d'un compte.
--
-- Deux réglages, et il faut les deux :
--   • request.jwt.claims → ce que lit auth.uid(), donc toutes les gardes
--     SQL (est_admin, est_actif, niveau_courant) ;
--   • role = authenticated → ce que lit la RLS. Sans lui les tests tournent
--     en superutilisateur, qui traverse toutes les policies sans les voir.
--
-- `true` en 3e argument = portée transaction : annulé par le rollback final.
-- Pour revenir en postgres (créer d'autres fixtures), écrire `reset role;`
-- dans le test — un compte `authenticated` ne peut pas le faire lui-même.
-- ------------------------------------------------------------
create or replace function t_agir(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_id, 'role', 'authenticated')::text,
                     true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function t_produit(p_nom text, p_prix numeric default 0)
returns uuid language sql as $$
  insert into produits (nom, prix_vente_conseille) values (p_nom, p_prix)
  returning id;
$$;

-- ------------------------------------------------------------
-- Raccourci de lecture : le reste à verser d'un compte.
--
-- `security definer` DÉLIBÉRÉ : c'est un observateur, pas un sujet de test.
-- v_comptes_vendeurs est révoquée à `authenticated` (0009), donc sans ça le
-- helper échouerait dès qu'un test endosse une identité. Le cloisonnement des
-- lectures se teste par ma_dette() et creances(), qui sont les vrais chemins.
-- ------------------------------------------------------------
create or replace function t_du(p_vendeur uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select reste_a_verser from v_comptes_vendeurs where vendeur_id = p_vendeur;
$$;
