-- ============================================================
-- StockFlow — 0005_ecritures.sql
-- Les seuls chemins d'écriture du stock et des ventes.
-- ============================================================
-- Toutes ces fonctions sont SECURITY DEFINER avec la garde en PREMIÈRE ligne,
-- et les INSERT/UPDATE/DELETE directs sont révoqués en 0009. C'est ce couple
-- qui rend les invariants tenables : il n'existe pas de chemin détourné.

-- ------------------------------------------------------------
-- Achat fournisseur → entrepôt. ATOMIQUE.
-- (Faire les 2 INSERT côté application laisserait une fenêtre où l'entrepôt
-- est crédité sans en-tête de restock, à réparer par compensation ; une RPC
-- rend la compensation inutile.)
--
-- p_lignes : [{"produit_id": "...", "quantite": 50}, ...]
-- ------------------------------------------------------------
create or replace function creer_restock_fournisseur(
  p_lignes      jsonb,
  p_prix_base   numeric,
  p_frais_port  numeric default 0,
  p_reference   text    default null,
  p_date        date    default current_date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restock_id uuid;
  v_qte_tot    int := 0;
  v_ligne      record;
  v_ligne_id   uuid;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne d''achat.' using errcode = '22023';
  end if;
  if p_prix_base < 0 or p_frais_port < 0 then
    raise exception 'Montants négatifs interdits.' using errcode = '22023';
  end if;

  select sum((l->>'quantite')::int) into v_qte_tot
    from jsonb_array_elements(p_lignes) l;
  if v_qte_tot is null or v_qte_tot <= 0 then
    raise exception 'Quantité totale invalide.' using errcode = '22023';
  end if;

  -- Les frais de port sont répartis sur les unités : le coût de revient réel
  -- inclut l'acheminement, sinon la marge est surévaluée.
  insert into restocks (date, reference, quantite_totale, prix_achat_base,
                        frais_port, prix_achat_unitaire, cree_par)
  values (p_date, p_reference, v_qte_tot, p_prix_base, p_frais_port,
          round((p_prix_base + p_frais_port) / v_qte_tot, 4), auth.uid())
  returning id into v_restock_id;

  for v_ligne in
    select (l->>'produit_id')::uuid as produit_id,
           sum((l->>'quantite')::int)::int as quantite
      from jsonb_array_elements(p_lignes) l
     group by 1
     order by 1
  loop
    if v_ligne.quantite <= 0 then
      raise exception 'Quantité invalide pour un produit.' using errcode = '22023';
    end if;

    insert into restock_lignes (restock_id, produit_id, quantite)
    values (v_restock_id, v_ligne.produit_id, v_ligne.quantite)
    returning id into v_ligne_id;

    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_restock_id, cree_par)
    values (v_ligne.produit_id, null, v_ligne.quantite, 'entree_achat',
            v_ligne_id, auth.uid());
  end loop;

  return v_restock_id;
end $$;

-- ------------------------------------------------------------
-- ENREGISTRER UNE VENTE.
-- Décrémente le stock DU VENDEUR (pas un pool global) et fige les 3 valeurs
-- comptables : prix pratiqué, commission, coût de revient.
--
-- p_lignes : [{"produit_id": "...", "quantite": 2, "prix_vente_unitaire": 12.50}, ...]
-- ------------------------------------------------------------
create or replace function enregistrer_vente(
  p_lignes     jsonb,
  p_client     text default 'Anonyme',
  p_date       date default current_date,
  p_vendeur_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_vendeur    uuid;
  v_commission numeric(10,2);
  v_vente_id   uuid;
  v_ligne      record;
  v_dispo      int;
  v_total      numeric(12,2) := 0;
  v_qte_tot    int := 0;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  -- Un non-admin ne peut jamais écrire une vente au nom d'un autre.
  v_vendeur := coalesce(p_vendeur_id, auth.uid());
  if v_vendeur <> auth.uid() and not est_admin() then
    raise exception 'Enregistrer pour un autre vendeur est réservé à l''administrateur.'
      using errcode = '42501';
  end if;

  select commission_unitaire into v_commission
    from profils where id = v_vendeur and actif;
  if not found then
    raise exception 'Vendeur inconnu ou inactif.' using errcode = '42501';
  end if;

  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne de vente.' using errcode = '22023';
  end if;

  -- En-tête d'abord : les mouvements ont besoin de son id (FK). Les totaux
  -- sont recalculés à la fin depuis les lignes réellement écrites.
  insert into ventes (date, vendeur_id, client, quantite_totale, montant_total)
  values (p_date, v_vendeur, coalesce(nullif(trim(p_client), ''), 'Anonyme'), 0, 0)
  returning id into v_vente_id;

  -- `group by` : deux lignes du même produit dans la même vente sont
  -- fusionnées (la contrainte unique(vente_id, produit_id) l'exige).
  -- `order by 1` : ordre de verrouillage déterministe, cf. verrouiller_stock().
  for v_ligne in
    select (l->>'produit_id')::uuid as produit_id,
           sum((l->>'quantite')::int)::int as quantite,
           max((l->>'prix_vente_unitaire')::numeric) as prix
      from jsonb_array_elements(p_lignes) l
     group by 1
     order by 1
  loop
    if v_ligne.quantite <= 0 then
      raise exception 'Quantité invalide.' using errcode = '22023';
    end if;
    if v_ligne.prix is null or v_ligne.prix < 0 then
      raise exception 'Prix de vente invalide.' using errcode = '22023';
    end if;

    -- VERROU AVANT LECTURE. Sans cet ordre, deux ventes concurrentes lisent
    -- le même stock disponible et le total peut passer sous zéro.
    perform verrouiller_stock(v_ligne.produit_id, v_vendeur);

    v_dispo := stock_detenu(v_ligne.produit_id, v_vendeur);
    if v_dispo < v_ligne.quantite then
      raise exception 'Stock insuffisant pour % : % demandée(s), % disponible(s).',
        coalesce((select nom from produits where id = v_ligne.produit_id), 'produit inconnu'),
        v_ligne.quantite, v_dispo
        using errcode = '23514';
    end if;

    -- Figeage comptable. cout_moyen_pondere() est évalué MAINTENANT : la
    -- ligne ne sera plus jamais revalorisée.
    insert into vente_lignes (vente_id, produit_id, quantite, prix_vente_unitaire,
                              commission_unitaire, cout_unitaire)
    values (v_vente_id, v_ligne.produit_id, v_ligne.quantite, v_ligne.prix,
            v_commission, cout_moyen_pondere(v_ligne.produit_id));

    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_vente_id, cree_par)
    values (v_ligne.produit_id, v_vendeur, -v_ligne.quantite, 'vente',
            v_vente_id, auth.uid());

    v_total   := v_total + v_ligne.quantite * v_ligne.prix;
    v_qte_tot := v_qte_tot + v_ligne.quantite;
  end loop;

  update ventes
     set quantite_totale = v_qte_tot, montant_total = v_total
   where id = v_vente_id;

  return v_vente_id;
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
-- Ajustement d'inventaire (perte, casse, écart de comptage).
-- Sans contrepartie : le motif est donc obligatoire (CHECK en 0004).
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

-- ------------------------------------------------------------
-- Annulation d'une vente.
-- Le `on delete cascade` de mouvements_stock.origine_vente_id restitue
-- automatiquement le stock AU BON DÉTENTEUR (le mouvement négatif disparaît).
--
-- LIMITE ASSUMÉE : un DELETE réécrit l'histoire. Le modèle propre serait la
-- contre-passation (un mouvement d'annulation au coût figé d'origine). Gardé
-- pour une v2 ; ici le garde-fou est de refuser l'annulation si des ventes
-- postérieures du même produit ont déjà figé un coût qui dépend de celle-ci.
-- ------------------------------------------------------------
create or replace function supprimer_vente(p_vente_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_date  date;
  v_apres int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select cree_le::date into v_date from ventes where id = p_vente_id;
  if not found then
    raise exception 'Vente introuvable.' using errcode = '02000';
  end if;

  select count(*) into v_apres
    from vente_lignes vl2
    join ventes v2 on v2.id = vl2.vente_id
   where v2.cree_le > (select cree_le from ventes where id = p_vente_id)
     and vl2.produit_id in (select produit_id from vente_lignes where vente_id = p_vente_id);

  if v_apres > 0 then
    raise exception
      'Annulation refusée : % vente(s) postérieure(s) ont figé un coût qui dépend de celle-ci. Passer par un ajustement de stock motivé.',
      v_apres using errcode = '23514';
  end if;

  delete from ventes where id = p_vente_id;
end $$;
