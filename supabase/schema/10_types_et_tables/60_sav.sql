-- ============================================================
-- StockFlow — SAV
-- ============================================================

-- ------------------------------------------------------------
-- La table.
--
-- `montant_rembourse` porte 0 pour un échange plutôt qu'un NULL : les sommes
-- des agrégats n'ont ainsi aucun cas particulier à traiter.
-- ------------------------------------------------------------
create table if not exists sav (
  id          uuid primary key default gen_random_uuid(),
  vente_id    uuid not null references ventes(id)   on delete cascade,
  produit_id  uuid not null references produits(id) on delete restrict,
  date        date not null default current_date,

  quantite    integer not null check (quantite > 0),
  resolution  text    not null check (resolution in ('echange','remboursement')),
  montant_rembourse numeric(12,2) not null default 0 check (montant_rembourse >= 0),

  -- Obligatoire : six mois plus tard, « SAV » tout court n'explique rien.
  motif       text not null,
  cree_par    uuid references profils(id),
  cree_le     timestamptz not null default now(),

  -- Un échange ne rend pas d'argent, un remboursement en rend. Sans ce CHECK,
  -- un échange à 200 € amputerait le chiffre d'affaires sans laisser de trace
  -- compréhensible.
  constraint sav_coherence check (
    case resolution
      when 'echange'       then montant_rembourse = 0
      when 'remboursement' then montant_rembourse > 0
    end
  )
);

-- ============================================================
-- Le vendeur déclare le SAV : c'est lui qui est face au client.
-- ============================================================
--
-- POURQUOI DEUX RÉGIMES SELON LE DÉNOUEMENT
--
-- Un SAV touche à deux choses qui appartiennent au vendeur lui-même : son stock
-- et sa dette. Les ouvrir toutes les deux sans contrôle reviendrait à le laisser
-- effacer ce qu'il doit et faire disparaître du stock à volonté.
--
--   ÉCHANGE       → effet IMMÉDIAT. Le vendeur a déjà remis l'unité au client
--                   sur le terrain ; refuser de l'écrire ferait mentir son stock
--                   jusqu'à ce qu'un gérant passe. Le risque est assumé et borné :
--                   la quantité ne peut pas dépasser ce que la vente contenait,
--                   le dossier est nominatif, daté, motivé, et il apparaît dans
--                   l'écran SAV du gérant comme dans le journal comptable.
--
--   REMBOURSEMENT → EN ATTENTE. C'est de l'argent, et il diminue la dette de
--                   celui qui le déclare. Aucun effet comptable tant que le
--                   gérant n'a pas tranché — même parcours que les demandes de
--                   réassort, que l'application pratique déjà.
--
-- Un SAV déclaré par un gérant reste validé d'emblée dans les deux cas : il n'a
-- personne au-dessus de lui pour arbitrer.

-- ------------------------------------------------------------
-- Le cycle de vie d'un dossier.
--
-- `valide` par défaut : les dossiers existants ont été saisis par un gérant et
-- ont déjà produit tous leurs effets. Une valeur par défaut différente les
-- neutraliserait rétroactivement.
-- ------------------------------------------------------------
alter table sav
  add column if not exists statut text not null default 'valide',
  add column if not exists motif_refus text,
  add column if not exists traite_le   timestamptz,
  add column if not exists traite_par  uuid references profils(id);

alter table sav drop constraint if exists sav_statut_connu;

alter table sav add constraint sav_statut_connu
  check (statut in ('valide','en_attente','refuse','annule'));

create index if not exists idx_sav_vente   on sav (vente_id);

create index if not exists idx_sav_produit on sav (produit_id);

create index if not exists idx_sav_date    on sav (date desc);

create index if not exists idx_sav_statut on sav (statut)
  where statut = 'en_attente';

-- ------------------------------------------------------------
-- RLS. Un vendeur voit les SAV de SES ventes — il doit pouvoir constater
-- pourquoi sa dette a bougé. L'écriture passe par les RPC, comme partout.
-- ------------------------------------------------------------
alter table sav enable row level security;
