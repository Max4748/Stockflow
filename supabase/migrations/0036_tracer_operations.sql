-- ============================================================
-- StockFlow — 0036_tracer_operations.sql
-- Les opérations qui effacent une écriture la déclarent.
-- ============================================================
-- Corps repris tels quels de 0012, 0022, 0026 et 0027 : seul l'appel à
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

create or replace function supprimer_sav(p_sav_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s       sav;
  v_produit text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select * into v_s from sav where id = p_sav_id;
  select nom into v_produit from produits where id = v_s.produit_id;

  delete from sav where id = p_sav_id;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;

  -- Supprimer efface le dossier ET son motif : c'est justement ce qui
  -- distingue `supprimer_sav` de `revoquer_sav`. La trace conserve ce que la
  -- suppression détruit.
  perform tracer_operation(
    'sav', p_sav_id, 'suppression',
    format('SAV supprimé · %s · %s', coalesce(v_produit, '?'),
           coalesce(v_s.motif, 'sans motif')),
    v_s.quantite, nullif(v_s.montant_rembourse, 0),
    jsonb_build_object('resolution', v_s.resolution, 'statut', v_s.statut));
end $$;

create or replace function retirer_produit(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nom   text;
  v_actif boolean;
  v_refs  int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select nom, actif into v_nom, v_actif from produits where id = p_id;
  if not found then
    raise exception 'Produit introuvable.' using errcode = '02000';
  end if;

  select (select count(*) from mouvements_stock where produit_id = p_id)
       + (select count(*) from vente_lignes     where produit_id = p_id)
       + (select count(*) from restock_lignes   where produit_id = p_id)
       + (select count(*) from sav              where produit_id = p_id)
       + (select count(*) from demande_lignes   where produit_id = p_id)
    into v_refs;

  if v_refs = 0 then
    perform tracer_operation('produit', p_id, 'suppression',
      format('Produit supprimé · %s', v_nom), null, null, null);

    delete from produits where id = p_id;
    return format('%s a été supprimé du catalogue.', v_nom);
  end if;

  -- Déjà inactif : le dire plutôt que de prétendre avoir agi. Sans ce cas,
  -- un second clic renverrait le même message de succès qu'au premier.
  if not v_actif then
    return format('%s est déjà inactif. Son historique interdit de le supprimer.', v_nom);
  end if;

  update produits set actif = false where id = p_id;

  perform tracer_operation('produit', p_id, 'désactivation',
    format('Produit désactivé · %s', v_nom), null, null,
    jsonb_build_object('references', v_refs));

  return format(
    '%s a un historique : il est passé INACTIF plutôt que supprimé. Il disparaît des listes de saisie, la comptabilité est conservée.',
    v_nom);
end $$;


create or replace function revoquer_sav(p_sav_id uuid, p_motif text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s      sav;
  v_motif  text := nullif(trim(coalesce(p_motif, '')), '');
  v_source uuid;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  if v_motif is null then
    raise exception 'Un motif est obligatoire pour révoquer un dossier validé.'
      using errcode = '23514';
  end if;

  select * into v_s from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if v_s.statut <> 'valide' then
    raise exception 'Seul un dossier validé se révoque (statut : %).', v_s.statut
      using errcode = '23514';
  end if;

  -- L'échange a fait sortir une unité : elle revient à son détenteur d'origine,
  -- celui d'où elle était sortie — jamais à l'entrepôt.
  if v_s.resolution = 'echange' then
    v_source := (select m.detenteur_id from mouvements_stock m
                  where m.origine_sav_id = v_s.id limit 1);
    perform verrouiller_stock(v_s.produit_id, v_source);
    delete from mouvements_stock where origine_sav_id = v_s.id;
  end if;

  update sav
     set statut      = 'refuse',
         motif_refus = v_motif,
         traite_le   = now(),
         traite_par  = auth.uid()
   where id = p_sav_id;

  -- Le dossier reste en base, mais le journal comptable ne montre que les SAV
  -- au statut `valide` : révoqué, il en disparaît. La trace dit ce qui a
  -- changé et pourquoi, là où le dossier n'est plus visible.
  perform tracer_operation(
    'sav', p_sav_id, 'révocation',
    format('SAV révoqué · %s · %s',
           coalesce((select nom from produits where id = v_s.produit_id), '?'),
           v_motif),
    v_s.quantite, nullif(v_s.montant_rembourse, 0),
    jsonb_build_object('resolution', v_s.resolution, 'motif_refus', v_motif));
end $$;

create or replace function modifier_vente(
  p_vente_id uuid,
  p_lignes   jsonb,
  p_client   text default null,
  p_date     date default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_avant      jsonb;
  v_vendeur    uuid;
  v_commission numeric(10,2);
  v_ligne      record;
  v_dispo      int;
  v_total      numeric(12,2) := 0;
  v_qte_tot    int := 0;
begin
  -- Sérialise deux corrections concurrentes de la même vente. Le verrou est
  -- pris AVANT toute lecture ou écriture.
  perform 1 from ventes where id = p_vente_id for update;

  perform droit_correction(p_vente_id);

  select vendeur_id into v_vendeur from ventes where id = p_vente_id;

  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception
      'Une vente sans ligne n''a pas de sens : pour la supprimer, utiliser l''annulation.'
      using errcode = '22023';
  end if;

  -- Commission d'origine, capturée AVANT la suppression des lignes. Toutes les
  -- lignes d'une vente partagent la même valeur (elle vient du profil au
  -- moment de la saisie).
  select commission_unitaire into v_commission
    from vente_lignes where vente_id = p_vente_id limit 1;
  if v_commission is null then
    select commission_unitaire into v_commission from profils where id = v_vendeur;
  end if;

  -- On défait l'ancienne version. Les mouvements pointent la VENTE, pas les
  -- lignes : il faut donc les supprimer explicitement.
  delete from mouvements_stock where origine_vente_id = p_vente_id;
  delete from vente_lignes      where vente_id        = p_vente_id;

  -- Puis on refait, avec exactement la mécanique d'enregistrer_vente().
  -- L'AVANT, relevé pendant que les anciennes lignes existent encore.
  select jsonb_build_object('unites', quantite_totale, 'montant', montant_total,
                            'client', client)
    into v_avant from ventes where id = p_vente_id;

  -- `group by` : deux lignes du même produit sont fusionnées (contrainte
  -- unique). `order by 1` : ordre de verrouillage déterministe.
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

    -- VERROU AVANT LECTURE, comme partout ailleurs.
    perform verrouiller_stock(v_ligne.produit_id, v_vendeur);

    -- Les anciens mouvements sont déjà supprimés : le stock lu inclut donc
    -- naturellement la restitution de l'ancienne version.
    v_dispo := stock_detenu(v_ligne.produit_id, v_vendeur);
    if v_dispo < v_ligne.quantite then
      raise exception 'Stock insuffisant pour % : % demandée(s), % disponible(s).',
        coalesce((select nom from produits where id = v_ligne.produit_id), 'produit inconnu'),
        v_ligne.quantite, v_dispo
        using errcode = '23514';
    end if;

    insert into vente_lignes (vente_id, produit_id, quantite, prix_vente_unitaire,
                              commission_unitaire, cout_unitaire)
    values (p_vente_id, v_ligne.produit_id, v_ligne.quantite, v_ligne.prix,
            v_commission, cout_moyen_pondere(v_ligne.produit_id));

    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_vente_id, cree_par)
    values (v_ligne.produit_id, v_vendeur, -v_ligne.quantite, 'vente',
            p_vente_id, auth.uid());

    v_total   := v_total + v_ligne.quantite * v_ligne.prix;
    v_qte_tot := v_qte_tot + v_ligne.quantite;
  end loop;

  update ventes
     set quantite_totale = v_qte_tot,
         montant_total   = v_total,
         client          = coalesce(nullif(trim(coalesce(p_client, '')), ''), client),
         date            = coalesce(p_date, date)
   where id = p_vente_id;

  -- Le journal comptable montre la vente CORRIGÉE, et rien ne dit qu'elle l'a
  -- été : les lignes d'origine ont été supprimées puis refaites. La trace
  -- conserve l'état d'avant, seul endroit où il subsiste.
  perform tracer_operation(
    'vente', p_vente_id, 'correction',
    format('Vente corrigée · %s', left(p_vente_id::text, 8)),
    v_qte_tot, v_total,
    jsonb_build_object('avant', v_avant));

  return p_vente_id;
end $$;
