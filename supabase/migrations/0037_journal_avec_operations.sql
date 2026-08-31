-- ============================================================
-- StockFlow — 0037_journal_avec_operations.sql
-- Le journal comptable montre ce qui a été effacé.
-- ============================================================
-- Corps repris de 0029 : une branche `union all` est ajoutée, rien d'autre.
--
-- Le type est préfixé `op_` (`op_annulation`, `op_correction`,
-- `op_suppression`, `op_révocation`, `op_désactivation`) pour que le filtre de
-- l'écran les distingue des écritures ordinaires : une opération n'est pas une
-- écriture, c'est un geste SUR une écriture.
--
-- Redéfini ICI et non dans 0029 : `journal_operations` naît en 0035, et une
-- fonction ne peut pas lire une table créée après elle à l'installation.
-- ------------------------------------------------------------

create or replace function journal_transactions(
  p_du         date default null,
  p_au         date default null,
  p_type       text default null,
  p_vendeur_id uuid default null,
  p_limite     int  default 100,
  p_offset     int  default 0
) returns table (
  horodatage  timestamptz,
  date_compta date,
  type        text,
  libelle     text,
  vendeur     text,
  quantite    int,
  montant     numeric(12,2),
  reference   uuid
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limite int := least(greatest(coalesce(p_limite, 100), 1), 1000);
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
  with bornes as (
    select coalesce(p_du, '-infinity'::date) as du,
           coalesce(p_au, 'infinity'::date)  as au
  ),
  tout as (
    -- L'identifiant court est CE QUE LES MOTIFS CITENT : sans lui sur la
    -- ligne de vente, « Vente depuis l'entrepôt · 863c6a12 » ne se rattache à
    -- rien de visible. Huit caractères suffisent à l'échelle du journal.
    select v.cree_le, v.date, 'vente'::text,
           'Vente à ' || v.client || ' · ' || left(v.id::text, 8), pr.nom,
           v.quantite_totale, v.montant_total::numeric(12,2), v.id
      from ventes v join profils pr on pr.id = v.vendeur_id
    union all
    -- Les annulées, avec leur propre type : le journal doit montrer qu'une
    -- vente a existé puis a été reprise, sans quoi elle disparaît de
    -- l'historique et le vendeur ne peut pas vérifier son geste.
    select a.annulee_le, a.date, 'vente_annulee'::text,
           'Vente annulée · ' || left(a.id::text, 8) || ' · ' || a.client,
           pr.nom, a.quantite_totale, a.montant_total::numeric(12,2), a.id
      from ventes_annulees a join profils pr on pr.id = a.vendeur_id
    union all
    select r.cree_le, r.date, 'achat'::text,
           'Achat ' || coalesce(r.reference, '(sans référence)'), null::text,
           r.quantite_totale, (r.prix_achat_base + r.frais_port)::numeric(12,2), r.id
      from restocks r
    union all
    select m.cree_le, m.cree_le::date, m.type::text,
           -- Le motif d'abord, le libellé générique en repli.
           coalesce(
             nullif(trim(m.motif), ''),
             case m.type when 'transfert' then 'Transfert vers ' || coalesce(pr.nom, 'entrepôt')
                         else 'Retour depuis un vendeur' end
           ),
           pr.nom, m.quantite, null::numeric(12,2), m.id
      from mouvements_stock m
      left join profils pr on pr.id = m.detenteur_id
     where m.type in ('transfert','retour') and m.quantite > 0
    union all
    select m.cree_le, m.cree_le::date, 'ajustement'::text,
           'Ajustement : ' || coalesce(m.motif, '(sans motif)'),
           coalesce(pr.nom, 'Entrepôt'), m.quantite, null::numeric(12,2), m.id
      from mouvements_stock m
      left join profils pr on pr.id = m.detenteur_id
     where m.type = 'ajustement'
    union all
    select s.cree_le, s.date, 'sav'::text,
           'SAV ' || (case s.resolution when 'echange' then 'échange' else 'remboursement' end)
             || ' — ' || p.nom || ' : ' || s.motif,
           pr.nom, -s.quantite,
           nullif(s.montant_rembourse, 0)::numeric(12,2), s.id
      from sav s
      join ventes   v  on v.id  = s.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = s.produit_id
     where s.statut = 'valide'
    union all
    -- Les opérations qui EFFACENT une écriture. Sans elles, une suppression
    -- change les totaux sans laisser la moindre ligne pour l'expliquer : le
    -- journal est dérivé de l'état courant, donc aveugle à ce qui n'y est
    -- plus. Voir journal_operations, migration 0035.
    select o.cree_le, o.cree_le::date, ('op_' || o.action)::text,
           o.libelle, o.acteur_nom, o.quantite, o.montant, o.entite_id
      from journal_operations o
    union all
    select ver.cree_le, ver.date, 'versement'::text,
           'Versement reçu', pr.nom, null::int, ver.montant::numeric(12,2), ver.id
      from versements ver join profils pr on pr.id = ver.vendeur_id
  )
  select t.*
    from tout t (cree_le, dt, tp, lib, vd, qte, mt, ref)
    cross join bornes b
   where t.dt between b.du and b.au
     and (p_type is null or t.tp = p_type)
     and (p_vendeur_id is null
          or t.vd = (select nom from profils where id = p_vendeur_id))
   order by t.cree_le desc
   limit v_limite offset greatest(coalesce(p_offset, 0), 0);
end $$;
