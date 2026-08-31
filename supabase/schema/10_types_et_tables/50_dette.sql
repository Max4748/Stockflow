-- ============================================================
-- StockFlow — Versements
-- ============================================================

-- ------------------------------------------------------------
-- Versements : le vendeur reverse à l'admin ce qu'il lui doit.
-- ------------------------------------------------------------
create table if not exists versements (
  id         uuid primary key default gen_random_uuid(),
  date       date not null default current_date,
  vendeur_id uuid not null references profils(id) on delete restrict,
  montant    numeric(10,2) not null check (montant > 0),
  note       text,
  cree_par   uuid references profils(id),
  cree_le    timestamptz not null default now()
);

create index if not exists idx_versements_vendeur on versements (vendeur_id, date desc);

alter table versements       enable row level security;
