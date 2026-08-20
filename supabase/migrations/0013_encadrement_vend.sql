-- ============================================================
-- StockFlow — 0013_encadrement_vend.sql
-- Un gérant (ou un dev) vend aussi.
-- ============================================================
--
-- Le schéma avait déjà prévu le cas : les RPC de l'espace vendeur sont gardées
-- par est_actif() et jamais par un test de rôle, et v_comptes_vendeurs (0007)
-- neutralise explicitement le solde d'un non-vendeur — « sans ça le CA du
-- patron apparaîtrait comme une dette envers lui-même ».
--
-- Restaient deux trous, comblés ici :
--   1. aucun moyen de DONNER du stock à un compte d'encadrement (le seul
--      transfert entrepôt → détenteur était traiter_demande_restock) ;
--   2. creances() et revenus_vendeurs() filtraient role = 'vendeur' alors que
--      bilan_global compte TOUTES les ventes — le CA d'un gérant gonflait le
--      bilan mais disparaissait du tableau des vendeurs.

-- ------------------------------------------------------------
-- TRANSFERT DIRECT entrepôt → détenteur.
--
-- Jusqu'ici, la seule façon de remettre du stock à quelqu'un était d'approuver
-- une demande de réassort : un gérant qui a les clés de l'entrepôt devait donc
-- s'écrire une demande à lui-même. Cette RPC est le pendant exact de
-- retourner_stock() (0005), dans l'autre sens.
--
-- AUCUN filtre de rôle sur le détenteur : c'est précisément ce qui permet à un
-- compte d'encadrement de détenir du stock et donc de vendre.
--
-- p_lignes : [{"produit_id": "...", "quantite": 20}, ...]
-- ------------------------------------------------------------
create or replace function transferer_stock(
  p_detenteur_id uuid,
  p_lignes       jsonb,
  p_motif        text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_groupe uuid := gen_random_uuid();
  v_ligne  record;
  v_dispo  int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_detenteur_id is null then
    raise exception 'Détenteur non précisé.' using errcode = '22023';
  end if;
  -- Le stock d'un compte désactivé serait immobilisé : il ne peut plus ni
  -- vendre ni rendre. Mieux vaut refuser l'envoi que le constater après coup.
  if not exists (select 1 from profils where id = p_detenteur_id and actif) then
    raise exception 'Compte inconnu ou inactif.' using errcode = '42501';
  end if;
  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne de transfert.' using errcode = '22023';
  end if;

  for v_ligne in
    select (l->>'produit_id')::uuid as produit_id,
           sum((l->>'quantite')::int)::int as quantite
      from jsonb_array_elements(p_lignes) l
     group by 1
     order by 1
  loop
    if v_ligne.quantite <= 0 then
      raise exception 'Quantité invalide.' using errcode = '22023';
    end if;

    -- Ordre imposé : produit_id croissant (le `order by` ci-dessus), et pour un
    -- même produit l'entrepôt (NULL) avant le détenteur. Voir verrouiller_stock()
    -- en 0004 : en dévier produirait des interblocages intermittents.
    perform verrouiller_stock(v_ligne.produit_id, null);
    perform verrouiller_stock(v_ligne.produit_id, p_detenteur_id);

    v_dispo := stock_detenu(v_ligne.produit_id, null);
    if v_dispo < v_ligne.quantite then
      raise exception
        'Stock entrepôt insuffisant pour % : % demandée(s), % disponible(s).',
        coalesce((select nom from produits where id = v_ligne.produit_id), '?'),
        v_ligne.quantite, v_dispo
        using errcode = '23514';
    end if;

    -- Les 2 jambes, de somme nulle : le stock total de la maison ne change
    -- pas, il change seulement de mains (invariant n°2 de
    -- verifier_coherence_stock()).
    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  groupe_id, motif, cree_par)
    values (v_ligne.produit_id, null, -v_ligne.quantite, 'transfert',
            v_groupe, nullif(trim(coalesce(p_motif, '')), ''), auth.uid()),
           (v_ligne.produit_id, p_detenteur_id, v_ligne.quantite, 'transfert',
            v_groupe, nullif(trim(coalesce(p_motif, '')), ''), auth.uid());
  end loop;

  return v_groupe;
end $$;

grant execute on function transferer_stock(uuid, jsonb, text) to authenticated;

comment on function transferer_stock(uuid, jsonb, text) is
  'Transfert entrepôt → détenteur, sans demande préalable. Aucun filtre de rôle : un compte d''encadrement peut détenir du stock et vendre.';

-- ------------------------------------------------------------
-- creances() et revenus_vendeurs() : l'encadrement qui a vendu y figure.
--
-- `create or replace` ne peut PAS changer les colonnes de sortie d'une
-- fonction (« cannot change return type of existing function ») : il faut
-- droper puis recréer. Le drop emporte le grant posé en 0009, qui est donc
-- reposé ici — sans quoi une base rejouée depuis zéro se retrouverait avec
-- deux écrans en « permission denied ».
--
-- Le filtre reste utile : un gérant qui n'a jamais vendu n'a rien à faire dans
-- une liste de vendeurs. Il n'y apparaît que le jour où il vend.
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
           c.reste_a_verser, c.nb_ventes
      from v_comptes_vendeurs c
     where c.role = 'vendeur' or c.nb_ventes > 0
     order by c.reste_a_verser desc, c.nom;
end $$;

grant execute on function creances() to authenticated;

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
  select pr.id, pr.nom, pr.role, pr.actif,
         coalesce(a.nb_ventes, 0)::int,
         coalesce(a.qte, 0)::int,
         coalesce(a.ca, 0)::numeric(12,2),
         coalesce(a.commissions, 0)::numeric(12,2),
         coalesce(a.marge, 0)::numeric(12,2)
    from profils pr
    left join agg a on a.vendeur_id = pr.id
   -- Un compte d'encadrement n'apparaît que s'il a vendu SUR LA PÉRIODE
   -- demandée : le tableau reste celui des vendeurs, pas celui des comptes.
   where pr.role = 'vendeur' or a.vendeur_id is not null
   order by coalesce(a.ca, 0) desc, pr.nom;
end $$;

grant execute on function revenus_vendeurs(date, date) to authenticated;

-- NOTE — bilan_global.montant_a_recuperer garde volontairement son
-- « where c.role = 'vendeur' » : un gérant ne se doit rien à lui-même, cet
-- agrégat reste juste tel quel.
