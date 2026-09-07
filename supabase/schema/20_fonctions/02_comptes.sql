-- ============================================================
-- StockFlow — Comptes : invitation, rôle, retrait
-- ============================================================
-- Cycle de vie d'un compte, de l'invitation au retrait. Chaque geste qui
-- touche aux droits laisse une trace via `tracer_admin`.
-- ------------------------------------------------------------

-- ============================================================
-- Les sept fonctions de compte laissent une trace.
-- ============================================================
-- Sur les fonctions de compte, seul l'appel à
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

-- ============================================================
-- Retirer une invitation qui n'a pas servi.
-- ============================================================
-- Une invitation reste en base tant qu'aucun compte n'a été créé avec son
-- adresse : c'est ce qui permet de reprendre une création interrompue entre la
-- première et la seconde étape. Mais rien ne permettait de la retirer, et
-- l'écran Vendeurs affichait alors indéfiniment un avertissement sur une
-- invitation devenue sans objet.
--
-- LA GARDE EST PLUS FAIBLE QUE POUR LA CRÉATION, et c'est délibéré.
--
-- `inviter_utilisateur` appelle `exiger_gestion_de(p_role)` : on ne peut
-- inviter qu'un niveau strictement inférieur au sien. Reprendre cette règle
-- ici rendrait une invitation `dev` indestructible — aucun niveau n'est
-- supérieur à 3 — alors que c'est précisément celle de l'amorçage, celle qui
-- traîne le plus souvent.
--
-- L'asymétrie se justifie par ce que chaque geste produit : créer une
-- invitation OUVRE un accès futur, la retirer le FERME. Retirer ne peut donc
-- élever personne, dans aucun scénario. Seule la garde `est_admin()` reste
-- nécessaire, pour qu'un vendeur ne puisse pas saboter l'arrivée d'un collègue.
--
-- Une invitation DÉJÀ CONSOMMÉE est refusée : elle est la trace de l'origine
-- d'un compte, et le trigger d'inscription ne la relit jamais. L'effacer ne
-- libérerait rien et perdrait une information.
-- ------------------------------------------------------------

create or replace function annuler_invitation(p_email text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_util  boolean;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select utilisee into v_util from invitations where email = v_email;
  if not found then
    raise exception 'Invitation introuvable.' using errcode = '02000';
  end if;

  if v_util then
    raise exception
      'Cette invitation a déjà servi à créer un compte : elle ne se retire pas.'
      using errcode = '23514';
  end if;

  delete from invitations where email = v_email;
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
       -- Redondant avec mouvements_stock en pratique — un prélèvement en écrit
       -- toujours un — mais explicite par choix : la clé étrangère est
       -- `restrict`, et sans ce terme la suppression échouerait sur une erreur
       -- brute au lieu de désactiver proprement.
       + (select count(*) from prelevements     where vendeur_id   = p_id)
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

create or replace function comptes_encadrement()
returns table (
  id                 uuid,
  nom                text,
  role               text,
  libelle            text,
  niveau             int,
  actif              boolean,
  mdp_provisoire     boolean,
  stock_lie_entrepot boolean,
  cree_le            timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select p.id, p.nom, p.role, r.libelle, r.niveau, p.actif,
           p.doit_changer_mdp, p.stock_lie_entrepot, p.cree_le
      from profils p
      join roles r on r.cle = p.role
     where r.niveau >= 2
     order by r.niveau desc, p.nom;
end $$;

-- ------------------------------------------------------------
-- Le jeton du lien d'invitation d'un compte, pour le transmettre autrement que
-- par courriel.
--
-- POURQUOI LIRE LE JETON EXISTANT PLUTÔT QUE D'EN FABRIQUER UN. `generateLink`
-- de l'API d'administration REMPLACE le jeton en base : mesuré, le lien déjà
-- parti par courriel devient invalide sans que rien ne le signale, et le
-- vendeur tombe sur « lien invalide » en cliquant. Le jeton stocké est
-- exactement celui que le gabarit d'e-mail place dans `{{ .TokenHash }}` :
-- l'application reconstruit donc LE MÊME lien, et les deux chemins restent
-- valides.
--
-- CE QUE ÇA N'OUVRE PAS. Le jeton vaut une session pour le compte visé, d'où
-- les trois gardes : gérant, `exiger_gestion_de` (donc un niveau strictement
-- inférieur au sien), et compte encore non confirmé. Un gérant qui obtient ce
-- lien pouvait déjà prendre la main sur le même compte par
-- `reinitialiserMotDePasse` : aucun pouvoir nouveau, un aller-retour de moins.
--
-- Le jeton disparaît de lui-même dès que le lien est consommé — vérifié contre
-- GoTrue, pas supposé : la fonction rend alors NULL, et l'écran n'affiche pas
-- de lien mort.
-- ------------------------------------------------------------
create or replace function lien_invitation(p_id uuid)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role  text;
  v_jeton text;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_id;
  if not found then
    raise exception 'Compte inconnu.' using errcode = '22023';
  end if;
  perform exiger_gestion_de(v_role);

  -- `confirmation_token` SEUL fait foi. Mesuré : GoTrue le vide dès que le lien
  -- est consommé, donc un compte qui a servi son invitation rend NULL sans
  -- qu'on ait à interroger une colonne de confirmation. C'est aussi la seule
  -- colonne présente à la fois sur le schéma `auth` de l'image de test et sur
  -- celui, plus récent, de l'instance en service : `email_confirmed_at`
  -- n'existe pas sur le premier.
  select nullif(u.confirmation_token, '')
    into v_jeton
    from auth.users u
   where u.id = p_id;

  return v_jeton;
end $$;
