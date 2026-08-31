-- ============================================================
-- StockFlow — 0032_tracer_comptes.sql
-- Les sept fonctions de compte laissent une trace.
-- ============================================================
-- Corps repris tels quels de 0011, 0024 et 0025 : seul l'appel à
-- `tracer_admin()` est ajouté. Les recopier en entier est le prix du
-- `create or replace`, qui ne sait pas insérer une ligne dans un corps
-- existant.
--
-- Chaque appel est APRÈS l'écriture et DANS la même transaction : une action
-- refusée plus haut n'écrit donc aucune trace, et une trace qui échoue annule
-- l'action. La valeur `avant` est relevée AVANT l'`update`, faute de quoi elle
-- n'existe plus.
--
-- La septième, `retirer_compte`, est plus bas : elle a deux dénouements et
-- doit dire lequel a eu lieu.
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

  -- Pas de cible : le compte n'existe pas encore, c'est justement l'objet de
  -- l'invitation. L'adresse tient lieu d'identité dans la trace.
  perform tracer_admin('invitation', null, null,
    jsonb_build_object('email', v_email, 'role', p_role,
                       'commission', p_commission));
end $$;

create or replace function modifier_compte(
  p_id         uuid,
  p_nom        text,
  p_commission numeric
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role  text;
  v_avant jsonb;
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

  -- AVANT l'update : après, l'ancienne valeur n'existe plus nulle part.
  select jsonb_build_object('nom', nom, 'commission', commission_unitaire)
    into v_avant from profils where id = p_id;

  update profils
     set nom = trim(p_nom), commission_unitaire = p_commission
   where id = p_id;

  perform tracer_admin('modification', p_id, v_avant,
    jsonb_build_object('nom', trim(p_nom), 'commission', p_commission));
end $$;

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

  perform tracer_admin('mot de passe à changer', p_id, null, null);
end $$;

create or replace function changer_actif(p_id uuid, p_actif boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role  text;
  v_avant jsonb;
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

  select jsonb_build_object('actif', actif) into v_avant
    from profils where id = p_id;

  update profils set actif = coalesce(p_actif, false) where id = p_id;

  perform tracer_admin(
    case when coalesce(p_actif, false) then 'réactivation' else 'désactivation' end,
    p_id, v_avant, jsonb_build_object('actif', coalesce(p_actif, false)));
end $$;

create or replace function changer_role(p_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ancien text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_id = auth.uid() then
    raise exception 'On ne change pas son propre rôle.' using errcode = '42501';
  end if;

  select role into v_ancien from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;

  -- L'ANCIEN et le NOUVEAU rôle doivent être strictement sous l'appelant :
  -- sans le premier contrôle, un gérant rétrograderait un dev.
  perform exiger_gestion_de(v_ancien);
  perform exiger_gestion_de(p_role);

  update profils
     set role = p_role,
         stock_lie_entrepot = case when p_role = 'vendeur' then false
                                   else stock_lie_entrepot end
   where id = p_id;

  perform tracer_admin('changement de rôle', p_id,
    jsonb_build_object('role', v_ancien),
    jsonb_build_object('role', p_role));
end $$;

create or replace function changer_stock_lie(p_id uuid, p_lie boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role  text;
  v_avant jsonb;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;

  if v_role = 'vendeur' then
    raise exception
      'Un vendeur n''a pas accès à l''entrepôt : ce réglage ne concerne que l''encadrement.'
      using errcode = '23514';
  end if;

  -- Se régler soi-même est LÉGITIME ici, contrairement au rôle ou à
  -- l'activation : le gérant qui héberge l'entrepôt est le mieux placé pour
  -- le déclarer, et le réglage ne lui donne aucun droit qu'il n'a pas déjà.
  -- Un gérant ne règle en revanche pas un dev.
  if p_id <> auth.uid() then
    perform exiger_gestion_de(v_role);
  end if;

  select jsonb_build_object('stock_lie_entrepot', stock_lie_entrepot) into v_avant
    from profils where id = p_id;

  update profils set stock_lie_entrepot = coalesce(p_lie, false) where id = p_id;

  perform tracer_admin('lien entrepôt', p_id, v_avant,
    jsonb_build_object('stock_lie_entrepot', coalesce(p_lie, false)));
end $$;


-- ------------------------------------------------------------
-- `retirer_compte` : deux dénouements, deux traces distinctes.
-- ------------------------------------------------------------
create or replace function retirer_compte(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nom   text;
  v_role  text;
  v_actif boolean;
  v_refs  int;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;

  -- Se retirer soi-même verrouillerait la maison, éventuellement sans
  -- personne pour rouvrir. Même refus que dans `changer_actif`.
  if p_id = auth.uid() then
    raise exception 'On ne retire pas son propre compte.' using errcode = '42501';
  end if;

  select nom, role, actif into v_nom, v_role, v_actif from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;

  -- « On ne gère qu'un niveau strictement inférieur au sien » : un gérant ne
  -- retire pas un autre gérant, et personne ne retire un dev.
  perform exiger_gestion_de(v_role);

  select (select count(*) from ventes           where vendeur_id  = p_id)
       + (select count(*) from mouvements_stock where detenteur_id = p_id)
       + (select count(*) from mouvements_stock where cree_par     = p_id)
       + (select count(*) from versements       where vendeur_id   = p_id)
       + (select count(*) from versements       where cree_par     = p_id)
       + (select count(*) from demandes_restock where vendeur_id   = p_id)
       + (select count(*) from demandes_restock where traitee_par  = p_id)
       + (select count(*) from restocks         where cree_par     = p_id)
       + (select count(*) from sav              where cree_par     = p_id)
       + (select count(*) from sav              where traite_par   = p_id)
    into v_refs;

  if v_refs = 0 then
    -- La trace AVANT la suppression : `journal_admin.cible` passe à NULL par
    -- `on delete set null`, et c'est `cible_nom`, copié par `tracer_admin`,
    -- qui garde le nom de qui a disparu.
    perform tracer_admin('suppression de compte', p_id,
      jsonb_build_object('nom', v_nom, 'role', v_role, 'actif', v_actif), null);

    delete from auth.users where id = p_id;
    return format('%s a été supprimé : ce compte n''avait aucun historique.', v_nom);
  end if;

  if not v_actif then
    return format('%s est déjà désactivé. Son historique interdit de le supprimer.', v_nom);
  end if;

  -- `changer_actif` trace déjà la désactivation. On ajoute la trace du GESTE,
  -- qui n'est pas le même : « retirer » a choisi de désactiver faute de
  -- pouvoir supprimer, et c'est cette décision qu'on veut relire.
  perform changer_actif(p_id, false);
  perform tracer_admin('retrait de compte, désactivé', p_id,
    jsonb_build_object('references', v_refs), null);

  return format(
    '%s a un historique : le compte est DÉSACTIVÉ plutôt que supprimé. Il perd tout accès immédiatement, sa comptabilité et son stock détenu restent intacts.',
    v_nom);
end $$;
