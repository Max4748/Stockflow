-- ============================================================
-- StockFlow — 0008_lectures.sql
-- Lectures : stock, tableau de bord, journal comptable.
-- ============================================================
-- Toutes les agrégations sont faites en SQL. PostgREST tronque à
-- PGRST_DB_MAX_ROWS (1000) : un total reconstitué côté client depuis une
-- réponse tronquée serait FAUX SANS AUCUNE ERREUR.

-- ------------------------------------------------------------
-- Lignes de vente visibles par un vendeur.
--
-- ⚠️⚠️ NE JAMAIS AJOUTER cout_unitaire NI AUCUN CALCUL DE MARGE ICI. ⚠️⚠️
-- Cette vue est le seul accès des vendeurs au détail de leurs ventes. Y
-- ajouter une colonne de coût livrerait la marge de l'entreprise à tous les
-- vendeurs, sans erreur, sans alerte et sans que rien ne casse.
-- ------------------------------------------------------------
create or replace view v_lignes_vente as
select vl.id, vl.vente_id, v.vendeur_id, v.date, v.client,
       vl.produit_id, p.nom as produit,
       vl.quantite, vl.prix_vente_unitaire,
       vl.commission_unitaire,
       (vl.quantite * vl.prix_vente_unitaire)::numeric(12,2) as montant_ligne,
       (vl.quantite * vl.commission_unitaire)::numeric(12,2) as commission_ligne
  from vente_lignes vl
  join ventes   v on v.id = vl.vente_id
  join produits p on p.id = vl.produit_id
 -- Filtre INDISPENSABLE : cette vue appartient à postgres et contourne donc
 -- la RLS de vente_lignes. Sans cette clause, un vendeur lirait le détail des
 -- ventes de tous ses collègues. Ce n'est pas une commodité, c'est la seule
 -- barrière d'isolation de la vue.
 where v.vendeur_id = auth.uid() or est_admin();

-- ------------------------------------------------------------
-- Stock du vendeur connecté. Quantités seulement, aucune valorisation.
-- ------------------------------------------------------------
create or replace function stock_disponible()
returns table (produit_id uuid, produit text, quantite int, seuil_alerte int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select p.id, p.nom,
           coalesce(s.quantite, 0)::int,
           p.seuil_alerte
      from produits p
      left join v_stock_detenteur s
             on s.produit_id = p.id and s.detenteur_id = auth.uid()
     where p.actif or coalesce(s.quantite, 0) <> 0
     order by p.nom;
end $$;

-- ------------------------------------------------------------
-- Stock de l'entrepôt, en quantités nues, lisible par un vendeur.
--
-- Arbitrage assumé : sans cette information, un vendeur demande des réassorts
-- impossibles et l'admin refuse en boucle. Il voit des quantités, jamais une
-- valeur ni un coût.
-- ------------------------------------------------------------
create or replace function stock_entrepot()
returns table (produit_id uuid, produit text, quantite int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select p.id, p.nom, coalesce(s.quantite, 0)::int
      from produits p
      left join v_stock_detenteur s
             on s.produit_id = p.id and s.detenteur_id is null
     where p.actif
     order by p.nom;
end $$;

-- ------------------------------------------------------------
-- Stock VALORISÉ (admin) : entrepôt, distribué, total, et valeur au CUMP.
-- ------------------------------------------------------------
create or replace function stock_valorise()
returns table (
  produit_id      uuid,
  produit         text,
  actif           boolean,
  seuil_alerte    int,
  stock_entrepot  int,
  stock_distribue int,
  stock_total     int,
  cout_unitaire   numeric(10,4),
  valeur_totale   numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select s.produit_id, s.nom, s.actif, s.seuil_alerte,
           s.stock_entrepot, s.stock_distribue, s.stock_total,
           cout_moyen_pondere(s.produit_id)::numeric(10,4),
           (s.stock_total * cout_moyen_pondere(s.produit_id))::numeric(12,2)
      from v_stock_produit s
     order by s.nom;
end $$;

-- ------------------------------------------------------------
-- Qui détient quoi (admin). Le « stock possédé par chaque vendeur ».
-- p_vendeur_id = NULL → tous les détenteurs, entrepôt inclus.
-- ------------------------------------------------------------
create or replace function stock_detenteurs(p_vendeur_id uuid default null)
returns table (
  detenteur_id  uuid,
  detenteur     text,
  produit_id    uuid,
  produit       text,
  quantite      int,
  valeur        numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select s.detenteur_id,
           coalesce(pr.nom, 'Entrepôt') as detenteur,
           s.produit_id, p.nom,
           s.quantite,
           (s.quantite * cout_moyen_pondere(s.produit_id))::numeric(12,2)
      from v_stock_detenteur s
      join produits p on p.id = s.produit_id
      left join profils pr on pr.id = s.detenteur_id
     where s.quantite <> 0
       and (p_vendeur_id is null or s.detenteur_id is not distinct from p_vendeur_id)
     order by coalesce(pr.nom, 'Entrepôt'), p.nom;
end $$;

-- ------------------------------------------------------------
-- Tableau de bord admin.
--
-- Les arrondis n'ont lieu QU'À LA PRÉSENTATION (ligne de sortie), jamais dans
-- les agrégats intermédiaires : arrondir en cours de route décale la marge de
-- quelques centimes par rapport au détail.
-- ------------------------------------------------------------
create or replace function bilan_global(
  p_du date default null,
  p_au date default null
) returns table (
  ca                  numeric(12,2),
  nb_ventes           int,
  qte_vendue          int,
  cout_marchandises   numeric(12,2),
  commissions         numeric(12,2),
  marge_nette         numeric(12,2),
  montant_a_recuperer numeric(12,2),
  valeur_stock        numeric(12,2),
  achats_total        numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
  with bornes as (
    select coalesce(p_du, '-infinity'::date) as du,
           coalesce(p_au, 'infinity'::date)  as au
  ),
  l as (
    select vl.quantite, vl.prix_vente_unitaire, vl.cout_unitaire, vl.commission_unitaire
      from vente_lignes vl
      join ventes v on v.id = vl.vente_id
      cross join bornes b
     where v.date between b.du and b.au
  ),
  entetes as (
    -- Colonnes préfixées : sans ça, « ca » entrerait en collision avec le
    -- paramètre de SORTIE du même nom et plpgsql refuserait la requête
    -- (« column reference ca is ambiguous »).
    select count(*) as e_nb, coalesce(sum(v.montant_total), 0) as e_ca
      from ventes v cross join bornes b
     where v.date between b.du and b.au
  )
  select
    (select e.e_ca from entetes e)::numeric(12,2),
    (select e.e_nb from entetes e)::int,
    coalesce(sum(l.quantite), 0)::int,
    coalesce(sum(l.quantite * l.cout_unitaire), 0)::numeric(12,2),
    coalesce(sum(l.quantite * l.commission_unitaire), 0)::numeric(12,2),
    coalesce(sum(l.quantite * (l.prix_vente_unitaire - l.cout_unitaire
                               - l.commission_unitaire)), 0)::numeric(12,2),
    -- Recalculé depuis les tables de base, sur TOUT l'historique : une
    -- créance n'a pas de bornes de période, elle est un solde.
    (select coalesce(sum(c.reste_a_verser), 0) from v_comptes_vendeurs c
      where c.role = 'vendeur')::numeric(12,2),
    (select coalesce(sum(sp.stock_total * cout_moyen_pondere(sp.produit_id)), 0)
       from v_stock_produit sp)::numeric(12,2),
    (select coalesce(sum(r.prix_achat_base + r.frais_port), 0)
       from restocks r cross join bornes b2
      where r.date between b2.du and b2.au)::numeric(12,2)
  from l;
end $$;

-- ------------------------------------------------------------
-- Revenus générés par chaque vendeur (tableau de bord admin).
--
-- `drop` avant `create`, même raison qu'en 0007 pour creances() : 0013 ajoute
-- une colonne de sortie, et un `create or replace` seul refuserait de rejouer
-- ce fichier par-dessus la version de 0013.
-- ------------------------------------------------------------
drop function if exists revenus_vendeurs(date, date);

create or replace function revenus_vendeurs(
  p_du date default null,
  p_au date default null
) returns table (
  vendeur_id  uuid,
  nom         text,
  actif       boolean,
  nb_ventes   int,
  qte_vendue  int,
  ca          numeric(12,2),
  commissions numeric(12,2),
  marge_nette numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
  with bornes as (
    select coalesce(p_du, '-infinity'::date) as du,
           coalesce(p_au, 'infinity'::date)  as au
  ),
  agg as (
    select v.vendeur_id,
           count(distinct v.id)                    as nb_ventes,
           sum(vl.quantite)                        as qte,
           sum(vl.quantite * vl.prix_vente_unitaire) as ca,
           sum(vl.quantite * vl.commission_unitaire) as commissions,
           sum(vl.quantite * (vl.prix_vente_unitaire - vl.cout_unitaire
                              - vl.commission_unitaire)) as marge
      from ventes v
      join vente_lignes vl on vl.vente_id = v.id
      cross join bornes b
     where v.date between b.du and b.au
     group by v.vendeur_id
  )
  select pr.id, pr.nom, pr.actif,
         coalesce(a.nb_ventes, 0)::int,
         coalesce(a.qte, 0)::int,
         coalesce(a.ca, 0)::numeric(12,2),
         coalesce(a.commissions, 0)::numeric(12,2),
         coalesce(a.marge, 0)::numeric(12,2)
    from profils pr
    left join agg a on a.vendeur_id = pr.id
   where pr.role = 'vendeur'
   order by coalesce(a.ca, 0) desc, pr.nom;
end $$;

-- ------------------------------------------------------------
-- JOURNAL COMPTABLE UNIFIÉ (admin) : ventes, achats, transferts, retours,
-- ajustements et versements sur une seule ligne de temps.
--
-- Pagination EXPLICITE et plafonnée : le journal est la table qui grossit
-- indéfiniment, et PostgREST tronquerait en silence.
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
    -- Ventes
    select v.cree_le, v.date, 'vente'::text,
           'Vente à ' || v.client, pr.nom,
           v.quantite_totale, v.montant_total::numeric(12,2), v.id
      from ventes v join profils pr on pr.id = v.vendeur_id
    union all
    -- Achats fournisseur
    select r.cree_le, r.date, 'achat'::text,
           'Achat ' || coalesce(r.reference, '(sans référence)'), null::text,
           r.quantite_totale, (r.prix_achat_base + r.frais_port)::numeric(12,2), r.id
      from restocks r
    union all
    -- Transferts et retours : on ne garde que la jambe POSITIVE du couple,
    -- sinon chaque déplacement apparaîtrait deux fois.
    select m.cree_le, m.cree_le::date, m.type::text,
           case m.type when 'transfert' then 'Transfert vers ' || coalesce(pr.nom, 'entrepôt')
                       else 'Retour depuis un vendeur' end,
           pr.nom, m.quantite, null::numeric(12,2), m.id
      from mouvements_stock m
      left join profils pr on pr.id = m.detenteur_id
     where m.type in ('transfert','retour') and m.quantite > 0
    union all
    -- Ajustements
    select m.cree_le, m.cree_le::date, 'ajustement'::text,
           'Ajustement : ' || coalesce(m.motif, '(sans motif)'),
           coalesce(pr.nom, 'Entrepôt'), m.quantite, null::numeric(12,2), m.id
      from mouvements_stock m
      left join profils pr on pr.id = m.detenteur_id
     where m.type = 'ajustement'
    union all
    -- Versements
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

-- ------------------------------------------------------------
-- Journal du vendeur : ses ventes, ses réceptions, ses versements.
-- Aucun coût, aucune marge.
-- ------------------------------------------------------------
create or replace function mon_journal(p_limite int default 50)
returns table (
  horodatage timestamptz,
  type       text,
  libelle    text,
  quantite   int,
  montant    numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limite int := least(greatest(coalesce(p_limite, 50), 1), 500);
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
  select * from (
    select v.cree_le, 'vente'::text, 'Vente à ' || v.client,
           v.quantite_totale, v.montant_total::numeric(12,2)
      from ventes v where v.vendeur_id = auth.uid()
    union all
    select m.cree_le, 'reception'::text,
           'Réception de ' || p.nom, m.quantite, null::numeric(12,2)
      from mouvements_stock m join produits p on p.id = m.produit_id
     where m.detenteur_id = auth.uid() and m.type = 'transfert' and m.quantite > 0
    union all
    select ver.cree_le, 'versement'::text, 'Versement effectué',
           null::int, ver.montant::numeric(12,2)
      from versements ver where ver.vendeur_id = auth.uid()
  ) j (cree_le, tp, lib, qte, mt)
  order by j.cree_le desc
  limit v_limite;
end $$;

-- ------------------------------------------------------------
-- AUDIT D'INTÉGRITÉ. À passer périodiquement (cron hebdomadaire).
--
-- Aucune contrainte SQL ne peut garantir ces trois invariants : ils portent
-- sur des agrégats, pas sur des lignes. Ils sont tenus par les RPC ; cette
-- fonction vérifie qu'ils le sont RESTÉS.
-- ------------------------------------------------------------
create or replace function verifier_coherence_stock()
returns table (anomalie text, detail text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  -- 1. Un stock négatif est structurellement impossible via les RPC.
  return query
    select 'stock_negatif',
           format('%s détient %s unité(s) de %s',
                  coalesce(pr.nom, 'Entrepôt'), s.quantite, p.nom)
      from v_stock_detenteur s
      join produits p on p.id = s.produit_id
      left join profils pr on pr.id = s.detenteur_id
     where s.quantite < 0;

  -- 2. Les 2 jambes d'un déplacement doivent s'annuler.
  return query
    select 'transfert_desequilibre',
           format('groupe %s : somme %s au lieu de 0', m.groupe_id, sum(m.quantite))
      from mouvements_stock m
     where m.groupe_id is not null
     group by m.groupe_id
    having sum(m.quantite) <> 0;

  -- 3. L'en-tête de vente doit refléter ses lignes.
  return query
    select 'entete_vente_incoherente',
           format('vente %s : en-tête %s € / %s u, lignes %s € / %s u',
                  v.id, v.montant_total, v.quantite_totale,
                  coalesce(sum(vl.quantite * vl.prix_vente_unitaire), 0),
                  coalesce(sum(vl.quantite), 0))
      from ventes v
      left join vente_lignes vl on vl.vente_id = v.id
     group by v.id, v.montant_total, v.quantite_totale
    having v.montant_total <> coalesce(sum(vl.quantite * vl.prix_vente_unitaire), 0)
        or v.quantite_totale <> coalesce(sum(vl.quantite), 0);
end $$;
