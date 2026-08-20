-- ============================================================
-- StockFlow — 0001_socle.sql
-- Comptes, rôles, helpers d'autorisation.
-- ============================================================
-- Rejouable : create if not exists / create or replace partout.

-- Postgres accorde par défaut EXECUTE sur toute nouvelle fonction au rôle
-- PUBLIC. La clé anon étant publique par construction, chaque RPC créée
-- ensuite serait appelable par n'importe qui. On inverse ce défaut AVANT de
-- créer la moindre fonction : les GRANT explicites de 0009 seront la seule
-- porte d'entrée.
alter default privileges in schema public revoke execute on functions from public;

-- Deuxième barrière contre le détournement par table temporaire. Combinée au
-- `set search_path = public, pg_temp` de chaque fonction, elle empêche qu'un
-- rôle crée une fausse table `profils` dans pg_temp pour tromper est_admin().
revoke temporary on database postgres from public;

-- ------------------------------------------------------------
-- Les rôles sont de la DONNÉE, pas du schéma.
--
-- Un enum aurait suffi pour deux rôles, mais une valeur d'enum Postgres ne se
-- supprime pas : renommer ou retirer un niveau devient impossible. Avec une
-- table, ajouter un quatrième niveau demain ne coûte plus une migration.
--
-- `niveau` porte la hiérarchie, et c'est ce qui rend les contrôles triviaux :
-- on ne gère jamais qu'un niveau STRICTEMENT inférieur au sien.
-- ------------------------------------------------------------
create table if not exists roles (
  cle     text primary key,
  libelle text not null,
  niveau  int  not null unique
);

insert into roles (cle, libelle, niveau) values
  ('dev',     'Développeur', 3),
  ('gerant',  'Gérant',      2),
  ('vendeur', 'Vendeur',     1)
on conflict (cle) do update set libelle = excluded.libelle,
                                niveau  = excluded.niveau;

-- ------------------------------------------------------------
-- profils : le rôle vit ICI, jamais dans un claim JWT.
-- Un claim est figé pour la durée du jeton (1 h) : rétrograder ou désactiver
-- un vendeur ne prendrait effet qu'à l'expiration. Une lecture en base est
-- immédiate.
-- ------------------------------------------------------------
create table if not exists profils (
  id                  uuid primary key references auth.users(id) on delete cascade,
  nom                 text not null,
  role                text not null default 'vendeur',
  -- Commission acquise par le vendeur, par unité vendue. Copiée dans la ligne
  -- de vente à l'enregistrement : la modifier ici ne réécrit aucune dette
  -- passée (voir le figeage comptable en 0003).
  commission_unitaire numeric(10,2) not null default 0 check (commission_unitaire >= 0),
  -- Un compte naît INACTIF : aucun accès tant que l'admin ne l'a pas activé.
  -- Toutes les gardes vérifient `actif`, jamais le rôle seul.
  actif               boolean not null default false,
  doit_changer_mdp    boolean not null default false,
  cree_le             timestamptz not null default now()
);

comment on column profils.commission_unitaire is
  'Valeur COURANTE. La valeur historique d''une vente est figée dans vente_lignes.';

-- ------------------------------------------------------------
-- invitations : pré-autorise un email avant sa première connexion.
-- Sans invitation, un compte créé reste actif=false et n'a accès à rien.
-- ------------------------------------------------------------
create table if not exists invitations (
  email               text primary key,
  nom                 text not null,
  role                text not null default 'vendeur',
  commission_unitaire numeric(10,2) not null default 0 check (commission_unitaire >= 0),
  utilisee            boolean not null default false,
  doit_changer_mdp    boolean not null default true,
  cree_le             timestamptz not null default now()
);

-- Clés étrangères posées à part : `create table if not exists` ne les
-- ajouterait pas sur une table déjà créée par une version antérieure.
do $$ begin
  alter table profils add constraint profils_role_fk
    foreign key (role) references roles(cle);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table invitations add constraint invitations_role_fk
    foreign key (role) references roles(cle);
exception when duplicate_object then null; end $$;

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

create or replace function est_actif() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profils where id = auth.uid() and actif
  );
$$;

comment on function est_admin() is
  'Vrai si l''appelant est un admin ACTIF. Le rôle seul ne suffit jamais.';

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function gerer_nouvel_utilisateur();

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
