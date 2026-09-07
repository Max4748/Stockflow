-- ============================================================
-- StockFlow — Prélèvements personnels
-- ============================================================
-- Un vendeur repart avec de la marchandise pour lui, à un prix convenu. Il n'a
-- encaissé aucun client : il DOIT donc ce prix à la maison, exactement comme le
-- reliquat d'une vente. `v_comptes_vendeurs` l'ajoute à `reste_a_verser`.
--
-- CE N'EST PAS UNE VENTE, et c'est pour ça que ces lignes ne vivent pas dans
-- `ventes`. Le chiffre d'affaires doit rester ce que des clients ont payé :
-- mélanger la consommation interne fausserait le CA, la marge, et le nombre de
-- ventes affiché à tout le monde. La dette, elle, ne fait pas la différence —
-- de l'argent dû est de l'argent dû.
--
-- LE PRIX EST UN COUPLE (vendeur, produit). Le prix par défaut vaut
-- `prix_vente_conseille - commission_unitaire` : c'est très exactement ce qu'un
-- vendeur devrait à la maison s'il avait vendu l'unité au prix conseillé. Un
-- prélèvement au tarif par défaut ne lui coûte donc ni plus ni moins que de
-- vendre puis racheter. `prix_preleve()` calcule ce repli ; la table ci-dessous
-- ne contient QUE les exceptions.
-- ------------------------------------------------------------

create table if not exists prix_preleves (
  vendeur_id uuid not null references profils(id) on delete cascade,
  produit_id uuid not null references produits(id) on delete cascade,
  prix       numeric(10,2) not null check (prix >= 0),
  defini_le  timestamptz not null default now(),
  defini_par uuid references profils(id) on delete set null,
  primary key (vendeur_id, produit_id)
);

comment on table prix_preleves is
  'Exceptions au tarif de prélèvement. Sans ligne, le repli est prix_vente_conseille - commission_unitaire.';

-- `restrict` sur le produit, comme `vente_lignes` : un produit qui a été
-- prélevé porte une trace comptable, le supprimer effacerait la contrepartie
-- d'une dette. `retirer_produit()` le désactive alors au lieu de le supprimer.
create table if not exists prelevements (
  id            uuid primary key default gen_random_uuid(),
  vendeur_id    uuid not null references profils(id) on delete restrict,
  produit_id    uuid not null references produits(id) on delete restrict,
  quantite      int not null check (quantite > 0),
  -- Figé à la prise, comme la commission d'une vente : changer le tarif plus
  -- tard ne doit pas réécrire une dette déjà constituée.
  prix_unitaire numeric(10,2) not null check (prix_unitaire >= 0),
  cree_le       timestamptz not null default now(),
  cree_par      uuid references profils(id) on delete set null
);

comment on table prelevements is
  'Marchandise reprise par un vendeur pour lui-même. Pèse sur sa dette, jamais sur le chiffre d''affaires.';

create index if not exists prelevements_vendeur_idx on prelevements (vendeur_id, cree_le desc);
create index if not exists prelevements_produit_idx on prelevements (produit_id);

alter table prix_preleves enable row level security;
alter table prelevements  enable row level security;
