-- ============================================================
-- StockFlow — Ventes et archive des ventes annulées
-- ============================================================

-- ------------------------------------------------------------
-- Ventes.
-- ------------------------------------------------------------
create table if not exists ventes (
  id              uuid primary key default gen_random_uuid(),
  date            date not null default current_date,
  -- `restrict` : on ne supprime pas un vendeur qui a un historique
  -- comptable. La procédure de départ est `actif = false`.
  vendeur_id      uuid not null references profils(id) on delete restrict,
  client          text not null default 'Anonyme',
  quantite_totale integer not null default 0,
  montant_total   numeric(10,2) not null default 0,
  cree_le         timestamptz not null default now()
);

-- Les 3 colonnes figées sont la clé de toute la comptabilité : une écriture
-- passée ne bouge plus jamais. Changer la commission d'un vendeur ou le prix
-- d'un fournisseur demain ne réécrit pas les dettes d'hier.
create table if not exists vente_lignes (
  id                  uuid primary key default gen_random_uuid(),
  vente_id            uuid not null references ventes(id) on delete cascade,
  produit_id          uuid not null references produits(id) on delete restrict,
  quantite            integer not null check (quantite > 0),
  -- Prix réellement pratiqué, par ligne (les produits n'ont pas le même prix).
  prix_vente_unitaire numeric(10,2) not null check (prix_vente_unitaire >= 0),
  -- FIGÉE depuis profils.commission_unitaire à l'instant de la vente.
  commission_unitaire numeric(10,2) not null check (commission_unitaire >= 0),
  -- FIGÉ depuis cout_moyen_pondere() à l'instant de la vente.
  -- ⚠️ Cette colonne est la marge. Elle ne doit JAMAIS être lisible par un
  -- vendeur (voir la RLS de la couche 40 et l'avertissement sur v_lignes_vente).
  cout_unitaire       numeric(10,4) not null check (cout_unitaire >= 0),
  unique (vente_id, produit_id)
);

-- ============================================================
-- Une vente annulée reste visible, marquée comme telle.
-- ============================================================
-- Jusqu'ici l'annulation effaçait la vente : plus rien dans « Mes ventes », ni
-- dans le journal. Le vendeur ne pouvait pas vérifier qu'il avait bien annulé,
-- et le gérant ne voyait aucune trace d'une vente saisie puis reprise.
--
-- ARCHIVE PLUTÔT QUE DRAPEAU, et c'est le choix qui compte.
--
-- La solution évidente est un `ventes.annulee_le` laissé dans la table. Mais
-- 21 fonctions et 2 vues lisent `ventes` ou `vente_lignes` : le chiffre
-- d'affaires, les commissions, la dette, le bilan, les revenus par vendeur, et
-- surtout `cout_moyen_pondere()`, qui déduit les unités sorties. Il aurait
-- fallu ajouter « et non annulée » aux 21, et en oublier une seule aurait
-- faussé une dette ou une marge SANS RIEN SIGNALER.
--
-- Une table d'archive donne le même résultat à l'écran pour un risque nul :
-- les lignes annulées ne sont plus là où les agrégats regardent. Le coût est
-- déplacé sur la LECTURE, où une erreur se voit tout de suite, au lieu de la
-- comptabilité, où elle ne se voit jamais.
--
-- Seul l'EN-TÊTE est archivé : les deux listes de ventes n'affichent que lui,
-- jamais le détail des lignes. Archiver ce qui n'est jamais lu serait de la
-- dette sans usage.
-- ------------------------------------------------------------

create table if not exists ventes_annulees (
  -- L'identifiant D'ORIGINE : c'est lui que les motifs de mouvements citent
  -- (« Annulation vente depuis l'entrepôt · 863c6a12 »), et le conserver est
  -- ce qui permet de relier les deux dans le journal.
  id              uuid primary key,
  date            date        not null,
  vendeur_id      uuid        not null references profils(id) on delete restrict,
  client          text        not null,
  quantite_totale integer     not null,
  montant_total   numeric(12,2) not null,
  cree_le         timestamptz not null,
  annulee_le      timestamptz not null default now(),
  annulee_par     uuid        references profils(id),
  motif           text
);

-- ============================================================
-- Une vente à 0 € n'est pas une vente.
-- ============================================================
-- La contrainte d'origine autorisait `prix_vente_unitaire >= 0`, et le
-- garde-fou applicatif testait `p < 0`. Un champ de prix laissé vide donnait
-- `Number("") === 0`, qui franchissait les deux.
--
-- Ce n'était pas anodin : le chiffre d'affaires restait nul, mais la
-- commission du vendeur, elle, était figée à la ligne. Sa dette
-- (`ca - commissions - versements - remboursements`) passait donc NÉGATIVE,
-- c'est-à-dire que la maison lui devait de l'argent pour une vente qui n'avait
-- rien rapporté. Aucun invariant ne le signalait, `verifier_coherence_stock()`
-- ne regardant que le stock.
--
-- La règle appartient à la base, comme les autres : le contrôle applicatif
-- donne un message propre, la contrainte est ce qui tient. Donner de la
-- marchandise reste possible, mais par un ajustement de stock motivé, où le
-- geste est nommé au lieu d'être déguisé en vente.
-- ------------------------------------------------------------

alter table vente_lignes drop constraint if exists vente_lignes_prix_vente_unitaire_check;

alter table vente_lignes add constraint vente_lignes_prix_vente_unitaire_check
  check (prix_vente_unitaire > 0);

create index if not exists idx_ventes_vendeur on ventes (vendeur_id, date desc);

create index if not exists idx_vente_lignes_produit on vente_lignes (produit_id);

create index if not exists idx_ventes_annulees_vendeur
  on ventes_annulees (vendeur_id, date desc);

alter table ventes           enable row level security;

alter table vente_lignes     enable row level security;

alter table ventes_annulees enable row level security;
