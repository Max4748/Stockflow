-- ============================================================
-- StockFlow — 0006_demandes.sql
-- Demandes de réassort : le vendeur demande, l'admin arbitre.
-- ============================================================

-- ------------------------------------------------------------
-- Le vendeur crée sa demande.
-- p_lignes : [{"produit_id": "...", "quantite": 20}, ...]
--
-- Aucun contrôle de stock ici, volontairement : le stock disponible au moment
-- de la demande n'a pas d'importance, seul celui au moment du traitement
-- compte. Contrôler deux fois donnerait une fausse promesse au vendeur.
-- ------------------------------------------------------------
create or replace function creer_demande_restock(
  p_lignes jsonb,
  p_note   text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_demande_id uuid;
  v_ligne      record;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;
  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Une demande vide n''a pas de sens.' using errcode = '22023';
  end if;

  -- Message explicite plutôt que la violation brute de l'index unique
  -- partiel, que l'interface ne saurait pas traduire.
  if exists (select 1 from demandes_restock
              where vendeur_id = auth.uid() and statut = 'en_attente') then
    raise exception 'Une demande est déjà en attente. L''annuler avant d''en créer une nouvelle.'
      using errcode = '23505';
  end if;

  insert into demandes_restock (vendeur_id, note)
  values (auth.uid(), nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_demande_id;

  for v_ligne in
    select (l->>'produit_id')::uuid as produit_id,
           sum((l->>'quantite')::int)::int as quantite
      from jsonb_array_elements(p_lignes) l
     group by 1
  loop
    if v_ligne.quantite <= 0 then
      raise exception 'Quantité demandée invalide.' using errcode = '22023';
    end if;
    if not exists (select 1 from produits where id = v_ligne.produit_id and actif) then
      raise exception 'Produit inconnu ou inactif.' using errcode = '22023';
    end if;

    insert into demande_lignes (demande_id, produit_id, quantite_demandee)
    values (v_demande_id, v_ligne.produit_id, v_ligne.quantite);
  end loop;

  return v_demande_id;
end $$;

-- ------------------------------------------------------------
-- Le vendeur annule SA demande, tant qu'elle est en attente.
-- On passe par un statut 'annulee' plutôt qu'un DELETE : l'historique des
-- demandes fait partie de la relation commerciale.
-- ------------------------------------------------------------
create or replace function annuler_demande_restock(p_demande_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_d demandes_restock;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  -- `for update` : verrouille la ligne, sinon une annulation et un traitement
  -- admin simultanés pourraient tous deux se croire légitimes.
  select * into v_d from demandes_restock where id = p_demande_id for update;
  if not found then
    raise exception 'Demande introuvable.' using errcode = '02000';
  end if;
  if v_d.vendeur_id <> auth.uid() and not est_admin() then
    raise exception 'Cette demande n''est pas la vôtre.' using errcode = '42501';
  end if;
  if v_d.statut <> 'en_attente' then
    raise exception 'Demande déjà traitée (statut : %).', v_d.statut
      using errcode = '23514';
  end if;

  update demandes_restock set statut = 'annulee' where id = p_demande_id;
end $$;

-- ------------------------------------------------------------
-- L'ADMIN TRAITE LA DEMANDE. Le RPC le plus délicat du schéma.
--
-- p_decision        : 'approuver' | 'refuser'
-- p_lignes_accordees: [{"produit_id": "...", "quantite": 12}, ...]
--                     NULL → on accorde tout ce qui est demandé.
--                     Une quantité à 0 ou un produit absent → rien d'accordé
--                     pour ce produit.
--
-- Retourne le statut final : approuvee | partielle | refusee.
-- ------------------------------------------------------------
create or replace function traiter_demande_restock(
  p_demande_id       uuid,
  p_decision         text,
  p_lignes_accordees jsonb default null,
  p_motif            text  default null
) returns statut_demande
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_d          demandes_restock;
  v_ligne      record;
  v_accorde    int;
  v_dispo      int;
  v_groupe     uuid := gen_random_uuid();
  v_tot_acc    int := 0;
  v_tot_dem    int := 0;
  v_statut     statut_demande;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_decision not in ('approuver','refuser') then
    raise exception 'Décision invalide : attendu ''approuver'' ou ''refuser''.'
      using errcode = '22023';
  end if;

  -- IDEMPOTENCE : le verrou de ligne + le contrôle de statut garantissent
  -- qu'une demande ne peut pas être traitée deux fois, même si l'admin
  -- double-clique ou si deux onglets envoient la requête.
  select * into v_d from demandes_restock where id = p_demande_id for update;
  if not found then
    raise exception 'Demande introuvable.' using errcode = '02000';
  end if;
  if v_d.statut <> 'en_attente' then
    raise exception 'Demande déjà traitée (statut : %).', v_d.statut
      using errcode = '23514';
  end if;

  if p_decision = 'refuser' then
    update demandes_restock
       set statut      = 'refusee',
           motif_refus = nullif(trim(coalesce(p_motif, '')), ''),
           traitee_le  = now(),
           traitee_par = auth.uid()
     where id = p_demande_id;
    return 'refusee';
  end if;

  -- Approbation : on parcourt les lignes DEMANDÉES dans un ordre déterministe
  -- (produit_id croissant) pour respecter l'ordre de verrouillage global.
  for v_ligne in
    select dl.id, dl.produit_id, dl.quantite_demandee
      from demande_lignes dl
     where dl.demande_id = p_demande_id
     order by dl.produit_id
  loop
    v_tot_dem := v_tot_dem + v_ligne.quantite_demandee;

    if p_lignes_accordees is null then
      v_accorde := v_ligne.quantite_demandee;
    else
      select coalesce(sum((l->>'quantite')::int), 0) into v_accorde
        from jsonb_array_elements(p_lignes_accordees) l
       where (l->>'produit_id')::uuid = v_ligne.produit_id;
    end if;

    if v_accorde < 0 then
      raise exception 'Quantité accordée négative.' using errcode = '22023';
    end if;
    -- On ne peut pas accorder plus que demandé (contrainte en 0003 aussi).
    if v_accorde > v_ligne.quantite_demandee then
      raise exception 'Accordé (%) supérieur à demandé (%) pour %.',
        v_accorde, v_ligne.quantite_demandee,
        coalesce((select nom from produits where id = v_ligne.produit_id), '?')
        using errcode = '22023';
    end if;

    if v_accorde > 0 then
      -- Ordre imposé : entrepôt (NULL) puis vendeur, pour un même produit.
      perform verrouiller_stock(v_ligne.produit_id, null);
      perform verrouiller_stock(v_ligne.produit_id, v_d.vendeur_id);

      v_dispo := stock_detenu(v_ligne.produit_id, null);
      if v_dispo < v_accorde then
        raise exception
          'Stock entrepôt insuffisant pour % : % accordée(s), % disponible(s). Accorder une quantité partielle.',
          coalesce((select nom from produits where id = v_ligne.produit_id), '?'),
          v_accorde, v_dispo
          using errcode = '23514';
      end if;

      -- Les 2 jambes du transfert, de somme nulle : le stock total de la
      -- maison ne change pas, il change seulement de mains.
      insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                    groupe_id, origine_demande_id, cree_par)
      values (v_ligne.produit_id, null, -v_accorde, 'transfert',
              v_groupe, p_demande_id, auth.uid()),
             (v_ligne.produit_id, v_d.vendeur_id, v_accorde, 'transfert',
              v_groupe, p_demande_id, auth.uid());
    end if;

    update demande_lignes set quantite_accordee = v_accorde where id = v_ligne.id;
    v_tot_acc := v_tot_acc + v_accorde;
  end loop;

  -- Un « approuver » qui n'accorde rien est un refus dans les faits : on le
  -- nomme comme tel plutôt que de laisser une demande « approuvée » à 0.
  v_statut := case
                when v_tot_acc = 0         then 'refusee'
                when v_tot_acc < v_tot_dem then 'partielle'
                else 'approuvee'
              end;

  update demandes_restock
     set statut      = v_statut,
         motif_refus = nullif(trim(coalesce(p_motif, '')), ''),
         traitee_le  = now(),
         traitee_par = auth.uid()
   where id = p_demande_id;

  return v_statut;
end $$;
