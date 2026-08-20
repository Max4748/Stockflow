-- ============================================================
-- StockFlow — 0002_catalogue.sql
-- Catalogue produits.
-- ============================================================

create table if not exists produits (
  id                   uuid primary key default gen_random_uuid(),
  nom                  text not null,
  sku                  text,
  -- Prix indicatif proposé au vendeur à la saisie. Le prix RÉELLEMENT
  -- pratiqué est figé par ligne de vente : ce champ n'a aucune valeur
  -- comptable, le modifier ne change aucun historique.
  prix_vente_conseille numeric(10,2) not null default 0 check (prix_vente_conseille >= 0),
  -- Seuil d'alerte de réassort, par produit (un consommable qui tourne vite
  -- n'a pas le même seuil qu'un article de fond de rayon).
  seuil_alerte         integer not null default 3 check (seuil_alerte >= 0),
  actif                boolean not null default true,
  cree_le              timestamptz not null default now()
);

-- Unicité insensible à la casse : « Produit A » et « produit a » sont le même
-- produit. Un `unique` nu laisserait passer le doublon, et deux produits
-- jumeaux fausseraient durablement le coût moyen pondéré.
create unique index if not exists idx_produits_nom on produits (lower(nom));
create unique index if not exists idx_produits_sku on produits (lower(sku))
  where sku is not null;
