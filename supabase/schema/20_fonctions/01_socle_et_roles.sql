-- ============================================================
-- StockFlow — Socle : identité, rôles, niveaux
-- ============================================================
-- Les primitives que tout le reste appelle. Elles sont `language sql`,
-- donc leur corps est validé à la création : elles ne dépendent que de tables,
-- jamais d'une autre fonction, et c'est ce qui permet de les écrire ici sans
-- ordre imposé.
-- ------------------------------------------------------------

create or replace function est_actif() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profils where id = auth.uid() and actif
  );
$$;

-- ------------------------------------------------------------
-- Helpers d'autorisation.
--
-- `security definer` est indispensable : appelées depuis une policy SUR
-- profils, une lecture normale de profils redéclencherait la policy →
-- récursion infinie. En definer, la fonction lit la table sans repasser par
-- la RLS.
--
-- `stable` permet au planificateur de n'évaluer la fonction qu'une fois par
-- requête au lieu d'une fois par ligne.
-- ------------------------------------------------------------
-- Le NOM est délibérément conservé après l'ajout du niveau `dev` : les 18
-- policies et les 14 gardes de fonctions qui l'appellent signifient désormais
-- « gérant ou au-dessus », sans qu'aucune n'ait été touchée.
create or replace function est_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profils
     where id = auth.uid() and actif and role in ('dev','gerant')
  );
$$;

-- Réservé au propriétaire technique : contrôle d'intégrité, gestion des
-- comptes gérants.
create or replace function est_dev() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profils where id = auth.uid() and actif and role = 'dev'
  );
$$;

-- Niveau de l'appelant, 0 s'il n'est pas authentifié ou pas actif. Sert à la
-- règle « on ne gère qu'un niveau strictement inférieur au sien ».
create or replace function niveau_courant() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select r.niveau from profils p join roles r on r.cle = p.role
     where p.id = auth.uid() and p.actif
  ), 0);
$$;

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
--     (voir l'invitation d'amorçage).
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
-- Création automatique du profil à l'inscription.
-- ------------------------------------------------------------
create or replace function gerer_nouvel_utilisateur()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv invitations;
begin
  select * into v_inv from invitations
   where email = lower(new.email) and not utilisee;

  if found then
    -- Compte invité par l'admin : actif immédiatement, avec ses conditions.
    insert into profils (id, nom, role, commission_unitaire, actif, doit_changer_mdp)
    values (new.id, v_inv.nom, v_inv.role, v_inv.commission_unitaire,
            true, v_inv.doit_changer_mdp)
    on conflict (id) do nothing;

    update invitations set utilisee = true where email = v_inv.email;
  else
    -- Aucune invitation : profil créé mais INACTIF. Volontaire — même si
    -- l'inscription libre était rouverte par erreur, le compte n'accéderait
    -- à rien.
    insert into profils (id, nom, role, commission_unitaire, actif)
    values (new.id, split_part(new.email, '@', 1), 'vendeur', 0, false)
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

-- ------------------------------------------------------------
-- Lever le drapeau de changement de mot de passe.
-- Portée minimale : n'écrit que sa propre ligne, et que cette colonne.
-- ------------------------------------------------------------
create or replace function marquer_mdp_change()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifié.' using errcode = '42501';
  end if;
  update profils set doit_changer_mdp = false where id = auth.uid();
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
