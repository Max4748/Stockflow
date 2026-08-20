-- ============================================================
-- StockFlow — 0015_sav_vendeur.sql
-- Le vendeur déclare le SAV : c'est lui qui est face au client.
-- ============================================================
--
-- POURQUOI DEUX RÉGIMES SELON LE DÉNOUEMENT
--
-- Un SAV touche à deux choses qui appartiennent au vendeur lui-même : son stock
-- et sa dette. Les ouvrir toutes les deux sans contrôle reviendrait à le laisser
-- effacer ce qu'il doit et faire disparaître du stock à volonté.
--
--   ÉCHANGE       → effet IMMÉDIAT. Le vendeur a déjà remis l'unité au client
--                   sur le terrain ; refuser de l'écrire ferait mentir son stock
--                   jusqu'à ce qu'un gérant passe. Le risque est assumé et borné :
--                   la quantité ne peut pas dépasser ce que la vente contenait,
--                   le dossier est nominatif, daté, motivé, et il apparaît dans
--                   l'écran SAV du gérant comme dans le journal comptable.
--
--   REMBOURSEMENT → EN ATTENTE. C'est de l'argent, et il diminue la dette de
--                   celui qui le déclare. Aucun effet comptable tant que le
--                   gérant n'a pas tranché — même parcours que les demandes de
--                   réassort, que l'application pratique déjà.
--
-- Un SAV déclaré par un gérant reste validé d'emblée dans les deux cas : il n'a
-- personne au-dessus de lui pour arbitrer.

-- ------------------------------------------------------------
-- Le cycle de vie d'un dossier.
--
-- `valide` par défaut : les dossiers existants ont été saisis par un gérant et
-- ont déjà produit tous leurs effets. Une valeur par défaut différente les
-- neutraliserait rétroactivement.
-- ------------------------------------------------------------
alter table sav
  add column if not exists statut text not null default 'valide',
  add column if not exists motif_refus text,
  add column if not exists traite_le   timestamptz,
  add column if not exists traite_par  uuid references profils(id);

alter table sav drop constraint if exists sav_statut_connu;
alter table sav add constraint sav_statut_connu
  check (statut in ('valide','en_attente','refuse','annule'));

create index if not exists idx_sav_statut on sav (statut)
  where statut = 'en_attente';

-- ------------------------------------------------------------
-- DÉCLARER UN SAV — désormais ouverte au vendeur pour SES ventes.
--
-- Le régime (immédiat ou soumis à validation) n'est PAS un paramètre : il se
-- déduit de qui appelle et du dénouement choisi. Un paramètre serait une
-- porte ouverte, puisqu'une Server Action est une URL comme une autre.
-- ------------------------------------------------------------
create or replace function declarer_sav(
  p_vente_id     uuid,
  p_produit_id   uuid,
  p_quantite     integer,
  p_resolution   text,
  p_motif        text,
  p_montant      numeric default 0,
  p_detenteur_id uuid    default null,
  p_depuis_entrepot boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sav_id     uuid;
  v_vendeur    uuid;
  v_admin      boolean := est_admin();
  v_statut     text;
  v_vendue     int;
  v_deja       int;
  v_prix       numeric(10,2);
  v_max        numeric(12,2);
  v_source     uuid;
  v_dispo      int;
  v_produit    text := coalesce((select nom from produits where id = p_produit_id), '?');
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;
  if p_resolution not in ('echange','remboursement') then
    raise exception 'Dénouement invalide : attendu ''echange'' ou ''remboursement''.'
      using errcode = '22023';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'Quantité invalide.' using errcode = '22023';
  end if;
  if p_motif is null or trim(p_motif) = '' then
    raise exception 'Motif obligatoire : « SAV » seul n''explique rien six mois plus tard.'
      using errcode = '22023';
  end if;

  select v.vendeur_id into v_vendeur from ventes v where v.id = p_vente_id;
  if not found then
    raise exception 'Vente introuvable.' using errcode = '02000';
  end if;
  -- Un vendeur n'ouvre un dossier que sur SES ventes. Sans ce contrôle, il
  -- pourrait faire baisser le stock d'un collègue.
  if not v_admin and v_vendeur <> auth.uid() then
    raise exception 'Cette vente n''est pas la vôtre.' using errcode = '42501';
  end if;

  select vl.quantite, vl.prix_vente_unitaire into v_vendue, v_prix
    from vente_lignes vl
   where vl.vente_id = p_vente_id and vl.produit_id = p_produit_id;
  if not found then
    raise exception 'Cette vente ne contient pas de %.', v_produit
      using errcode = '02000';
  end if;

  -- Les dossiers EN ATTENTE comptent dans le cumul : sans cela, déclarer deux
  -- fois la même unité avant l'arbitrage passerait les deux fois.
  select coalesce(sum(s.quantite), 0) into v_deja
    from sav s
   where s.vente_id = p_vente_id and s.produit_id = p_produit_id
     and s.statut in ('valide','en_attente');

  if v_deja + p_quantite > v_vendue then
    raise exception
      'SAV impossible : % unité(s) vendue(s) de %, % déjà en SAV, % demandée(s).',
      v_vendue, v_produit, v_deja, p_quantite
      using errcode = '23514';
  end if;

  if p_resolution = 'remboursement' then
    v_max := (p_quantite * v_prix)::numeric(12,2);
    if p_montant is null or p_montant <= 0 then
      raise exception 'Le montant remboursé doit être strictement positif.'
        using errcode = '22023';
    end if;
    if p_montant > v_max then
      raise exception
        'Remboursement supérieur au payé : % € maximum pour % unité(s) de % à % €.',
        to_char(v_max, 'FM999999990.00'), p_quantite, v_produit,
        to_char(v_prix, 'FM999999990.00')
        using errcode = '23514';
    end if;
  end if;

  -- LA RÈGLE, en une expression. Un gérant tranche seul ; un vendeur agit seul
  -- sur la marchandise et demande pour l'argent.
  v_statut := case
                when v_admin then 'valide'
                when p_resolution = 'echange' then 'valide'
                else 'en_attente'
              end;

  insert into sav (vente_id, produit_id, quantite, resolution,
                   montant_rembourse, motif, statut, cree_par,
                   traite_le, traite_par)
  values (p_vente_id, p_produit_id, p_quantite, p_resolution,
          case when p_resolution = 'remboursement' then p_montant else 0 end,
          trim(p_motif), v_statut, auth.uid(),
          case when v_statut = 'valide' then now() end,
          case when v_statut = 'valide' then auth.uid() end)
  returning id into v_sav_id;

  if p_resolution = 'echange' then
    -- L'unité de remplacement sort du stock du vendeur de la vente : c'est lui
    -- qui est face au client. `p_depuis_entrepot` est une commodité de gérant —
    -- un vendeur n'a pas accès à l'entrepôt, le paramètre est ignoré pour lui.
    if v_admin and p_depuis_entrepot then
      v_source := null;
    elsif v_admin then
      v_source := coalesce(p_detenteur_id, v_vendeur);
    else
      v_source := auth.uid();
    end if;

    perform verrouiller_stock(p_produit_id, v_source);

    v_dispo := stock_detenu(p_produit_id, v_source);
    if v_dispo < p_quantite then
      raise exception 'Stock insuffisant pour l''échange : % demandée(s), % disponible(s) chez %.',
        p_quantite, v_dispo,
        coalesce((select nom from profils where id = v_source), 'l''entrepôt')
        using errcode = '23514';
    end if;

    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_sav_id, motif, cree_par)
    values (p_produit_id, v_source, -p_quantite, 'sav',
            v_sav_id, trim(p_motif), auth.uid());
  end if;

  return v_sav_id;
end $$;

grant execute on function declarer_sav(uuid, uuid, integer, text, text, numeric, uuid, boolean)
  to authenticated;

-- ------------------------------------------------------------
-- L'arbitrage du gérant.
--
-- `for update` : verrouille la ligne, sinon une validation et un refus
-- simultanés se croiraient tous deux légitimes — même motif qu'en 0006 pour
-- les demandes de réassort.
-- ------------------------------------------------------------
create or replace function valider_sav(p_sav_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s      sav;
  v_source uuid;
  v_dispo  int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select * into v_s from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if v_s.statut <> 'en_attente' then
    raise exception 'Dossier déjà traité (statut : %).', v_s.statut
      using errcode = '23514';
  end if;

  -- Un échange en attente ne devrait pas exister (ils sont validés d'emblée),
  -- mais la fonction reste correcte s'il s'en présentait un : le mouvement se
  -- fait à la validation, jamais deux fois.
  if v_s.resolution = 'echange'
     and not exists (select 1 from mouvements_stock m where m.origine_sav_id = v_s.id)
  then
    v_source := (select vendeur_id from ventes where id = v_s.vente_id);
    perform verrouiller_stock(v_s.produit_id, v_source);
    v_dispo := stock_detenu(v_s.produit_id, v_source);
    if v_dispo < v_s.quantite then
      raise exception 'Stock insuffisant pour l''échange : % demandée(s), % disponible(s).',
        v_s.quantite, v_dispo using errcode = '23514';
    end if;
    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_sav_id, motif, cree_par)
    values (v_s.produit_id, v_source, -v_s.quantite, 'sav',
            v_s.id, v_s.motif, auth.uid());
  end if;

  update sav set statut = 'valide', traite_le = now(), traite_par = auth.uid()
   where id = p_sav_id;
end $$;

grant execute on function valider_sav(uuid) to authenticated;

-- ------------------------------------------------------------
-- Refuser. Le dossier est CONSERVÉ plutôt que supprimé : un refus fait partie
-- de la relation avec le vendeur, et lui doit savoir pourquoi.
-- ------------------------------------------------------------
create or replace function refuser_sav(p_sav_id uuid, p_motif text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_statut text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select statut into v_statut from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if v_statut <> 'en_attente' then
    raise exception 'Dossier déjà traité (statut : %).', v_statut
      using errcode = '23514';
  end if;

  update sav
     set statut      = 'refuse',
         motif_refus = nullif(trim(coalesce(p_motif, '')), ''),
         traite_le   = now(),
         traite_par  = auth.uid()
   where id = p_sav_id;
end $$;

grant execute on function refuser_sav(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- Le vendeur retire une demande qu'il n'aurait pas dû faire — tant qu'elle est
-- en attente, donc sans aucun effet à défaire.
-- ------------------------------------------------------------
create or replace function annuler_sav(p_sav_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s sav;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  select * into v_s from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if not est_admin()
     and (select vendeur_id from ventes where id = v_s.vente_id) <> auth.uid()
  then
    raise exception 'Ce dossier n''est pas le vôtre.' using errcode = '42501';
  end if;
  if v_s.statut <> 'en_attente' then
    raise exception 'Seul un dossier en attente peut être retiré (statut : %).',
      v_s.statut using errcode = '23514';
  end if;

  update sav set statut = 'annule', traite_le = now(), traite_par = auth.uid()
   where id = p_sav_id;
end $$;

grant execute on function annuler_sav(uuid) to authenticated;

-- ============================================================
-- Les agrégats ne comptent QUE les dossiers validés.
--
-- Un dossier en attente n'a produit aucun effet : le compter ferait baisser un
-- chiffre d'affaires sur la foi d'une simple demande.
-- ============================================================

create or replace view v_comptes_vendeurs as
select
  pr.id                                       as vendeur_id,
  pr.nom,
  pr.role,
  pr.actif,
  pr.commission_unitaire,
  coalesce(v.ca, 0)::numeric(12,2)            as ca,
  coalesce(v.nb_ventes, 0)::int               as nb_ventes,
  coalesce(v.qte_vendue, 0)::int              as qte_vendue,
  coalesce(c.commissions, 0)::numeric(12,2)   as commissions,
  coalesce(ve.verse, 0)::numeric(12,2)        as verse,
  coalesce(sv.rembourse, 0)::numeric(12,2)    as rembourse,
  case when pr.role <> 'vendeur' then 0::numeric(12,2)
       else (coalesce(v.ca, 0) - coalesce(c.commissions, 0)
             - coalesce(ve.verse, 0) - coalesce(sv.rembourse, 0))::numeric(12,2)
  end                                         as reste_a_verser
from profils pr
left join (
  select vendeur_id,
         sum(montant_total)   as ca,
         count(*)             as nb_ventes,
         sum(quantite_totale) as qte_vendue
    from ventes group by vendeur_id
) v on v.vendeur_id = pr.id
left join (
  select ve2.vendeur_id,
         sum(vl.quantite * vl.commission_unitaire) as commissions
    from ventes ve2
    join vente_lignes vl on vl.vente_id = ve2.id
   group by ve2.vendeur_id
) c on c.vendeur_id = pr.id
left join (
  select vendeur_id, sum(montant) as verse
    from versements group by vendeur_id
) ve on ve.vendeur_id = pr.id
left join (
  select v3.vendeur_id, sum(s.montant_rembourse) as rembourse
    from sav s join ventes v3 on v3.id = s.vente_id
   where s.statut = 'valide'
   group by v3.vendeur_id
) sv on sv.vendeur_id = pr.id;

revoke all on v_comptes_vendeurs from authenticated, anon;

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

grant execute on function bilan_global(date, date) to authenticated;

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

grant execute on function revenus_vendeurs(date, date) to authenticated;

-- ------------------------------------------------------------
-- Journal : un dossier en attente n'est pas une écriture comptable, il n'y
-- figure donc pas. Un refus non plus.
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
    select v.cree_le, v.date, 'vente'::text,
           'Vente à ' || v.client, pr.nom,
           v.quantite_totale, v.montant_total::numeric(12,2), v.id
      from ventes v join profils pr on pr.id = v.vendeur_id
    union all
    select r.cree_le, r.date, 'achat'::text,
           'Achat ' || coalesce(r.reference, '(sans référence)'), null::text,
           r.quantite_totale, (r.prix_achat_base + r.frais_port)::numeric(12,2), r.id
      from restocks r
    union all
    select m.cree_le, m.cree_le::date, m.type::text,
           case m.type when 'transfert' then 'Transfert vers ' || coalesce(pr.nom, 'entrepôt')
                       else 'Retour depuis un vendeur' end,
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

grant execute on function journal_transactions(date, date, text, uuid, int, int)
  to authenticated;

-- ============================================================
-- Lectures : le statut se voit là où le SAV se voit.
-- ============================================================

drop function if exists mes_ventes(int);

create or replace function mes_ventes(p_limite int default 20)
returns table (
  id              uuid,
  date            date,
  client          text,
  quantite_totale int,
  montant_total   numeric(10,2),
  cree_le         timestamptz,
  corrigeable     boolean,
  sav_unites      int,
  sav_rembourse   numeric(12,2),
  sav_en_attente  int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.client, v.quantite_totale, v.montant_total, v.cree_le,
           (v.cree_le >= now() - fenetre_correction()) as corrigeable,
           coalesce(s.unites, 0)::int,
           coalesce(s.rembourse, 0)::numeric(12,2),
           coalesce(s.en_attente, 0)::int
      from ventes v
      left join (
        -- `unites` compte le validé ET l'en-attente : le badge répond à « cette
        -- vente a-t-elle posé problème ? ». `rembourse` ne compte que le validé,
        -- car c'est le seul argent réellement sorti.
        select sv.vente_id,
               sum(sv.quantite) filter (where sv.statut in ('valide','en_attente')) as unites,
               sum(sv.montant_rembourse) filter (where sv.statut = 'valide') as rembourse,
               count(*) filter (where sv.statut = 'en_attente') as en_attente
          from sav sv group by sv.vente_id
      ) s on s.vente_id = v.id
     where v.vendeur_id = auth.uid()
     order by v.cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

grant execute on function mes_ventes(int) to authenticated;

drop function if exists ventes_vendeur(uuid, int);

create or replace function ventes_vendeur(
  p_vendeur_id uuid,
  p_limite     int default 20
) returns table (
  id              uuid,
  date            date,
  client          text,
  quantite_totale int,
  montant_total   numeric(10,2),
  cree_le         timestamptz,
  sav_unites      int,
  sav_rembourse   numeric(12,2),
  sav_en_attente  int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.client, v.quantite_totale, v.montant_total, v.cree_le,
           coalesce(s.unites, 0)::int,
           coalesce(s.rembourse, 0)::numeric(12,2),
           coalesce(s.en_attente, 0)::int
      from ventes v
      left join (
        select sv.vente_id,
               sum(sv.quantite) filter (where sv.statut in ('valide','en_attente')) as unites,
               sum(sv.montant_rembourse) filter (where sv.statut = 'valide') as rembourse,
               count(*) filter (where sv.statut = 'en_attente') as en_attente
          from sav sv group by sv.vente_id
      ) s on s.vente_id = v.id
     where v.vendeur_id = p_vendeur_id
     order by v.cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 200);
end $$;

grant execute on function ventes_vendeur(uuid, int) to authenticated;

-- ------------------------------------------------------------
-- Les lignes encore couvrables. OUVERTE AU VENDEUR pour ses propres ventes :
-- c'est ce qui alimente son formulaire de signalement.
-- ------------------------------------------------------------
drop function if exists ventes_savables(int);

create or replace function ventes_savables(p_limite int default 100)
returns table (
  vente_id       uuid,
  date           date,
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
    select v.id, v.date, v.client, pr.nom, v.vendeur_id,
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

-- ------------------------------------------------------------
-- Les dossiers, pour l'écran SAV du gérant et pour le vendeur qui suit sa
-- demande. La RLS de `sav` (0014) fait déjà le filtrage par vendeur.
-- ------------------------------------------------------------
-- `drop` avant `create` : 0016 y ajoute les colonnes de traitement. Voir la
-- note « Changer les colonnes de sortie d'une fonction » dans docs/donnees.md.
drop function if exists dossiers_sav(int);

create or replace function dossiers_sav(p_limite int default 100)
returns table (
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
           s.cree_le
      from sav s
      join ventes   v  on v.id  = s.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = s.produit_id
      left join profils dp on dp.id = s.cree_par
     where est_admin() or v.vendeur_id = auth.uid()
     -- En attente d'abord : c'est ce qui appelle une décision.
     order by (s.statut = 'en_attente') desc, s.cree_le desc
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

grant execute on function dossiers_sav(int) to authenticated;
