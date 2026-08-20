-- ============================================================
-- StockFlow — 0007_dette.sql
-- Créances : ce que chaque vendeur doit à l'administrateur.
-- ============================================================
--
-- MODÈLE RETENU — « commission à la vente » :
--   Le vendeur encaisse le client, garde sa commission, reverse le solde.
--
--   dû = Σ(montant des ventes) − Σ(qté × commission FIGÉE) − Σ(versements)
--
-- La dette naît à la VENTE, pas au transfert : le stock non vendu qu'il
-- détient ne lui est jamais compté. C'est le modèle validé avec le patron.

-- ------------------------------------------------------------
-- Vue de synthèse par compte.
--
-- Les trois agrégats sont calculés dans des sous-requêtes SÉPARÉES. Joindre
-- ventes et vente_lignes puis sommer montant_total multiplierait le CA par le
-- nombre de lignes de chaque vente — erreur silencieuse et grossièrement
-- fausse (un CA doublé sur toute vente à 2 produits).
--
-- Cette vue est en SECURITY DEFINER (défaut) et REVOQUÉE à authenticated en
-- 0009 : l'accès passe par ma_dette() / creances(). `security_invoker = on`
-- serait le réglage plus sûr par défaut, mais il est impossible ici : le
-- calcul des commissions lit vente_lignes, table délibérément fermée aux
-- vendeurs (elle porte le coût d'achat).
--
-- `drop` avant `create`, même motif que pour creances() plus bas : 0014 insère
-- une colonne `rembourse` au milieu de la liste, et `create or replace view` ne
-- sait qu'ajouter des colonnes à la fin. Sans ce drop, le rejeu échoue ici.
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
  -- Le cas admin est neutralisé explicitement : sans ça le CA du patron
  -- apparaîtrait comme une dette envers lui-même.
  case when pr.role <> 'vendeur' then 0::numeric(12,2)
       else (coalesce(v.ca, 0) - coalesce(c.commissions, 0)
             - coalesce(ve.verse, 0))::numeric(12,2)
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
) ve on ve.vendeur_id = pr.id;

-- ------------------------------------------------------------
-- Le vendeur voit SA dette, au centime. Rien d'autre.
--
-- `drop` avant `create` : 0014 lui ajoute une colonne `rembourse`, et un
-- `create or replace` seul refuserait de rejouer ce fichier par-dessus.
-- ------------------------------------------------------------
drop function if exists ma_dette();

create or replace function ma_dette()
returns table (
  ca             numeric(12,2),
  commissions    numeric(12,2),
  verse          numeric(12,2),
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
    select c.ca, c.commissions, c.verse, c.reste_a_verser, c.nb_ventes, c.qte_vendue
      from v_comptes_vendeurs c
     where c.vendeur_id = auth.uid();
end $$;

-- ------------------------------------------------------------
-- L'admin voit toutes les créances.
--
-- `drop` avant `create` : les fichiers sont rejoués INTÉGRALEMENT dans l'ordre,
-- et 0013 redéfinit cette fonction avec une colonne de plus. Sans ce drop, le
-- rejeu échouerait ici sur « cannot change return type of existing function »,
-- la version en base étant alors celle de 0013. Le grant retiré par le drop est
-- reposé par 0009, qui passe après.
-- ------------------------------------------------------------
drop function if exists creances();

create or replace function creances()
returns table (
  vendeur_id     uuid,
  nom            text,
  actif          boolean,
  ca             numeric(12,2),
  commissions    numeric(12,2),
  verse          numeric(12,2),
  reste_a_verser numeric(12,2),
  nb_ventes      int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select c.vendeur_id, c.nom, c.actif, c.ca, c.commissions, c.verse,
           c.reste_a_verser, c.nb_ventes
      from v_comptes_vendeurs c
     where c.role = 'vendeur'
     order by c.reste_a_verser desc, c.nom;
end $$;

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
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  delete from versements where id = p_versement_id;
  if not found then
    raise exception 'Versement introuvable.' using errcode = '02000';
  end if;
end $$;
