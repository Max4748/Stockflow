-- ============================================================
-- StockFlow — Registre des mouvements de stock
-- ============================================================

-- ============================================================
-- LE REGISTRE. Pièce dont tout le reste dépend.
-- ============================================================
--
-- Le stock n'est JAMAIS une colonne mutable : il est dérivé par somme des
-- mouvements. Deux raisons :
--
--   1. Le cahier des charges exige un « historique détaillé des
--      transactions ». Il faut donc un journal de toute façon. Entretenir en
--      plus une colonne `quantite` créerait deux vérités, qui divergeront le
--      jour où une écriture échouera à mi-chemin.
--   2. Un stock dérivé ne peut pas être « réparé » à tort. Une incohérence
--      devient visible au lieu d'être écrasée.
--
-- Contrepartie assumée : l'agrégat coûte une somme. Les index couvrants
-- ci-dessous la rendent quasi gratuite (index-only scan). Le point de
-- bascule est vers le million de lignes ; la réponse sera alors un snapshot
-- mensuel, PAS une colonne `quantite`.

do $$ begin
  create type type_mouvement as enum
    ('entree_achat','transfert','vente','retour','ajustement','sav');
exception when duplicate_object then null; end $$;

create table if not exists mouvements_stock (
  id           uuid primary key default gen_random_uuid(),
  produit_id   uuid not null references produits(id) on delete restrict,

  -- NULL = entrepôt admin. Choix délibéré, contre l'alternative « le profil
  -- admin détient le stock central » :
  --   • l'entrepôt n'est pas une personne — changer de patron ne doit pas
  --     déplacer le stock ;
  --   • surtout, la policy « detenteur_id = auth.uid() » exclut alors
  --     GRATUITEMENT les lignes d'entrepôt du champ de vision d'un vendeur,
  --     puisque « NULL = uuid » n'est jamais vrai. L'isolation est obtenue
  --     par la logique SQL à trois valeurs, pas par une condition à maintenir.
  -- Piège corollaire, à ne jamais oublier : toute comparaison de détenteur
  -- doit utiliser `is not distinct from`, car « detenteur_id = NULL » est
  -- toujours NULL. C'est pourquoi stock_detenu() existe.
  detenteur_id uuid references profils(id) on delete restrict,

  -- Quantité SIGNÉE : positive = entrée chez le détenteur, négative = sortie.
  quantite     integer not null check (quantite <> 0),
  type         type_mouvement not null,

  -- Apparie les 2 jambes d'un déplacement (−source / +destination).
  groupe_id    uuid,

  origine_vente_id   uuid references ventes(id)         on delete cascade,
  origine_restock_id uuid references restock_lignes(id) on delete cascade,
  origine_demande_id uuid references demandes_restock(id) on delete set null,

  motif        text,
  cree_par     uuid references profils(id),
  cree_le      timestamptz not null default now(),

  -- Cohérence par type de mouvement. Ne remplace pas les RPC, mais attrape
  -- une écriture manuelle malformée passée en psql.
  constraint mvt_coherence check (
    case type
      -- Un achat entre forcément à l'entrepôt, en positif, et vient d'une
      -- ligne d'achat identifiée.
      when 'entree_achat' then
        detenteur_id is null and quantite > 0 and origine_restock_id is not null
      -- Une vente sort forcément du stock d'un vendeur nommé, en négatif.
      when 'vente' then
        detenteur_id is not null and quantite < 0 and origine_vente_id is not null
      -- Déplacements : 2 jambes appariées.
      when 'transfert' then groupe_id is not null
      when 'retour'    then groupe_id is not null
      -- Un ajustement modifie le stock sans contrepartie : le motif est
      -- obligatoire, sinon l'écart devient inexplicable 6 mois plus tard.
      when 'ajustement' then motif is not null
    end
  )
);

-- Le mouvement d'un échange pointe sur son SAV : supprimer le SAV rend
-- l'unité au stock, exactement comme l'annulation d'une vente.
alter table mouvements_stock
  add column if not exists origine_sav_id uuid references sav(id) on delete cascade;

-- La contrainte de cohérence par type doit connaître le nouveau cas. Elle est
-- reconstruite en entier plutôt que complétée : une contrainte partielle serait
-- pire que pas de contrainte du tout.
alter table mouvements_stock drop constraint if exists mvt_coherence;

alter table mouvements_stock add constraint mvt_coherence check (
  case type
    when 'entree_achat' then
      detenteur_id is null and quantite > 0 and origine_restock_id is not null
    when 'vente' then
      detenteur_id is not null and quantite < 0 and origine_vente_id is not null
    when 'transfert' then groupe_id is not null
    when 'retour'    then groupe_id is not null
    when 'ajustement' then motif is not null
    -- Un SAV ne fait que SORTIR de la marchandise, et toujours au titre d'un
    -- dossier identifié.
    when 'sav' then quantite < 0 and origine_sav_id is not null
  end
);

-- Index COUVRANTS (`include (quantite)`) : la somme se lit dans l'index sans
-- toucher la table. C'est ce qui rend le stock dérivé viable.
create index if not exists idx_mvt_detenteur
  on mouvements_stock (detenteur_id, produit_id) include (quantite);

create index if not exists idx_mvt_produit
  on mouvements_stock (produit_id) include (quantite);

create index if not exists idx_mvt_cree_le
  on mouvements_stock (cree_le desc);

create index if not exists idx_mvt_groupe
  on mouvements_stock (groupe_id) where groupe_id is not null;

-- ============================================================
-- Index sur les clés étrangères d'origine de mouvements_stock.
-- ============================================================
-- Les quatre colonnes origine_* n'étaient couvertes par aucun index. Trois
-- conséquences, toutes invisibles tant que la table est petite :
--
--   1. Les recherches directes par origine font un parcours complet.
--      `annuler_vente` et `revoquer_sav` suppriment ainsi :
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

alter table mouvements_stock enable row level security;
