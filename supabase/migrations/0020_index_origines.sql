-- ============================================================
-- StockFlow — 0020_index_origines.sql
-- Index sur les clés étrangères d'origine de mouvements_stock.
-- ============================================================
-- Les quatre colonnes origine_* n'étaient couvertes par aucun index. Trois
-- conséquences, toutes invisibles tant que la table est petite :
--
--   1. Les recherches directes par origine font un parcours complet.
--      `annuler_vente` (0012) et `revoquer_sav` (0019) suppriment ainsi :
--        delete from mouvements_stock where origine_vente_id = ...;
--        delete from mouvements_stock where origine_sav_id   = ...;
--   2. Les `on delete cascade` de ventes, restock_lignes et sav déclenchent le
--      même parcours à chaque suppression du parent — Postgres n'indexe pas
--      automatiquement le côté enfant d'une clé étrangère.
--   3. Le `on delete set null` de demandes_restock aussi.
--
-- mouvements_stock est le registre : c'est la table qui grossit le plus vite,
-- elle n'est jamais purgée, et le stock entier en est dérivé. C'est donc celle
-- où un parcours complet coûtera le plus cher, et le plus tard.
--
-- Index PARTIELS (`where ... is not null`) : la contrainte mvt_coherence
-- garantit qu'un mouvement porte au plus une origine, donc chaque index ne
-- concerne qu'une fraction des lignes. Un ajustement manuel, qui n'a aucune
-- origine, n'entre dans aucun des quatre.
-- ------------------------------------------------------------

create index if not exists idx_mvt_origine_vente
  on mouvements_stock (origine_vente_id)
  where origine_vente_id is not null;

create index if not exists idx_mvt_origine_restock
  on mouvements_stock (origine_restock_id)
  where origine_restock_id is not null;

create index if not exists idx_mvt_origine_sav
  on mouvements_stock (origine_sav_id)
  where origine_sav_id is not null;

create index if not exists idx_mvt_origine_demande
  on mouvements_stock (origine_demande_id)
  where origine_demande_id is not null;
