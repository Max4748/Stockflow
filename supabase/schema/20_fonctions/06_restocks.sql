-- ============================================================
-- StockFlow — Réassorts : demandes et achats fournisseur
-- ============================================================
-- Deux chemins distincts : la demande d'un vendeur, qu'un gérant traite,
-- et l'achat fournisseur qui fait entrer des unités dans l'entrepôt.
-- ------------------------------------------------------------

-- ============================================================
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
    -- On ne peut pas accorder plus que demandé (contrainte de table aussi).
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

-- ============================================================
-- Les seuls chemins d'écriture du stock et des ventes.
-- ============================================================
-- Toutes ces fonctions sont SECURITY DEFINER avec la garde en PREMIÈRE ligne,
-- et les INSERT/UPDATE/DELETE directs sont révoqués en couche 40. C'est ce couple
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

create or replace function modifier_restock(
  p_restock_id uuid,
  p_lignes     jsonb,
  p_prix_base  numeric,
  p_frais_port numeric default 0,
  p_reference  text    default null,
  p_date       date    default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_avant    jsonb;
  v_qte_tot  int;
  v_ligne    record;
  v_ligne_id uuid;
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

  perform 1 from restocks where id = p_restock_id for update;
  perform exiger_restock_reprenable(p_restock_id);

  select sum((l->>'quantite')::int) into v_qte_tot
    from jsonb_array_elements(p_lignes) l;
  if v_qte_tot is null or v_qte_tot <= 0 then
    raise exception 'Quantité totale invalide.' using errcode = '22023';
  end if;

  -- L'AVANT, relevé pendant qu'il existe encore.
  select jsonb_build_object('reference', reference, 'unites', quantite_totale,
                            'total', prix_achat_base + frais_port)
    into v_avant from restocks where id = p_restock_id;

  -- Les anciennes lignes partent, et leurs mouvements avec elles par cascade.
  delete from restock_lignes where restock_id = p_restock_id;

  update restocks
     set date                = coalesce(p_date, date),
         reference           = p_reference,
         quantite_totale     = v_qte_tot,
         prix_achat_base     = p_prix_base,
         frais_port          = p_frais_port,
         prix_achat_unitaire = round((p_prix_base + p_frais_port) / v_qte_tot, 4)
   where id = p_restock_id;

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
    values (p_restock_id, v_ligne.produit_id, v_ligne.quantite)
    returning id into v_ligne_id;

    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_restock_id, cree_par)
    values (v_ligne.produit_id, null, v_ligne.quantite, 'entree_achat',
            v_ligne_id, auth.uid());
  end loop;

  perform tracer_operation(
    'achat', p_restock_id, 'correction',
    format('Achat corrigé · %s', coalesce(p_reference, '(sans référence)')),
    v_qte_tot, (p_prix_base + p_frais_port)::numeric(12,2),
    jsonb_build_object('avant', v_avant));
end $$;

-- ============================================================
-- Les opérations qui effacent une écriture la déclarent.
-- ============================================================
-- Sur les fonctions destructrices, seul l'appel à
-- `tracer_operation()` est ajouté. Les recopier en entier est le prix du
-- `create or replace`.
--
-- La règle est la même partout : le libellé et les montants sont relevés
-- AVANT la suppression, pendant que l'entité existe. Les reconstituer après
-- coup serait impossible, et c'est tout l'objet de la table.
--
-- L'appel est APRÈS les gardes et DANS la même transaction : une opération
-- refusée n'écrit aucune trace, une trace qui échoue annule l'opération.
-- ------------------------------------------------------------

create or replace function supprimer_restock(p_restock_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reference text;
  v_quantite  int;
  v_montant   numeric(12,2);
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  perform 1 from restocks where id = p_restock_id for update;
  perform exiger_restock_reprenable(p_restock_id);

  -- Le libellé est rédigé MAINTENANT, tant que l'achat existe. Après le
  -- `delete`, ni la référence ni le montant ne sont reconstituables.
  select r.reference, r.quantite_totale, r.prix_achat_base + r.frais_port
    into v_reference, v_quantite, v_montant
    from restocks r where r.id = p_restock_id;

  perform tracer_operation(
    'achat', p_restock_id, 'annulation',
    format('Achat annulé · %s', coalesce(v_reference, '(sans référence)')),
    v_quantite, v_montant,
    jsonb_build_object('reference', v_reference));

  delete from restocks where id = p_restock_id;
end $$;

-- ============================================================
-- Corriger ou annuler un achat fournisseur.
-- ============================================================
-- Un achat se saisissait, jamais ne se reprenait. Or c'est la saisie la plus
-- exposée à l'erreur du projet : un total de commande et des quantités
-- recopiés d'une facture, souvent le soir même de la livraison.
--
-- LE MÊME GARDE-FOU QUE POUR UNE VENTE, pour la même raison. Un achat
-- ne se défait pas librement une fois qu'il a produit des effets :
--
--   1. STOCK. Les unités entrées ont pu être distribuées ou vendues. Les
--      retirer ferait passer l'entrepôt sous zéro, ce qu'aucune contrainte SQL
--      ne peut rattraper après coup — c'est l'invariant n°1 de
--      `verifier_coherence_stock()`.
--
--   2. COÛT FIGÉ. Chaque vente fige son `cout_unitaire` au coût moyen pondéré
--      de l'instant. Modifier un achat antérieur change ce coût moyen, mais
--      pas les lignes déjà figées : la marge affichée cesserait de
--      correspondre au prix réellement payé.
--
-- D'où un refus dès qu'une vente postérieure porte l'un des produits de
-- l'achat, et un message qui oriente vers l'ajustement de stock motivé, comme
-- son jumeau `supprimer_vente`.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- La garde, isolée : les deux fonctions ci-dessous l'appellent, et une règle
-- écrite deux fois est une règle qui divergera.
-- ------------------------------------------------------------
create or replace function exiger_restock_reprenable(p_restock_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cree_le timestamptz;
  v_apres   int;
  v_ligne   record;
  v_dispo   int;
begin
  select cree_le into v_cree_le from restocks where id = p_restock_id;
  if not found then
    raise exception 'Achat introuvable.' using errcode = '02000';
  end if;

  -- 1. Les unités sont-elles encore toutes en entrepôt ?
  for v_ligne in
    select produit_id, sum(quantite)::int as quantite
      from restock_lignes where restock_id = p_restock_id
     group by produit_id order by 1
  loop
    perform verrouiller_stock(v_ligne.produit_id, null);
    v_dispo := stock_detenu(v_ligne.produit_id, null);
    if v_dispo < v_ligne.quantite then
      raise exception
        'Reprise refusée : sur les % unité(s) de % achetées, % seulement sont encore en entrepôt. Passer par un ajustement de stock motivé.',
        v_ligne.quantite,
        coalesce((select nom from produits where id = v_ligne.produit_id), '?'),
        v_dispo
        using errcode = '23514';
    end if;
  end loop;

  -- 2. Une vente postérieure a-t-elle figé un coût qui en dépend ?
  select count(*) into v_apres
    from vente_lignes vl
    join ventes v on v.id = vl.vente_id
   where v.cree_le > v_cree_le
     and vl.produit_id in (select produit_id from restock_lignes
                            where restock_id = p_restock_id);

  if v_apres > 0 then
    raise exception
      'Reprise refusée : % vente(s) postérieure(s) ont figé un coût qui dépend de cet achat. Passer par un ajustement de stock motivé.',
      v_apres using errcode = '23514';
  end if;
end $$;
