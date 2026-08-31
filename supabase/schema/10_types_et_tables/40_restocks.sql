-- ============================================================
-- StockFlow — Réassorts : demandes et achats
-- ============================================================

-- ============================================================
-- DDL pure des écritures. Aucune fonction ici : le registre de mouvements
-- `mouvements_stock` référence ces 4 tables, on les déclare donc toutes d'abord pour
-- pouvoir poser ses clés étrangères et ses CHECK multi-colonnes d'un bloc.
-- ============================================================

-- ------------------------------------------------------------
-- Achats fournisseur. Alimentent l'entrepôt admin, jamais un vendeur.
-- ------------------------------------------------------------
create table if not exists restocks (
  id                   uuid primary key default gen_random_uuid(),
  date                 date not null default current_date,
  reference            text,
  quantite_totale      integer not null check (quantite_totale > 0),
  prix_achat_base      numeric(10,2) not null check (prix_achat_base >= 0),
  frais_port           numeric(10,2) not null default 0 check (frais_port >= 0),
  -- Coût de revient réel à l'unité : (prix + port) / quantité. Calculé une
  -- fois à l'achat et figé. 4 décimales parce qu'une division par 250 unités
  -- ne tombe pas juste au centime, et arrondir ici décalerait la marge.
  prix_achat_unitaire  numeric(10,4) not null check (prix_achat_unitaire >= 0),
  cree_par             uuid references profils(id),
  cree_le              timestamptz not null default now()
);

create table if not exists restock_lignes (
  id         uuid primary key default gen_random_uuid(),
  restock_id uuid not null references restocks(id) on delete cascade,
  produit_id uuid not null references produits(id) on delete restrict,
  quantite   integer not null check (quantite > 0),
  unique (restock_id, produit_id)
);

-- ------------------------------------------------------------
-- Demandes de réassort : le vendeur demande, l'admin arbitre.
-- ------------------------------------------------------------
do $$ begin
  create type statut_demande as enum
    ('en_attente','approuvee','partielle','refusee','annulee');
exception when duplicate_object then null; end $$;

create table if not exists demandes_restock (
  id          uuid primary key default gen_random_uuid(),
  vendeur_id  uuid not null references profils(id) on delete restrict,
  statut      statut_demande not null default 'en_attente',
  note        text,
  motif_refus text,
  cree_le     timestamptz not null default now(),
  traitee_le  timestamptz,
  traitee_par uuid references profils(id),
  -- Une demande traitée porte forcément une date et un auteur de traitement.
  constraint demande_traitement_coherent check (
    (statut = 'en_attente' and traitee_le is null and traitee_par is null)
    or (statut = 'annulee')
    or (statut in ('approuvee','partielle','refusee')
        and traitee_le is not null and traitee_par is not null)
  )
);

create table if not exists demande_lignes (
  id                 uuid primary key default gen_random_uuid(),
  demande_id         uuid not null references demandes_restock(id) on delete cascade,
  produit_id         uuid not null references produits(id) on delete restrict,
  quantite_demandee  integer not null check (quantite_demandee > 0),
  -- Renseignée au traitement. Permet l'approbation PARTIELLE : l'admin
  -- accorde ce qu'il a en stock sans refuser toute la demande.
  quantite_accordee  integer not null default 0 check (quantite_accordee >= 0),
  constraint accordee_max_demandee check (quantite_accordee <= quantite_demandee),
  unique (demande_id, produit_id)
);

-- Une seule demande en attente par vendeur : c'est la traduction de « pas de
-- modification après envoi » (il annule et refait plutôt qu'il n'empile).
-- Opinionné : si l'usage réel veut plusieurs demandes en parallèle, supprimer
-- cet index suffit — rien d'autre n'en dépend, le contrôle de stock ayant
-- lieu au traitement et non à la création.
create unique index if not exists idx_demande_une_seule_en_attente
  on demandes_restock (vendeur_id) where statut = 'en_attente';

create index if not exists idx_demandes_attente
  on demandes_restock (cree_le) where statut = 'en_attente';

alter table restocks         enable row level security;

alter table restock_lignes   enable row level security;

alter table demandes_restock enable row level security;

alter table demande_lignes   enable row level security;
