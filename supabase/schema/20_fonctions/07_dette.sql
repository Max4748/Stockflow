-- ============================================================
-- StockFlow — Dette vendeur et versements
-- ============================================================
-- La commission est une dette figée à la vente, pas un pourcentage
-- recalculé. Un versement la rembourse ; le supprimer la rétablit.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Encaisser un versement.
--
-- La borne anti-surversement est ICI, en SQL. (La poser en TypeScript ne
-- suffirait pas : un admin passant par PostgREST insérerait un versement
-- excédentaire et rendrait une dette négative sans jamais croiser le
-- contrôle.)
--
-- p_autoriser_excedent : échappatoire explicite pour les cas légitimes
-- (avance, arrondi de caisse). Il faut la demander, elle n'arrive pas par
-- accident.
-- ------------------------------------------------------------
create or replace function enregistrer_versement(
  p_vendeur_id         uuid,
  p_montant            numeric,
  p_date               date    default current_date,
  p_note               text    default null,
  p_autoriser_excedent boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id  uuid;
  v_du  numeric(12,2);
  v_nom text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'Le montant doit être strictement positif.' using errcode = '22023';
  end if;

  -- Sérialise deux versements concurrents pour le même vendeur, sinon les
  -- deux liraient la même dette et la borne serait contournable.
  perform pg_advisory_xact_lock(hashtext('versement/' || p_vendeur_id::text));

  select c.reste_a_verser, c.nom into v_du, v_nom
    from v_comptes_vendeurs c where c.vendeur_id = p_vendeur_id;
  if not found then
    raise exception 'Vendeur inconnu.' using errcode = '02000';
  end if;

  if not p_autoriser_excedent and p_montant > v_du then
    raise exception '% ne doit que % €. Cocher « autoriser l''excédent » pour une avance.',
      v_nom, to_char(v_du, 'FM999999990.00')
      using errcode = '23514';
  end if;

  insert into versements (date, vendeur_id, montant, note, cree_par)
  values (p_date, p_vendeur_id, p_montant,
          nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  return v_id;
end $$;

create or replace function supprimer_versement(p_versement_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_montant numeric(12,2);
  v_nom     text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  -- Relevé avant : un versement supprimé fait remonter la dette d'un vendeur
  -- sans qu'aucune écriture ne l'explique.
  select v.montant, p.nom into v_montant, v_nom
    from versements v join profils p on p.id = v.vendeur_id
   where v.id = p_versement_id;

  delete from versements where id = p_versement_id;
  if not found then
    raise exception 'Versement introuvable.' using errcode = '02000';
  end if;

  perform tracer_operation(
    'versement', p_versement_id, 'suppression',
    format('Versement supprimé · %s', coalesce(v_nom, '?')),
    null, v_montant, null);
end $$;

create or replace function creances()
returns table (
  vendeur_id     uuid,
  nom            text,
  role           text,
  actif          boolean,
  ca             numeric(12,2),
  commissions    numeric(12,2),
  verse          numeric(12,2),
  rembourse      numeric(12,2),
  reste_a_verser numeric(12,2),
  nb_ventes      int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select c.vendeur_id, c.nom, c.role, c.actif, c.ca, c.commissions, c.verse,
           c.rembourse, c.reste_a_verser, c.nb_ventes
      from v_comptes_vendeurs c
     where c.role = 'vendeur' or c.nb_ventes > 0
     order by c.reste_a_verser desc, c.nom;
end $$;

create or replace function ma_dette()
returns table (
  ca             numeric(12,2),
  commissions    numeric(12,2),
  verse          numeric(12,2),
  rembourse      numeric(12,2),
  reste_a_verser numeric(12,2),
  nb_ventes      int,
  qte_vendue     int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select c.ca, c.commissions, c.verse, c.rembourse, c.reste_a_verser,
           c.nb_ventes, c.qte_vendue
      from v_comptes_vendeurs c
     where c.vendeur_id = auth.uid();
end $$;

create or replace function revenus_vendeurs(
  p_du date default null,
  p_au date default null
) returns table (
  vendeur_id  uuid,
  nom         text,
  role        text,
  actif       boolean,
  nb_ventes   int,
  qte_vendue  int,
  ca          numeric(12,2),
  commissions numeric(12,2),
  marge_nette numeric(12,2),
  sav_unites  int
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
  ),
  sv as (
    select v.vendeur_id,
           sum(s.quantite)                                   as unites,
           sum(s.montant_rembourse)                          as rembourse,
           sum(case when s.resolution = 'echange'
                    then s.quantite * vl.cout_unitaire else 0 end) as cout_echanges
      from sav s
      join ventes v on v.id = s.vente_id
      join vente_lignes vl
        on vl.vente_id = s.vente_id and vl.produit_id = s.produit_id
      cross join bornes b
     where s.date between b.du and b.au
       and s.statut = 'valide'
     group by v.vendeur_id
  )
  select pr.id, pr.nom, pr.role, pr.actif,
         coalesce(a.nb_ventes, 0)::int,
         coalesce(a.qte, 0)::int,
         (coalesce(a.ca, 0) - coalesce(sv.rembourse, 0))::numeric(12,2),
         coalesce(a.commissions, 0)::numeric(12,2),
         (coalesce(a.marge, 0) - coalesce(sv.rembourse, 0)
          - coalesce(sv.cout_echanges, 0))::numeric(12,2),
         coalesce(sv.unites, 0)::int
    from profils pr
    left join agg a  on a.vendeur_id  = pr.id
    left join sv     on sv.vendeur_id = pr.id
   where pr.role = 'vendeur' or a.vendeur_id is not null
   order by coalesce(a.ca, 0) desc, pr.nom;
end $$;

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
    select count(*) as e_nb, coalesce(sum(v.montant_total), 0) as e_ca
      from ventes v cross join bornes b
     where v.date between b.du and b.au
  ),
  s as (
    select coalesce(sum(sv.montant_rembourse), 0) as rembourse,
           coalesce(sum(case when sv.resolution = 'echange'
                             then sv.quantite * vl.cout_unitaire else 0 end), 0) as cout_echanges
      from sav sv
      join vente_lignes vl
        on vl.vente_id = sv.vente_id and vl.produit_id = sv.produit_id
      cross join bornes b
     where sv.date between b.du and b.au
       and sv.statut = 'valide'
  )
  select
    ((select e.e_ca from entetes e) - (select s.rembourse from s))::numeric(12,2),
    (select e.e_nb from entetes e)::int,
    coalesce(sum(l.quantite), 0)::int,
    (coalesce(sum(l.quantite * l.cout_unitaire), 0)
     + (select s.cout_echanges from s))::numeric(12,2),
    coalesce(sum(l.quantite * l.commission_unitaire), 0)::numeric(12,2),
    (coalesce(sum(l.quantite * (l.prix_vente_unitaire - l.cout_unitaire
                                - l.commission_unitaire)), 0)
     - (select s.rembourse from s)
     - (select s.cout_echanges from s))::numeric(12,2),
    (select coalesce(sum(c.reste_a_verser), 0) from v_comptes_vendeurs c
      where c.role = 'vendeur')::numeric(12,2),
    (select coalesce(sum(sp.stock_total * cout_moyen_pondere(sp.produit_id)), 0)
       from v_stock_produit sp)::numeric(12,2),
    (select coalesce(sum(r.prix_achat_base + r.frais_port), 0)
       from restocks r cross join bornes b2
      where r.date between b2.du and b2.au)::numeric(12,2)
  from l;
end $$;
