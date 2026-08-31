-- ============================================================
-- StockFlow — Stock : registre signé, CUMP, cohérence
-- ============================================================
-- Le stock n'est jamais stocké : il se déduit du registre signé des
-- mouvements. `detenteur_id` NULL désigne l'entrepôt, d'où les `is not distinct
-- from` partout plutôt que des `=`.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Coût moyen pondéré GLISSANT (CUMP), par produit.
--
--   coût = (valeur achetée − valeur déjà sortie) / (unités achetées − unités sorties)
--
-- Le CUMP est GLOBAL, pas par détenteur : le coût d'achat est une propriété
-- de la marchandise, pas de qui la détient. Un transfert admin → vendeur
-- n'est pas une vente et ne doit donc rien revaloriser.
--
-- Conséquence à savoir énoncer au patron : la marge PAR VENTE est lissée (un
-- vendeur qui écoule du vieux stock bon marché est valorisé au CUMP courant).
-- La marge GLOBALE et PAR PÉRIODE restent exactes au centime. C'est la
-- nature du CUMP, pas un défaut d'implémentation.
--
-- EXECUTE est révoquée à tout le monde en couche 40 : cette fonction donne le prix
-- d'achat, qu'un vendeur ne doit jamais pouvoir calculer.
-- ------------------------------------------------------------
create or replace function cout_moyen_pondere(p_produit_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_qte_achetee   int     := 0;
  v_val_achetee   numeric := 0;
  v_qte_sortie    int     := 0;
  v_val_sortie    numeric := 0;
  v_reste         int;
  v_dernier_prix  numeric;
begin
  select coalesce(sum(rl.quantite), 0),
         coalesce(sum(rl.quantite * r.prix_achat_unitaire), 0)
    into v_qte_achetee, v_val_achetee
    from restock_lignes rl
    join restocks r on r.id = rl.restock_id
   where rl.produit_id = p_produit_id;

  select coalesce(sum(vl.quantite), 0),
         coalesce(sum(vl.quantite * vl.cout_unitaire), 0)
    into v_qte_sortie, v_val_sortie
    from vente_lignes vl
   where vl.produit_id = p_produit_id;

  v_reste := v_qte_achetee - v_qte_sortie;

  if v_reste > 0 then
    return round((v_val_achetee - v_val_sortie) / v_reste, 4);
  end if;

  -- Stock épuisé (ou jamais acheté) : on se replie sur le dernier prix
  -- d'achat connu. Sans ce repli, une vente juste après épuisement figerait
  -- un coût de 0 et afficherait une marge de 100 %.
  select r.prix_achat_unitaire into v_dernier_prix
    from restock_lignes rl
    join restocks r on r.id = rl.restock_id
   where rl.produit_id = p_produit_id
   order by r.date desc, r.cree_le desc
   limit 1;

  return coalesce(v_dernier_prix, 0);
end $$;

-- ------------------------------------------------------------
-- Lecture d'un stock ponctuel. Existe pour une raison précise : gérer le
-- NULL = entrepôt correctement (`is not distinct from`). Tout code qui
-- écrirait « detenteur_id = p_detenteur_id » compterait 0 pour l'entrepôt.
-- ------------------------------------------------------------
create or replace function stock_detenu(p_produit_id uuid, p_detenteur_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(quantite), 0)::int
    from mouvements_stock
   where produit_id = p_produit_id
     and detenteur_id is not distinct from p_detenteur_id;
$$;

-- ------------------------------------------------------------
-- Verrou de sérialisation.
--
-- Aucune contrainte SQL ne peut interdire un stock agrégé négatif : un CHECK
-- porte sur une ligne, pas sur un sum(). La seule garantie est que tout
-- chemin d'écriture prenne CE verrou AVANT de lire le stock, dans la même
-- transaction. Deux ventes concurrentes du même produit se sérialisent alors
-- au lieu de lire toutes les deux « il en reste 1 ».
--
-- RÈGLE DE REVUE pour tout futur RPC d'écriture, la seule qui compte :
--   prend-il le verrou AVANT de lire le stock ?
--
-- ORDRE DE VERROUILLAGE IMPOSÉ, sous peine d'interblocage intermittent :
--   produits par produit_id croissant, et pour un même produit
--   l'entrepôt (NULL) avant un vendeur.
-- ------------------------------------------------------------
create or replace function verrouiller_stock(p_produit_id uuid, p_detenteur_id uuid)
returns void
language sql security definer set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(
    hashtext(p_produit_id::text || '/' || coalesce(p_detenteur_id::text, 'entrepot'))
  );
$$;

-- ------------------------------------------------------------
-- Le détenteur dont un compte tire son stock.
--
-- NULL = l'entrepôt, la même convention que partout ailleurs. Une seule
-- définition, appelée par la lecture comme par l'écriture : les deux doivent
-- désigner la même source, sinon l'écran de vente propose ce que la vente
-- refusera.
-- ------------------------------------------------------------
create or replace function source_stock(p_id uuid default null)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p.stock_lie_entrepot then null else p.id end
    from profils p
   where p.id = coalesce(p_id, auth.uid());
$$;

-- ------------------------------------------------------------
-- Lecture : le stock que l'appelant peut vendre.
-- ------------------------------------------------------------
create or replace function stock_disponible()
returns table (produit_id uuid, produit text, quantite int, seuil_alerte int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_source uuid;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  v_source := source_stock();

  return query
    select p.id, p.nom,
           coalesce(s.quantite, 0)::int,
           p.seuil_alerte
      from produits p
      -- `is not distinct from` : `= NULL` vaut toujours NULL, et l'entrepôt
      -- EST le détenteur NULL. Piège documenté dans donnees.md.
      left join v_stock_detenteur s
             on s.produit_id = p.id and s.detenteur_id is not distinct from v_source
     where p.actif or coalesce(s.quantite, 0) <> 0
     order by p.nom;
end $$;

-- ------------------------------------------------------------
-- Ajustement d'inventaire (perte, casse, écart de comptage).
-- Sans contrepartie : le motif est donc obligatoire (CHECK de `mouvements_stock`).
-- p_detenteur_id = NULL → ajuste l'entrepôt.
-- ------------------------------------------------------------
create or replace function ajuster_stock(
  p_produit_id   uuid,
  p_delta        integer,
  p_motif        text,
  p_detenteur_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    uuid;
  v_dispo int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_delta = 0 then
    raise exception 'Un ajustement nul n''a pas de sens.' using errcode = '22023';
  end if;
  if p_motif is null or trim(p_motif) = '' then
    raise exception 'Motif obligatoire pour un ajustement.' using errcode = '22023';
  end if;

  perform verrouiller_stock(p_produit_id, p_detenteur_id);

  if p_delta < 0 then
    v_dispo := stock_detenu(p_produit_id, p_detenteur_id);
    if v_dispo < abs(p_delta) then
      raise exception 'Ajustement impossible : % disponible(s), % retirée(s).',
        v_dispo, abs(p_delta) using errcode = '23514';
    end if;
  end if;

  insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                               motif, cree_par)
  values (p_produit_id, p_detenteur_id, p_delta, 'ajustement',
          trim(p_motif), auth.uid())
  returning id into v_id;

  return v_id;
end $$;

-- ============================================================
-- Un gérant (ou un dev) vend aussi.
-- ============================================================
--
-- Le schéma avait déjà prévu le cas : les RPC de l'espace vendeur sont gardées
-- par est_actif() et jamais par un test de rôle, et v_comptes_vendeurs
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
-- retourner_stock(), dans l'autre sens.
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
    -- par `verrouiller_stock` : en dévier produirait des interblocages intermittents.
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

-- ------------------------------------------------------------
-- Retour vendeur → entrepôt. 2 jambes appariées par groupe_id.
-- p_lignes : [{"produit_id": "...", "quantite": 3}, ...]
-- ------------------------------------------------------------
create or replace function retourner_stock(
  p_vendeur_id uuid,
  p_lignes     jsonb,
  p_motif      text default null,
  p_date       date default current_date
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
  if p_vendeur_id is null then
    raise exception 'Vendeur non précisé.' using errcode = '22023';
  end if;
  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne de retour.' using errcode = '22023';
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

    -- Ordre imposé : entrepôt (NULL) avant vendeur, pour un même produit.
    perform verrouiller_stock(v_ligne.produit_id, null);
    perform verrouiller_stock(v_ligne.produit_id, p_vendeur_id);

    v_dispo := stock_detenu(v_ligne.produit_id, p_vendeur_id);
    if v_dispo < v_ligne.quantite then
      raise exception 'Le vendeur ne détient que % unité(s) de %.',
        v_dispo, coalesce((select nom from produits where id = v_ligne.produit_id), '?')
        using errcode = '23514';
    end if;

    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  groupe_id, motif, cree_par)
    values (v_ligne.produit_id, p_vendeur_id, -v_ligne.quantite, 'retour',
            v_groupe, p_motif, auth.uid()),
           (v_ligne.produit_id, null, v_ligne.quantite, 'retour',
            v_groupe, p_motif, auth.uid());
  end loop;

  return v_groupe;
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

-- ============================================================
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
