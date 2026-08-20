-- ============================================================
-- StockFlow — 0017_savables_horodatage.sql
-- L'heure de saisie, pour distinguer deux ventes du même jour.
-- ============================================================
--
-- Constaté à l'usage : la liste des ventes ouvrables en SAV affichait sept
-- lignes STRICTEMENT identiques — même date, même client « Anonyme », même
-- produit, même quantité. Choisir revenait à tirer au sort.
--
-- `ventes_savables()` triait déjà sur `v.cree_le` sans jamais le rendre. C'est
-- pourtant la seule information qui sépare deux ventes du même jour au même
-- client : l'exposer suffit.
-- ------------------------------------------------------------
drop function if exists ventes_savables(int);
drop function if exists ventes_savables(int, boolean);   -- arité ajoutée en 0018

create or replace function ventes_savables(p_limite int default 100)
returns table (
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
     -- Un vendeur ne voit que SES ventes. Cette fonction est SECURITY DEFINER :
     -- sans cette clause, elle publierait les clients de tous les collègues.
     where vl.quantite > coalesce(s.deja, 0)
       and (est_admin() or v.vendeur_id = auth.uid())
     order by v.cree_le desc, p.nom
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

grant execute on function ventes_savables(int) to authenticated;
