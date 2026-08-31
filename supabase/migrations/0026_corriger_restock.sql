-- ============================================================
-- StockFlow — 0026_corriger_restock.sql
-- Corriger ou annuler un achat fournisseur.
-- ============================================================
-- Un achat se saisissait, jamais ne se reprenait. Or c'est la saisie la plus
-- exposée à l'erreur du projet : un total de commande et des quantités
-- recopiés d'une facture, souvent le soir même de la livraison.
--
-- LE MÊME GARDE-FOU QUE POUR UNE VENTE (0012), pour la même raison. Un achat
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

-- ------------------------------------------------------------
-- Annuler un achat.
--
-- Le `on delete cascade` fait tout le travail : restocks → restock_lignes →
-- mouvements_stock. Les unités quittent l'entrepôt par le même chemin
-- qu'elles y sont entrées, sans écriture compensatoire.
-- ------------------------------------------------------------
create or replace function supprimer_restock(p_restock_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  perform 1 from restocks where id = p_restock_id for update;
  perform exiger_restock_reprenable(p_restock_id);

  delete from restocks where id = p_restock_id;
end $$;

-- ------------------------------------------------------------
-- Corriger un achat : DÉFAIT puis REFAIT, dans la même transaction.
--
-- Même parti pris que `modifier_vente` (0012) : recalculer les écarts ligne à
-- ligne demanderait de gérer l'ajout, le retrait et la variation de quantité,
-- trois chemins pour un résultat que la recréation donne en un seul.
--
-- L'EN-TÊTE EST CONSERVÉ, seules les lignes sont refaites. Déléguer à
-- `creer_restock_fournisseur` aurait été plus court, mais aurait donné un
-- nouvel `id` et surtout un nouveau `cree_le` — or c'est `cree_le` que
-- `exiger_restock_reprenable` compare aux ventes. Une correction aurait donc
-- desserré la garde qu'elle venait de franchir.
-- ------------------------------------------------------------
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
end $$;

grant execute on function supprimer_restock(uuid) to authenticated;
grant execute on function modifier_restock(uuid, jsonb, numeric, numeric, text, date)
  to authenticated;
