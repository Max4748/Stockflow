-- ============================================================
-- StockFlow — 0011_comptes.sql
-- Gestion des comptes : ferme l'escalade de privilèges.
-- ============================================================
--
-- CE QUE CE FICHIER CORRIGE, vérifié en conditions réelles avant écriture :
-- 0009 accorde `grant update on profils to authenticated` et la policy
-- `profils_admin_all` est `for all`. Rien ne protégeait la colonne `role`, donc
-- un simple PATCH sur PostgREST suffisait à promouvoir n'importe qui :
--
--   PATCH /rest/v1/profils?id=eq.<un-vendeur>  {"role":"admin"}  ->  RÉUSSI
--
-- C'était inoffensif tant qu'`admin` était le sommet : un admin qui nomme un
-- admin reste dans ses prérogatives. Avec le niveau `dev` au-dessus, cela
-- devient une escalade — un gérant se ferait `dev` en une requête. Même faille
-- sur `invitations`, dont la colonne `role` était librement insérable.
--
-- Le correctif applique le principe déjà en place pour les ventes : la
-- barrière est le REVOKE, pas l'interface.

revoke insert, update, delete on profils     from authenticated, anon;
revoke insert, update, delete on invitations from authenticated, anon;

-- ------------------------------------------------------------
-- LA règle, appliquée par les cinq fonctions ci-dessous :
--   on ne gère jamais qu'un niveau STRICTEMENT inférieur au sien.
--
-- Conséquences voulues :
--   • un gérant (2) gère les vendeurs (1), et rien d'autre ;
--   • un dev (3) gère gérants et vendeurs ;
--   • personne ne peut créer ni promouvoir à son propre niveau — donc un dev
--     ne crée pas un second dev depuis l'application. C'est délibéré : un
--     second propriétaire technique se crée en SQL, par un geste conscient
--     (voir l'invitation de 0010).
-- ------------------------------------------------------------
create or replace function niveau_de(p_role text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select niveau from roles where cle = p_role;
$$;

create or replace function exiger_gestion_de(p_role text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cible int := niveau_de(p_role);
begin
  if v_cible is null then
    raise exception 'Rôle inconnu : %.', p_role using errcode = '22023';
  end if;
  if v_cible >= niveau_courant() then
    raise exception
      'Interdit : on ne peut gérer qu''un niveau inférieur au sien (cible « % »).',
      p_role using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------------------
-- Inviter un utilisateur. Remplace l'insertion directe dans `invitations`.
--
-- L'invitation est le premier des deux temps de la création d'un compte : le
-- second (auth.admin.createUser) se fait côté application avec la clé
-- service_role, seule façon d'accéder à l'API d'administration des comptes.
-- ------------------------------------------------------------
create or replace function inviter_utilisateur(
  p_email      text,
  p_nom        text,
  p_role       text,
  p_commission numeric default 0
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;
  perform exiger_gestion_de(p_role);

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Adresse e-mail invalide.' using errcode = '22023';
  end if;
  if trim(coalesce(p_nom, '')) = '' then
    raise exception 'Le nom est obligatoire.' using errcode = '22023';
  end if;
  if p_commission is null or p_commission < 0 then
    raise exception 'Commission invalide.' using errcode = '22023';
  end if;

  -- Un compte déjà créé ne se réinvite pas : ce serait sans effet (le trigger
  -- ne lit l'invitation qu'à l'inscription) et donnerait un faux espoir.
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Un compte existe déjà pour %.', v_email using errcode = '23505';
  end if;

  insert into invitations (email, nom, role, commission_unitaire,
                           utilisee, doit_changer_mdp)
  values (v_email, trim(p_nom), p_role, p_commission, false, true)
  on conflict (email) do update
    set nom = excluded.nom,
        role = excluded.role,
        commission_unitaire = excluded.commission_unitaire,
        utilisee = false,
        doit_changer_mdp = true;
end $$;

-- ------------------------------------------------------------
-- Modifier nom et commission d'un compte géré.
--
-- La commission n'affecte QUE les ventes à venir : chaque vente passée a figé
-- la sienne dans vente_lignes.
-- ------------------------------------------------------------
create or replace function modifier_compte(
  p_id         uuid,
  p_nom        text,
  p_commission numeric
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;
  perform exiger_gestion_de(v_role);

  if trim(coalesce(p_nom, '')) = '' then
    raise exception 'Le nom est obligatoire.' using errcode = '22023';
  end if;
  if p_commission is null or p_commission < 0 then
    raise exception 'Commission invalide.' using errcode = '22023';
  end if;

  update profils
     set nom = trim(p_nom), commission_unitaire = p_commission
   where id = p_id;
end $$;

-- ------------------------------------------------------------
-- Activer / désactiver. La SUPPRESSION n'est volontairement pas proposée :
-- ventes.vendeur_id et mouvements_stock.detenteur_id sont en `on delete
-- restrict`, elle échouerait dès qu'un compte a un historique comptable.
-- ------------------------------------------------------------
create or replace function changer_actif(p_id uuid, p_actif boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;
  if p_id = auth.uid() then
    -- Se désactiver soi-même verrouillerait la maison, éventuellement sans
    -- personne pour rouvrir.
    raise exception 'On ne désactive pas son propre compte.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;
  perform exiger_gestion_de(v_role);

  update profils set actif = coalesce(p_actif, false) where id = p_id;
end $$;

-- ------------------------------------------------------------
-- Changer le rôle d'un compte.
--
-- L'ANCIEN et le NOUVEAU rôle doivent tous deux être strictement inférieurs au
-- niveau de l'appelant. Sans le contrôle sur l'ancien, un gérant pourrait
-- rétrograder un autre gérant ; sans celui sur le nouveau, il pourrait en
-- promouvoir un.
-- ------------------------------------------------------------
create or replace function changer_role(p_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;
  if p_id = auth.uid() then
    raise exception 'On ne change pas son propre rôle.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;

  perform exiger_gestion_de(v_role);   -- niveau actuel de la cible
  perform exiger_gestion_de(p_role);   -- niveau visé

  update profils set role = p_role where id = p_id;
end $$;

-- ------------------------------------------------------------
-- Forcer le changement de mot de passe. Appelée après une réinitialisation
-- faite via l'API d'administration côté application.
-- ------------------------------------------------------------
create or replace function exiger_changement_mdp(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;
  perform exiger_gestion_de(v_role);

  update profils set doit_changer_mdp = true where id = p_id;
end $$;

-- ------------------------------------------------------------
-- Comptes visibles par un dev (gérants et dev). Fermé aux gérants : ils n'ont
-- pas à voir la liste des comptes de niveau supérieur ou égal au leur.
-- ------------------------------------------------------------
create or replace function comptes_encadrement()
returns table (
  id       uuid,
  nom      text,
  role     text,
  libelle  text,
  niveau   int,
  actif    boolean,
  mdp_provisoire boolean,
  cree_le  timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  return query
    select p.id, p.nom, p.role, r.libelle, r.niveau, p.actif,
           p.doit_changer_mdp, p.cree_le
      from profils p join roles r on r.cle = p.role
     where r.niveau >= 2
     order by r.niveau desc, p.nom;
end $$;

-- ------------------------------------------------------------
-- Privilèges. `roles` est en lecture pour tous les comptes authentifiés : le
-- libellé d'un rôle n'est pas une information sensible, et l'interface en a
-- besoin pour ses listes déroulantes.
-- ------------------------------------------------------------
alter table roles enable row level security;
drop policy if exists roles_select on roles;
create policy roles_select on roles for select using (est_actif());
grant select on roles to authenticated;
revoke insert, update, delete on roles from authenticated, anon;

grant execute on function est_dev()                                        to authenticated;
grant execute on function niveau_courant()                                 to authenticated;
grant execute on function inviter_utilisateur(text, text, text, numeric)   to authenticated;
grant execute on function modifier_compte(uuid, text, numeric)             to authenticated;
grant execute on function changer_actif(uuid, boolean)                     to authenticated;
grant execute on function changer_role(uuid, text)                         to authenticated;
grant execute on function exiger_changement_mdp(uuid)                      to authenticated;
grant execute on function comptes_encadrement()                            to authenticated;

-- Rouages internes : appelés uniquement depuis les fonctions ci-dessus, qui
-- sont en SECURITY DEFINER et s'exécutent donc avec les droits du propriétaire.
revoke execute on function niveau_de(text)          from authenticated, anon, public;
revoke execute on function exiger_gestion_de(text)  from authenticated, anon, public;
