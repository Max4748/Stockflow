-- ============================================================
-- StockFlow — 0004_mouvements_stock.sql
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
    ('entree_achat','transfert','vente','retour','ajustement');
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

-- ------------------------------------------------------------
-- Vues de stock. FERMÉES à authenticated/anon en 0009 : elles ignorent la
-- notion d'appelant, l'accès public passe par les fonctions à garde.
-- ------------------------------------------------------------
create or replace view v_stock_detenteur as
select detenteur_id, produit_id, sum(quantite)::int as quantite
  from mouvements_stock
 group by detenteur_id, produit_id;

create or replace view v_stock_produit as
select p.id as produit_id, p.nom, p.actif, p.seuil_alerte,
       coalesce(sum(m.quantite) filter (where m.detenteur_id is null), 0)::int     as stock_entrepot,
       coalesce(sum(m.quantite) filter (where m.detenteur_id is not null), 0)::int as stock_distribue,
       coalesce(sum(m.quantite), 0)::int                                           as stock_total
  from produits p
  left join mouvements_stock m on m.produit_id = p.id
 group by p.id, p.nom, p.actif, p.seuil_alerte;

-- ------------------------------------------------------------
-- Lecture d'un stock ponctuel. Existe pour une raison précise : gérer le
-- NULL = entrepôt correctement (`is not distinct from`). Tout code qui
-- écrirait « detenteur_id = p_detenteur_id » compterait 0 pour l'entrepôt.
-- ------------------------------------------------------------
create or replace function stock_detenu(p_produit_id uuid, p_detenteur_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(quantite), 0)::int
    from mouvements_stock
   where produit_id = p_produit_id
     and detenteur_id is not distinct from p_detenteur_id;
$$;

-- ------------------------------------------------------------
-- Verrou de sérialisation.
--
-- Aucune contrainte SQL ne peut interdire un stock agrégé négatif : un CHECK
-- porte sur une ligne, pas sur un sum(). La seule garantie est que tout
-- chemin d'écriture prenne CE verrou AVANT de lire le stock, dans la même
-- transaction. Deux ventes concurrentes du même produit se sérialisent alors
-- au lieu de lire toutes les deux « il en reste 1 ».
--
-- RÈGLE DE REVUE pour tout futur RPC d'écriture, la seule qui compte :
--   prend-il le verrou AVANT de lire le stock ?
--
-- ORDRE DE VERROUILLAGE IMPOSÉ, sous peine d'interblocage intermittent :
--   produits par produit_id croissant, et pour un même produit
--   l'entrepôt (NULL) avant un vendeur.
-- ------------------------------------------------------------
create or replace function verrouiller_stock(p_produit_id uuid, p_detenteur_id uuid)
returns void
language sql security definer set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(
    hashtext(p_produit_id::text || '/' || coalesce(p_detenteur_id::text, 'entrepot'))
  );
$$;

-- ------------------------------------------------------------
-- Coût moyen pondéré GLISSANT (CUMP), par produit.
--
--   coût = (valeur achetée − valeur déjà sortie) / (unités achetées − unités sorties)
--
-- Le CUMP est GLOBAL, pas par détenteur : le coût d'achat est une propriété
-- de la marchandise, pas de qui la détient. Un transfert admin → vendeur
-- n'est pas une vente et ne doit donc rien revaloriser.
--
-- Conséquence à savoir énoncer au patron : la marge PAR VENTE est lissée (un
-- vendeur qui écoule du vieux stock bon marché est valorisé au CUMP courant).
-- La marge GLOBALE et PAR PÉRIODE restent exactes au centime. C'est la
-- nature du CUMP, pas un défaut d'implémentation.
--
-- EXECUTE est révoquée à tout le monde en 0009 : cette fonction donne le prix
-- d'achat, qu'un vendeur ne doit jamais pouvoir calculer.
-- ------------------------------------------------------------
create or replace function cout_moyen_pondere(p_produit_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_qte_achetee   int     := 0;
  v_val_achetee   numeric := 0;
  v_qte_sortie    int     := 0;
  v_val_sortie    numeric := 0;
  v_reste         int;
  v_dernier_prix  numeric;
begin
  select coalesce(sum(rl.quantite), 0),
         coalesce(sum(rl.quantite * r.prix_achat_unitaire), 0)
    into v_qte_achetee, v_val_achetee
    from restock_lignes rl
    join restocks r on r.id = rl.restock_id
   where rl.produit_id = p_produit_id;

  select coalesce(sum(vl.quantite), 0),
         coalesce(sum(vl.quantite * vl.cout_unitaire), 0)
    into v_qte_sortie, v_val_sortie
    from vente_lignes vl
   where vl.produit_id = p_produit_id;

  v_reste := v_qte_achetee - v_qte_sortie;

  if v_reste > 0 then
    return round((v_val_achetee - v_val_sortie) / v_reste, 4);
  end if;

  -- Stock épuisé (ou jamais acheté) : on se replie sur le dernier prix
  -- d'achat connu. Sans ce repli, une vente juste après épuisement figerait
  -- un coût de 0 et afficherait une marge de 100 %.
  select r.prix_achat_unitaire into v_dernier_prix
    from restock_lignes rl
    join restocks r on r.id = rl.restock_id
   where rl.produit_id = p_produit_id
   order by r.date desc, r.cree_le desc
   limit 1;

  return coalesce(v_dernier_prix, 0);
end $$;
