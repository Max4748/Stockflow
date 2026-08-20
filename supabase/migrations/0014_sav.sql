-- ============================================================
-- StockFlow — 0014_sav.sql
-- Service après-vente : une défaillance, rattachée à SA vente.
-- ============================================================
--
-- RÈGLE MÉTIER RETENUE, énoncée par le patron : « c'est nous qui assumons la
-- perte ». Deux dénouements possibles pour un article défaillant :
--
--   ÉCHANGE       — le client repart avec une unité neuve. Elle sort du stock
--                   sans produire de chiffre d'affaires : la maison offre la
--                   marchandise. Le coût de cette unité rejoint le coût des
--                   marchandises, donc la marge baisse d'autant.
--
--   REMBOURSEMENT — le client récupère son argent. Le chiffre d'affaires baisse
--                   du montant rendu, et la dette du vendeur aussi : c'est lui
--                   qui a sorti l'argent de sa poche, sur le terrain.
--
-- CE QUI NE BOUGE PAS, et pourquoi :
--
--   • la vente d'origine. Une écriture comptable ne se réécrit pas (voir le
--     figeage en 0005) ; un SAV est un ÉVÉNEMENT POSTÉRIEUR, pas une correction
--     de saisie. C'est aussi la seule façon de répondre à « cette vente a-t-elle
--     eu un SAV ? » — une vente corrigée aurait effacé la question.
--
--   • la commission du vendeur. Il a fait son travail ; la défaillance ne vient
--     pas de lui. Conséquence arithmétique à connaître : un remboursement
--     intégral rend la dette du vendeur NÉGATIVE à hauteur de sa commission,
--     c'est-à-dire un crédit en sa faveur. C'est voulu, et c'est exactement ce
--     que « la maison assume » veut dire.
--
--   • l'article défaillant ne revient JAMAIS en stock vendable. Il a quitté le
--     stock à la vente et n'y rentre pas : le remboursement n'écrit donc aucun
--     mouvement, seul l'échange en écrit un (l'unité de remplacement).

-- ------------------------------------------------------------
-- Un sixième type de mouvement.
--
-- Un ajustement motivé aurait suffi à faire baisser le stock, mais il ne se
-- rattache à aucune vente : impossible de compter les défaillances par produit
-- ou de marquer une vente. D'où un type à part entière.
--
-- `add value if not exists` est hors transaction implicite ici (le script
-- applique le fichier statement par statement) : la contrainte plus bas peut
-- donc s'y référer.
-- ------------------------------------------------------------
alter type type_mouvement add value if not exists 'sav';

-- ------------------------------------------------------------
-- La table.
--
-- `montant_rembourse` porte 0 pour un échange plutôt qu'un NULL : les sommes
-- des agrégats n'ont ainsi aucun cas particulier à traiter.
-- ------------------------------------------------------------
create table if not exists sav (
  id          uuid primary key default gen_random_uuid(),
  vente_id    uuid not null references ventes(id)   on delete cascade,
  produit_id  uuid not null references produits(id) on delete restrict,
  date        date not null default current_date,

  quantite    integer not null check (quantite > 0),
  resolution  text    not null check (resolution in ('echange','remboursement')),
  montant_rembourse numeric(12,2) not null default 0 check (montant_rembourse >= 0),

  -- Obligatoire : six mois plus tard, « SAV » tout court n'explique rien.
  motif       text not null,
  cree_par    uuid references profils(id),
  cree_le     timestamptz not null default now(),

  -- Un échange ne rend pas d'argent, un remboursement en rend. Sans ce CHECK,
  -- un échange à 200 € amputerait le chiffre d'affaires sans laisser de trace
  -- compréhensible.
  constraint sav_coherence check (
    case resolution
      when 'echange'       then montant_rembourse = 0
      when 'remboursement' then montant_rembourse > 0
    end
  )
);

create index if not exists idx_sav_vente   on sav (vente_id);
create index if not exists idx_sav_produit on sav (produit_id);
create index if not exists idx_sav_date    on sav (date desc);

-- Le mouvement d'un échange pointe sur son SAV : supprimer le SAV rend
-- l'unité au stock, exactement comme l'annulation d'une vente (0005).
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

-- ------------------------------------------------------------
-- RLS. Un vendeur voit les SAV de SES ventes — il doit pouvoir constater
-- pourquoi sa dette a bougé. L'écriture passe par les RPC, comme partout.
-- ------------------------------------------------------------
alter table sav enable row level security;

drop policy if exists sav_select    on sav;
drop policy if exists sav_admin_all on sav;
create policy sav_select on sav for select
  using (
    est_admin()
    or exists (select 1 from ventes v
                where v.id = sav.vente_id and v.vendeur_id = auth.uid())
  );
create policy sav_admin_all on sav for all
  using (est_admin()) with check (est_admin());

grant select on sav to authenticated;
revoke insert, update, delete on sav from authenticated, anon;

-- ------------------------------------------------------------
-- DÉCLARER UN SAV.
--
-- p_detenteur_id : d'où sort l'unité de remplacement, pour un échange.
--                  NULL = entrepôt. Ignoré pour un remboursement.
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
  v_vendue     int;
  v_deja       int;
  v_prix       numeric(10,2);
  v_max        numeric(12,2);
  v_source     uuid;
  v_dispo      int;
  v_produit    text := coalesce((select nom from produits where id = p_produit_id), '?');
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
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

  -- La ligne de vente donne à la fois le droit d'ouvrir un SAV et le plafond
  -- du remboursement. Pas de ligne : le produit n'a pas été vendu là.
  select vl.quantite, vl.prix_vente_unitaire into v_vendue, v_prix
    from vente_lignes vl
   where vl.vente_id = p_vente_id and vl.produit_id = p_produit_id;
  if not found then
    raise exception 'Cette vente ne contient pas de %.', v_produit
      using errcode = '02000';
  end if;

  -- Cumul des SAV déjà ouverts : on ne peut pas rendre 4 unités sur une vente
  -- de 3, même en s'y prenant à deux fois.
  select coalesce(sum(s.quantite), 0) into v_deja
    from sav s where s.vente_id = p_vente_id and s.produit_id = p_produit_id;

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
    -- Rendre plus que ce que le client a payé pour ces unités serait un geste
    -- commercial, pas un SAV : il n'a pas sa place dans cette écriture.
    if p_montant > v_max then
      raise exception
        'Remboursement supérieur au payé : % € maximum pour % unité(s) de % à % €.',
        to_char(v_max, 'FM999999990.00'), p_quantite, v_produit,
        to_char(v_prix, 'FM999999990.00')
        using errcode = '23514';
    end if;
  end if;

  insert into sav (vente_id, produit_id, quantite, resolution,
                   montant_rembourse, motif, cree_par)
  values (p_vente_id, p_produit_id, p_quantite, p_resolution,
          case when p_resolution = 'remboursement' then p_montant else 0 end,
          trim(p_motif), auth.uid())
  returning id into v_sav_id;

  -- Un remboursement n'écrit AUCUN mouvement : l'article est sorti du stock au
  -- moment de la vente et, défaillant, il n'y rentre pas.
  if p_resolution = 'echange' then
    -- Par défaut l'unité de remplacement sort du stock du vendeur, qui est sur
    -- le terrain face au client. `p_depuis_entrepot` bascule explicitement sur
    -- l'entrepôt — un booléen séparé parce que NULL veut déjà dire « entrepôt »
    -- et ne peut donc pas distinguer « non précisé ».
    if p_depuis_entrepot then
      v_source := null;
    else
      v_source := coalesce(p_detenteur_id,
                           (select vendeur_id from ventes where id = p_vente_id));
    end if;

    -- VERROU AVANT LECTURE, la règle de revue de tout chemin d'écriture.
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
-- Annuler un SAV saisi par erreur. Le `on delete cascade` du mouvement rend
-- l'unité au détenteur d'où elle était sortie.
-- ------------------------------------------------------------
create or replace function supprimer_sav(p_sav_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  delete from sav where id = p_sav_id;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
end $$;

grant execute on function supprimer_sav(uuid) to authenticated;

-- ============================================================
-- Répercussion comptable.
-- ============================================================

-- ------------------------------------------------------------
-- La dette d'un vendeur baisse de ce qu'il a remboursé de sa poche.
--
-- Sa commission n'est PAS reprise : un remboursement intégral laisse donc un
-- solde négatif égal à cette commission, c'est-à-dire un crédit en sa faveur.
-- C'est la traduction exacte de « la maison assume la perte ».
--
-- `drop` avant `create` : `create or replace view` ne sait qu'AJOUTER des
-- colonnes en fin de liste, et `rembourse` s'insère avant `reste_a_verser`.
-- ------------------------------------------------------------
drop view if exists v_comptes_vendeurs;

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
-- Sous-requête SÉPARÉE, comme les trois autres : joindre ventes et sav
-- directement multiplierait le chiffre d'affaires par le nombre de dossiers.
left join (
  select v3.vendeur_id, sum(s.montant_rembourse) as rembourse
    from sav s join ventes v3 on v3.id = s.vente_id
   group by v3.vendeur_id
) sv on sv.vendeur_id = pr.id;

revoke all on v_comptes_vendeurs from authenticated, anon;

-- ------------------------------------------------------------
-- Le vendeur voit ce qu'il a remboursé : sans cette ligne, une dette qui
-- baisse toute seule est incompréhensible.
-- ------------------------------------------------------------
drop function if exists ma_dette();

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

grant execute on function ma_dette() to authenticated;

-- ------------------------------------------------------------
-- Bilan : le SAV entre par DEUX portes distinctes.
--
--   remboursements → retranchés du chiffre d'affaires (l'argent est reparti) ;
--   échanges       → ajoutés au coût des marchandises (la maison a offert
--                    l'unité, à son coût figé au moment de la vente).
--
-- Ainsi « marge = CA − coût − commissions » reste vrai à l'écran. Y toucher
-- sans respecter cette égalité rendrait les quatre indicateurs incohérents
-- entre eux, ce qui est pire que faux : c'est invérifiable.
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
    select count(*) as e_nb, coalesce(sum(v.montant_total), 0) as e_ca
      from ventes v cross join bornes b
     where v.date between b.du and b.au
  ),
  -- Le SAV est daté de SON jour, pas de celui de la vente : un remboursement
  -- de janvier sur une vente de décembre appartient à janvier.
  s as (
    select coalesce(sum(sv.montant_rembourse), 0) as rembourse,
           coalesce(sum(case when sv.resolution = 'echange'
                             then sv.quantite * vl.cout_unitaire else 0 end), 0) as cout_echanges
      from sav sv
      join vente_lignes vl
        on vl.vente_id = sv.vente_id and vl.produit_id = sv.produit_id
      cross join bornes b
     where sv.date between b.du and b.au
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

-- ------------------------------------------------------------
-- Même traitement par vendeur, sans quoi la somme du tableau ne recouperait
-- plus le bilan.
-- ------------------------------------------------------------
drop function if exists revenus_vendeurs(date, date);

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
-- Créances : la colonne `rembourse` explique un solde qui a baissé sans
-- versement.
-- ------------------------------------------------------------
drop function if exists creances();

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

grant execute on function creances() to authenticated;

-- ------------------------------------------------------------
-- Le journal comptable gagne une ligne par dossier SAV.
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
    -- SAV : la ligne part de la TABLE, pas du mouvement — un remboursement
    -- n'écrit aucun mouvement et disparaîtrait du journal.
    select s.cree_le, s.date, 'sav'::text,
           'SAV ' || (case s.resolution when 'echange' then 'échange' else 'remboursement' end)
             || ' — ' || p.nom || ' : ' || s.motif,
           pr.nom, -s.quantite,
           nullif(s.montant_rembourse, 0)::numeric(12,2), s.id
      from sav s
      join ventes   v  on v.id  = s.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = s.produit_id
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

-- ------------------------------------------------------------
-- Les ventes du vendeur portent le nombre d'unités passées en SAV : c'est la
-- réponse à « cette vente a-t-elle eu un problème ? », posée là où il regarde.
-- ------------------------------------------------------------
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
  sav_rembourse   numeric(12,2)
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
           coalesce(s.rembourse, 0)::numeric(12,2)
      from ventes v
      left join (
        select sv.vente_id,
               sum(sv.quantite) as unites,
               sum(sv.montant_rembourse) as rembourse
          from sav sv group by sv.vente_id
      ) s on s.vente_id = v.id
     where v.vendeur_id = auth.uid()
     order by v.cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

grant execute on function mes_ventes(int) to authenticated;

-- ------------------------------------------------------------
-- Les ventes d'un vendeur vues par l'admin, avec leur SAV. La fiche vendeur
-- lisait `ventes` en direct ; il lui faut désormais l'information agrégée.
-- ------------------------------------------------------------
-- `drop` avant `create` : 0015 y ajoute une colonne de sortie. Voir la note
-- « Changer les colonnes de sortie d'une fonction » dans docs/donnees.md.
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
  sav_rembourse   numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.client, v.quantite_totale, v.montant_total, v.cree_le,
           coalesce(s.unites, 0)::int,
           coalesce(s.rembourse, 0)::numeric(12,2)
      from ventes v
      left join (
        select sv.vente_id,
               sum(sv.quantite) as unites,
               sum(sv.montant_rembourse) as rembourse
          from sav sv group by sv.vente_id
      ) s on s.vente_id = v.id
     where v.vendeur_id = p_vendeur_id
     order by v.cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 200);
end $$;

grant execute on function ventes_vendeur(uuid, int) to authenticated;

-- ------------------------------------------------------------
-- Les ventes ouvrables en SAV, pour le formulaire : une ligne par couple
-- vente/produit encore couvrable, avec ce qui reste possible.
-- ------------------------------------------------------------
-- `drop` avant `create` : 0015 y ajoute une colonne de sortie, et l'ouvre aux
-- vendeurs pour leurs propres ventes.
drop function if exists ventes_savables(int);

create or replace function ventes_savables(p_limite int default 100)
returns table (
  vente_id       uuid,
  date           date,
  client         text,
  vendeur        text,
  produit_id     uuid,
  produit        text,
  quantite       int,
  deja_en_sav    int,
  restant        int,
  prix_unitaire  numeric(10,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.client, pr.nom,
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
          from sav sv group by sv.vente_id, sv.produit_id
      ) s on s.vente_id = vl.vente_id and s.produit_id = vl.produit_id
     where vl.quantite > coalesce(s.deja, 0)
     order by v.cree_le desc, p.nom
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

grant execute on function ventes_savables(int) to authenticated;
