-- ============================================================
-- StockFlow — Journaux : opérations et administration
-- ============================================================
-- Deux journaux, deux publics. `journal_operations` est lisible par
-- l'encadrement et raconte l'activité ; `journal_admin` est réservé au dev et
-- raconte les droits.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Le seul chemin d'écriture.
--
-- Les NOMS sont copiés à côté des identifiants. Les clés étrangères passent à
-- NULL quand un compte est retiré : sans cette copie, la trace de sa
-- suppression perdrait justement le nom de qui a été supprimé.
-- ------------------------------------------------------------
create or replace function tracer_admin(
  p_action text,
  p_cible  uuid default null,
  p_avant  jsonb default null,
  p_apres  jsonb default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into journal_admin (acteur, acteur_nom, cible, cible_nom, action, avant, apres)
  values (
    auth.uid(),
    (select nom from profils where id = auth.uid()),
    p_cible,
    (select nom from profils where id = p_cible),
    p_action, p_avant, p_apres
  );
end $$;

-- ------------------------------------------------------------
-- Le seul chemin d'écriture. Non exposé : appelé uniquement depuis d'autres
-- fonctions `security definer`, comme `tracer_admin`. L'ouvrir permettrait de
-- forger une écriture comptable.
-- ------------------------------------------------------------
create or replace function tracer_operation(
  p_entite    text,
  p_entite_id uuid,
  p_action    text,
  p_libelle   text,
  p_quantite  int     default null,
  p_montant   numeric default null,
  p_detail    jsonb   default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into journal_operations (acteur, acteur_nom, entite, entite_id,
                                  action, libelle, quantite, montant, detail)
  values (auth.uid(),
          (select nom from profils where id = auth.uid()),
          p_entite, p_entite_id, p_action, p_libelle,
          p_quantite, p_montant, p_detail);
end $$;

-- ------------------------------------------------------------
-- Lecture, réservée au dev.
-- ------------------------------------------------------------
create or replace function journal_admin(
  p_du      date default null,
  p_au      date default null,
  p_limite  int  default 100,
  p_offset  int  default 0
)
returns table (
  cree_le    timestamptz,
  acteur     text,
  action     text,
  cible      text,
  avant      jsonb,
  apres      jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  return query
    select j.cree_le,
           coalesce(j.acteur_nom, '(compte retiré)'),
           j.action,
           j.cible_nom,
           j.avant, j.apres
      from journal_admin j
     where (p_du is null or j.cree_le::date >= p_du)
       and (p_au is null or j.cree_le::date <= p_au)
     order by j.cree_le desc
     limit least(greatest(coalesce(p_limite, 100), 1), 500)
    offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ============================================================
-- Le journal comptable montre ce qui a été effacé.
-- ============================================================
-- Le journal comptable réunit les écritures et les opérations qui en effacent.
--
-- Le type est préfixé `op_` (`op_annulation`, `op_correction`,
-- `op_suppression`, `op_révocation`, `op_désactivation`) pour que le filtre de
-- l'écran les distingue des écritures ordinaires : une opération n'est pas une
-- écriture, c'est un geste SUR une écriture.
--
-- Le journal cite `journal_operations`, et une
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
    -- Un prélèvement n'est pas une vente, mais c'est de la marchandise qui
    -- sort contre une dette : l'absenter rendrait un stock décroissant
    -- inexplicable pour l'encadrement.
    select pl.cree_le, pl.cree_le::date, 'prelevement'::text,
           'Prélèvement · ' || pv.nom || ' · ' || pl.quantite || ' × ' || pr.nom,
           pv.nom, pl.quantite, (pl.quantite * pl.prix_unitaire)::numeric(12,2), pl.id
      from prelevements pl
      join produits pr on pr.id = pl.produit_id
      join profils  pv on pv.id = pl.vendeur_id
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
    -- plus. Voir `journal_operations`.
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
