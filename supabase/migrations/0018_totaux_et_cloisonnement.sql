-- ============================================================
-- StockFlow — 0018_totaux_et_cloisonnement.sql
-- Deux constats d'une revue d'interface.
-- ============================================================

-- ------------------------------------------------------------
-- 1. LES TOTAUX DE L'ÉCRAN STOCK, CALCULÉS EN SQL.
--
-- Constaté à l'écran : « Valeur du stock » affichait 775,97 € sur l'écran
-- Stock et 775,96 € sur le Bilan. Un centime, mais deux écrans qui se
-- contredisent.
--
-- Cause : le Bilan somme en SQL des valeurs non arrondies, l'écran Stock
-- sommait en TypeScript des `valeur_totale` déjà arrondies à 2 décimales —
-- trois arrondis additionnés dérivent d'un centime.
--
-- C'est exactement ce que la règle « aucun calcul métier en TypeScript »
-- (docs/architecture.md) existe pour éviter : deux implémentations du même
-- total finissent par diverger.
-- ------------------------------------------------------------
create or replace function totaux_stock()
returns table (
  entrepot   int,
  distribue  int,
  total      int,
  valeur     numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select coalesce(sum(sp.stock_entrepot), 0)::int,
           coalesce(sum(sp.stock_distribue), 0)::int,
           coalesce(sum(sp.stock_total), 0)::int,
           -- Arrondi UNE SEULE FOIS, à la fin, comme bilan_global().
           coalesce(sum(sp.stock_total * cout_moyen_pondere(sp.produit_id)), 0)::numeric(12,2)
      from v_stock_produit sp;
end $$;

grant execute on function totaux_stock() to authenticated;

-- ------------------------------------------------------------
-- 2. CLOISONNER L'ESPACE VENDEUR.
--
-- Constaté à l'écran : un gérant en mode vendeur voyait, sous le titre
-- « Mes SAV », les dossiers de TOUS les vendeurs — et pouvait déclarer un SAV
-- sur la vente d'un collègue depuis son propre espace.
--
-- Ce n'était pas une faille : il en a le droit côté gestion. Mais la bascule de
-- mode promet quelque chose de précis — quand il est en mode vendeur, il EST un
-- vendeur. Deux écrans affichaient la même chose sous deux titres différents.
--
-- Le paramètre ne peut que RESTREINDRE, jamais élargir : pour un vendeur,
-- `est_admin()` vaut déjà faux, le passer à false ne lui ouvre rien. C'est ce
-- qui permet de l'exposer sans risque à un appelant qui choisit sa valeur.
--
-- ⚠️ Ajouter un paramètre change la SIGNATURE : sans le drop de l'ancienne
-- arité, PostgreSQL créerait une surcharge et un appel à un seul argument
-- deviendrait ambigu. Les fichiers d'origine (0016 et 0017) portent le même
-- drop, pour que le rejeu intégral reste possible.
-- ------------------------------------------------------------
drop function if exists dossiers_sav(int);
drop function if exists dossiers_sav(int, boolean);

create or replace function dossiers_sav(
  p_limite      int     default 100,
  p_les_miennes boolean default false
) returns table (
  id            uuid,
  vente_id      uuid,
  date          date,
  statut        text,
  resolution    text,
  quantite      int,
  montant_rembourse numeric(12,2),
  motif         text,
  motif_refus   text,
  produit       text,
  client        text,
  vendeur       text,
  vendeur_id    uuid,
  declare_par   text,
  traite_par    text,
  traite_le     timestamptz,
  cree_le       timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select s.id, s.vente_id, s.date, s.statut, s.resolution, s.quantite,
           s.montant_rembourse, s.motif, s.motif_refus,
           p.nom, v.client, pr.nom, v.vendeur_id,
           coalesce(dp.nom, '—'),
           tp.nom,
           s.traite_le,
           s.cree_le
      from sav s
      join ventes   v  on v.id  = s.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = s.produit_id
      left join profils dp on dp.id = s.cree_par
      left join profils tp on tp.id = s.traite_par
     where v.vendeur_id = auth.uid()
        or (est_admin() and not p_les_miennes)
     -- En attente d'abord : c'est ce qui appelle une décision.
     order by (s.statut = 'en_attente') desc, s.cree_le desc
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

grant execute on function dossiers_sav(int, boolean) to authenticated;

drop function if exists ventes_savables(int);
drop function if exists ventes_savables(int, boolean);

create or replace function ventes_savables(
  p_limite      int     default 100,
  p_les_miennes boolean default false
) returns table (
  vente_id       uuid,
  date           date,
  cree_le        timestamptz,
  client         text,
  vendeur        text,
  vendeur_id     uuid,
  produit_id     uuid,
  produit        text,
  quantite       int,
  deja_en_sav    int,
  restant        int,
  prix_unitaire  numeric(10,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.cree_le, v.client, pr.nom, v.vendeur_id,
           p.id, p.nom,
           vl.quantite,
           coalesce(s.deja, 0)::int,
           (vl.quantite - coalesce(s.deja, 0))::int,
           vl.prix_vente_unitaire
      from vente_lignes vl
      join ventes   v  on v.id  = vl.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = vl.produit_id
      left join (
        select sv.vente_id, sv.produit_id, sum(sv.quantite) as deja
          from sav sv
         where sv.statut in ('valide','en_attente')
         group by sv.vente_id, sv.produit_id
      ) s on s.vente_id = vl.vente_id and s.produit_id = vl.produit_id
     where vl.quantite > coalesce(s.deja, 0)
       -- Un vendeur ne voit que SES ventes. Cette fonction est SECURITY
       -- DEFINER : sans cette clause, elle publierait les clients de tous.
       and (v.vendeur_id = auth.uid() or (est_admin() and not p_les_miennes))
     order by v.cree_le desc, p.nom
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

grant execute on function ventes_savables(int, boolean) to authenticated;
