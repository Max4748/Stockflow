-- ============================================================
-- StockFlow — 0012_correction_ventes.sql
-- Le vendeur corrige ses ventes récentes lui-même.
-- ============================================================
--
-- Motivation : toute faute de frappe remontait au gérant, qui devenait un
-- goulot pour des erreurs triviales.

-- ------------------------------------------------------------
-- La fenêtre, définie en UN seul endroit. La changer ici la change partout,
-- y compris dans les messages d'erreur adressés au vendeur.
-- ------------------------------------------------------------
create or replace function fenetre_correction() returns interval
language sql immutable as $$ select interval '48 hours' $$;

grant execute on function fenetre_correction() to authenticated;

-- ------------------------------------------------------------
-- Droit de corriger une vente donnée. Factorisé parce que modifier_vente() et
-- supprimer_vente() doivent appliquer EXACTEMENT la même règle : deux copies
-- finiraient par divergerment.
--
-- Renvoie true si l'appelant est dans la fenêtre en tant que propriétaire.
-- Lève une exception s'il n'a aucun droit.
-- ------------------------------------------------------------
create or replace function droit_correction(p_vente_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_vendeur uuid;
  v_cree_le timestamptz;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  select vendeur_id, cree_le into v_vendeur, v_cree_le
    from ventes where id = p_vente_id;
  if not found then
    raise exception 'Vente introuvable.' using errcode = '02000';
  end if;

  -- Un gérant ou un dev corrige sans limite de temps.
  if est_admin() then
    return false;
  end if;

  if v_vendeur <> auth.uid() then
    raise exception 'Cette vente n''est pas la vôtre.' using errcode = '42501';
  end if;

  if v_cree_le < now() - fenetre_correction() then
    -- extract() plutôt que l'interval brut : sans ça le message afficherait
    -- « passé 48:00:00 », lisible par un développeur, pas par un vendeur.
    raise exception
      'Correction impossible passé % h. Demander au gérant.',
      (extract(epoch from fenetre_correction()) / 3600)::int
      using errcode = '42501';
  end if;

  return true;
end $$;

revoke execute on function droit_correction(uuid) from authenticated, anon, public;

-- ------------------------------------------------------------
-- MODIFIER UNE VENTE.
--
-- Principe : on défait puis on refait, dans la même transaction. Une fonction
-- plpgsql est atomique par construction, donc soit la nouvelle version est
-- complète, soit l'ancienne est intacte — jamais un état intermédiaire.
--
-- DEUX SOUS-DÉCISIONS COMPTABLES, à ne pas modifier sans y repenser :
--
-- 1. Le coût est REFIGÉ au CUMP courant. Après suppression des anciens
--    mouvements, le coût moyen se recalcule comme si la vente n'avait jamais
--    existé : reprendre ce CUMP est la seule valeur auto-cohérente. Conserver
--    l'ancien coût serait de toute façon impossible pour une quantité AJOUTÉE,
--    qui n'en a pas. Sur 48 h le CUMP ne bouge quasiment pas.
--
-- 2. La commission reste CELLE D'ORIGINE. C'est un terme contractuel au moment
--    de la vente : une correction ne le renégocie pas. Si le gérant a changé la
--    commission entre-temps, la vente corrigée garde l'ancienne.
--
-- p_lignes : [{"produit_id": "...", "quantite": 2, "prix_vente_unitaire": 12.50}, ...]
-- ------------------------------------------------------------
create or replace function modifier_vente(
  p_vente_id uuid,
  p_lignes   jsonb,
  p_client   text default null,
  p_date     date default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
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

  return p_vente_id;
end $$;

grant execute on function modifier_vente(uuid, jsonb, text, date) to authenticated;

-- ------------------------------------------------------------
-- ANNULER UNE VENTE — remplace la version de 0005.
--
-- Deux changements par rapport à l'originale :
--
-- 1. Le VENDEUR propriétaire peut annuler dans la fenêtre (avant : admin seul).
--
-- 2. Le garde-fou de dépendance de coût est LEVÉ dans la fenêtre. Ma version
--    initiale refusait dès qu'une vente postérieure du même produit existait,
--    par n'importe qui — ce qui rendait la correction impossible en pratique
--    sur une activité qui tourne.
--
--    La justification de l'assouplissement : les coûts déjà FIGÉS des autres
--    ventes ne changent pas quand on en supprime une, c'est précisément
--    l'intérêt du figeage. Le seul effet est un léger recalage du CUMP
--    *courant*, donc de la valorisation des ventes À VENIR. Mon garde-fou
--    était plus prudent que nécessaire.
--
--    Il est CONSERVÉ hors fenêtre : une annulation ancienne est rare et mérite
--    un ralentisseur.
-- ------------------------------------------------------------
create or replace function supprimer_vente(p_vente_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_dans_fenetre boolean;
  v_apres        int;
begin
  perform 1 from ventes where id = p_vente_id for update;

  -- Vérifie l'existence, l'appartenance et la fenêtre d'un seul coup.
  v_dans_fenetre := droit_correction(p_vente_id);

  if not v_dans_fenetre then
    select count(*) into v_apres
      from vente_lignes vl2
      join ventes v2 on v2.id = vl2.vente_id
     where v2.cree_le > (select cree_le from ventes where id = p_vente_id)
       and vl2.produit_id in (select produit_id from vente_lignes
                               where vente_id = p_vente_id);

    if v_apres > 0 then
      raise exception
        'Annulation refusée : % vente(s) postérieure(s) ont figé un coût qui dépend de celle-ci. Passer par un ajustement de stock motivé.',
        v_apres using errcode = '23514';
    end if;
  end if;

  -- Le `on delete cascade` de mouvements_stock.origine_vente_id restitue le
  -- stock AU BON DÉTENTEUR : le mouvement négatif disparaît avec la vente.
  delete from ventes where id = p_vente_id;
end $$;

-- ------------------------------------------------------------
-- Les ventes du vendeur connecté, avec l'indication de ce qu'il peut encore
-- corriger. Le calcul de la fenêtre est fait EN SQL : le laisser au client
-- laisserait croire qu'avancer l'horloge du téléphone ouvre la correction.
-- ------------------------------------------------------------
-- `drop` avant `create` : 0014 y ajoute les colonnes de SAV, et un
-- `create or replace` seul refuserait de rejouer ce fichier par-dessus.
drop function if exists mes_ventes(int);

create or replace function mes_ventes(p_limite int default 20)
returns table (
  id              uuid,
  date            date,
  client          text,
  quantite_totale int,
  montant_total   numeric(10,2),
  cree_le         timestamptz,
  corrigeable     boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.client, v.quantite_totale, v.montant_total, v.cree_le,
           (v.cree_le >= now() - fenetre_correction()) as corrigeable
      from ventes v
     where v.vendeur_id = auth.uid()
     order by v.cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

grant execute on function mes_ventes(int) to authenticated;
