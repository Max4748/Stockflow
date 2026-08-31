-- ============================================================
-- StockFlow — 0033_ip_bloquees.sql
-- Blocage d'adresse IP : persistant, croissant, jamais définitif d'office.
-- ============================================================
-- Les deux premiers paliers de l'anti-bourrage vivent en mémoire du processus
-- Next : ils ne font que ralentir, et un attaquant ne provoque pas de
-- redémarrage. Le troisième, lui, doit survivre à `docker compose up --build`,
-- qui a lieu plusieurs fois par jour. D'où la base.
--
-- DÉCLENCHEUR : cinq adresses e-mail DISTINCTES échouées depuis la même IP.
-- Pas « beaucoup d'échecs ». Bloquer une IP bloque tout le monde derrière
-- elle, or les vendeurs sont sur téléphone, donc derrière le NAT d'un
-- opérateur. Compter les échecs mettrait un vendeur dehors parce qu'un inconnu
-- du même opérateur a tapé à côté. Compter les adresses essayées est la
-- signature du bourrage d'identifiants, qu'un utilisateur légitime ne peut pas
-- produire : il n'a qu'une adresse.
--
-- DURÉE CROISSANTE, jamais définitive d'office. Une IP n'est pas une identité :
-- les adresses résidentielles changent au redémarrage de la box, celles des
-- opérateurs mobiles tournent en permanence. Celle qui attaque aujourd'hui
-- appartiendra à quelqu'un d'autre dans trois semaines, et un blocage définitif
-- accumulerait des interdictions sur des adresses redevenues légitimes. La
-- panne arriverait des mois plus tard, silencieuse.
--
--   1ʳᵉ fois  15 minutes      3ᵉ fois  24 heures
--   2ᵉ fois    1 heure        4ᵉ et +   7 jours
--
-- Une adresse réellement hostile finit à sept jours renouvelés, ce qui équivaut
-- à un blocage. Une adresse recyclée se libère seule.
--
-- Le définitif existe, mais comme GESTE HUMAIN : `bloquer_ip_definitivement()`,
-- déclenchée depuis l'écran, visible et réversible.
-- ------------------------------------------------------------

create table if not exists ip_bloquees (
  ip         text primary key,
  bloquee_le timestamptz not null default now(),
  -- NULL = définitif, posé à la main. Toute valeur non nulle est une échéance
  -- que `ip_est_bloquee` fait respecter sans intervention.
  jusqu_a    timestamptz,
  recidive   int not null default 1 check (recidive > 0),
  motif      text,
  posee_par  uuid references profils(id) on delete set null
);

comment on table ip_bloquees is
  'Palier 3 de l''anti-bourrage. jusqu_a NULL = blocage définitif, posé à la main.';

alter table ip_bloquees enable row level security;

drop policy if exists ip_bloquees_select on ip_bloquees;
create policy ip_bloquees_select on ip_bloquees
  for select using (est_dev());

grant select on ip_bloquees to authenticated;
revoke insert, update, delete on ip_bloquees from authenticated, anon;

-- ------------------------------------------------------------
-- L'IP est-elle bloquée ?
--
-- Appelée à CHAQUE tentative de connexion, donc avant toute authentification :
-- elle ne peut pas exiger de session. C'est aussi pourquoi elle ne renvoie
-- qu'un booléen et rien d'autre : elle ne doit renseigner personne.
-- ------------------------------------------------------------
create or replace function ip_est_bloquee(p_ip text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from ip_bloquees
     where ip = p_ip and (jusqu_a is null or jusqu_a > now())
  );
$$;

grant execute on function ip_est_bloquee(text) to authenticated, anon;

-- ------------------------------------------------------------
-- Poser ou prolonger un blocage automatique.
--
-- Appelée par la Server Action au franchissement du seuil, donc sans session :
-- aucune garde de rôle n'est possible ici. Ce qui la protège, c'est qu'elle ne
-- sait faire qu'une chose, bornée dans le temps, et que le déclencheur vit
-- côté application. Le pire qu'un appelant puisse en tirer est de se bloquer
-- lui-même.
-- ------------------------------------------------------------
create or replace function bloquer_ip(p_ip text, p_motif text default null)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_recidive int;
  v_duree    interval;
  v_jusqu_a  timestamptz;
begin
  if p_ip is null or trim(p_ip) = '' then
    raise exception 'Adresse IP manquante.' using errcode = '22023';
  end if;

  select recidive + 1 into v_recidive from ip_bloquees where ip = p_ip;
  v_recidive := coalesce(v_recidive, 1);

  v_duree := case
               when v_recidive >= 4 then interval '7 days'
               when v_recidive = 3  then interval '24 hours'
               when v_recidive = 2  then interval '1 hour'
               else interval '15 minutes'
             end;
  v_jusqu_a := now() + v_duree;

  insert into ip_bloquees (ip, bloquee_le, jusqu_a, recidive, motif)
  values (p_ip, now(), v_jusqu_a, v_recidive, p_motif)
  on conflict (ip) do update
    set bloquee_le = now(),
        jusqu_a    = excluded.jusqu_a,
        recidive   = excluded.recidive,
        motif      = excluded.motif,
        -- Un blocage manuel n'est pas réduit par un blocage automatique.
        posee_par  = null
   where ip_bloquees.jusqu_a is not null;

  return v_jusqu_a;
end $$;

grant execute on function bloquer_ip(text, text) to authenticated, anon;

-- ------------------------------------------------------------
-- Les deux gestes humains, réservés au dev.
-- ------------------------------------------------------------
create or replace function bloquer_ip_definitivement(p_ip text, p_motif text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_motif, '')), '') is null then
    raise exception 'Un motif est obligatoire pour un blocage définitif.'
      using errcode = '23514';
  end if;

  insert into ip_bloquees (ip, jusqu_a, motif, posee_par)
  values (p_ip, null, trim(p_motif), auth.uid())
  on conflict (ip) do update
    set jusqu_a = null, motif = excluded.motif, posee_par = auth.uid();

  perform tracer_admin('blocage IP définitif', null, null,
    jsonb_build_object('ip', p_ip, 'motif', trim(p_motif)));
end $$;

create or replace function lever_blocage_ip(p_ip text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  delete from ip_bloquees where ip = p_ip;

  perform tracer_admin('levée de blocage IP', null,
    jsonb_build_object('ip', p_ip), null);
end $$;

grant execute on function bloquer_ip_definitivement(text, text) to authenticated;
grant execute on function lever_blocage_ip(text) to authenticated;

-- ------------------------------------------------------------
-- Lecture pour l'écran.
-- ------------------------------------------------------------
create or replace function ip_bloquees_actives()
returns table (
  ip         text,
  bloquee_le timestamptz,
  jusqu_a    timestamptz,
  recidive   int,
  motif      text,
  definitif  boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  return query
    select b.ip, b.bloquee_le, b.jusqu_a, b.recidive, b.motif,
           (b.jusqu_a is null)
      from ip_bloquees b
     where b.jusqu_a is null or b.jusqu_a > now()
     order by b.bloquee_le desc;
end $$;

grant execute on function ip_bloquees_actives() to authenticated;
