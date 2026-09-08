-- ============================================================
-- StockFlow — Prélèvements personnels
-- ============================================================
-- Un vendeur repart avec de la marchandise pour lui. Il n'encaisse rien, donc
-- il doit le prix convenu : `v_comptes_vendeurs` l'ajoute à `reste_a_verser`.
-- Rien n'entre dans `ventes`, donc rien ne touche le chiffre d'affaires.
--
-- RÉSERVÉ AU RÔLE `vendeur`, et pas seulement par cohérence métier : la
-- contrainte `mvt_coherence` exige un `detenteur_id` non nul sur un mouvement
-- de type `prelevement`. Or un compte d'encadrement lié à l'entrepôt a
-- `source_stock() = null`. Un tel prélèvement violerait la contrainte, et de
-- toute façon `reste_a_verser` vaut 0 pour un non-vendeur : la dette ne serait
-- comptée nulle part.
-- ------------------------------------------------------------

-- Le tarif applicable : l'exception si elle existe, sinon le repli.
--
-- Le repli `prix_vente_conseille - commission_unitaire` n'est pas arbitraire :
-- c'est exactement ce qu'un vendeur devrait à la maison après avoir vendu
-- l'unité au prix conseillé et gardé sa commission. Prélever au tarif par
-- défaut revient donc au même que vendre.
--
-- `greatest(0, …)` parce qu'une commission supérieure au prix conseillé
-- donnerait un tarif négatif, c'est-à-dire une dette qui diminue en prenant de
-- la marchandise.
-- SIGNATURE INCHANGÉE, et c'est délibéré : `enregistrer_prelevement` travaille
-- sur un parfum, pas sur un modèle. La fonction remonte au modèle elle-même, et
-- tout le flux de prélèvement reste intact.
create or replace function prix_preleve(p_vendeur uuid, p_produit uuid)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select pp.prix
       from prix_preleves pp
       join produits pr on pr.modele_id = pp.modele_id
      where pp.vendeur_id = p_vendeur and pr.id = p_produit),
    greatest(
      0,
      coalesce((select mo.prix_vente_conseille
                  from produits pr join modeles mo on mo.id = pr.modele_id
                 where pr.id = p_produit), 0)
      - coalesce((select p.commission_unitaire from profils p where p.id = p_vendeur), 0)
    )
  )::numeric(10,2);
$$;

-- ------------------------------------------------------------
-- Poser ou retirer une exception de tarif, PAR MODÈLE. `p_prix` à NULL remet
-- le repli.
-- ------------------------------------------------------------
-- `drop` obligatoire : renommer un paramètre d'entrée l'exige, `create or
-- replace` refuse. Le grant part avec, la couche 40 le repose.
drop function if exists definir_prix_preleve(uuid, uuid, numeric);

create or replace function definir_prix_preleve(
  p_vendeur uuid,
  p_modele  uuid,
  p_prix    numeric default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role   text;
  v_modele text;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_vendeur;
  if not found then
    raise exception 'Compte inconnu.' using errcode = '22023';
  end if;
  perform exiger_gestion_de(v_role);
  if v_role <> 'vendeur' then
    raise exception 'Seul un vendeur prélève de la marchandise.' using errcode = '22023';
  end if;

  select nom into v_modele from modeles where id = p_modele;
  if not found then
    raise exception 'Modèle inconnu.' using errcode = '22023';
  end if;

  if p_prix is null then
    delete from prix_preleves
     where vendeur_id = p_vendeur and modele_id = p_modele;
    perform tracer_admin('tarif de prélèvement remis au défaut', p_vendeur,
      jsonb_build_object('modele', v_modele), null);
    return;
  end if;

  if p_prix < 0 then
    raise exception 'Un tarif ne peut pas être négatif.' using errcode = '22023';
  end if;

  insert into prix_preleves (vendeur_id, modele_id, prix, defini_par)
  values (p_vendeur, p_modele, p_prix, auth.uid())
  on conflict (vendeur_id, modele_id) do update
    set prix = excluded.prix, defini_le = now(), defini_par = auth.uid();

  perform tracer_admin('tarif de prélèvement', p_vendeur, null,
    jsonb_build_object('modele', v_modele, 'prix', p_prix));
end $$;

-- ------------------------------------------------------------
-- Prendre de la marchandise pour soi.
--
-- La sortie vient du stock QUE LE VENDEUR DÉTIENT, jamais de l'entrepôt : un
-- prélèvement n'est pas un réassort déguisé. S'il n'a pas l'unité chez lui, il
-- la demande d'abord.
-- ------------------------------------------------------------
create or replace function enregistrer_prelevement(
  p_produit_id uuid,
  p_quantite   int,
  p_vendeur_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_vendeur uuid;
  v_role    text;
  v_prix    numeric(10,2);
  v_dispo   int;
  v_id      uuid;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  v_vendeur := coalesce(p_vendeur_id, auth.uid());
  if v_vendeur <> auth.uid() and not est_admin() then
    raise exception 'Prélever pour un autre compte est réservé aux gérants.'
      using errcode = '42501';
  end if;

  select role into v_role from profils where id = v_vendeur and actif;
  if not found then
    raise exception 'Compte inconnu ou inactif.' using errcode = '42501';
  end if;
  if v_role <> 'vendeur' then
    raise exception 'Seul un vendeur prélève de la marchandise.' using errcode = '22023';
  end if;
  if v_vendeur <> auth.uid() then
    perform exiger_gestion_de(v_role);
  end if;

  if p_quantite is null or p_quantite <= 0 then
    raise exception 'Quantité invalide.' using errcode = '22023';
  end if;
  if not exists (select 1 from produits where id = p_produit_id) then
    raise exception 'Produit inconnu.' using errcode = '22023';
  end if;

  -- Même verrou que pour une vente : deux prises simultanées se croiraient
  -- toutes deux légitimes sur le dernier exemplaire.
  perform verrouiller_stock(p_produit_id, v_vendeur);
  v_dispo := stock_detenu(p_produit_id, v_vendeur);
  if v_dispo < p_quantite then
    raise exception 'Stock insuffisant pour % : % demandée(s), % disponible(s).',
      coalesce((select nom from produits where id = p_produit_id), 'produit inconnu'),
      p_quantite, v_dispo
      using errcode = '23514';
  end if;

  v_prix := prix_preleve(v_vendeur, p_produit_id);

  insert into prelevements (vendeur_id, produit_id, quantite, prix_unitaire, cree_par)
  values (v_vendeur, p_produit_id, p_quantite, v_prix, auth.uid())
  returning id into v_id;

  insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                origine_prelevement_id, cree_par)
  values (p_produit_id, v_vendeur, -p_quantite, 'prelevement', v_id, auth.uid());

  return v_id;
end $$;

-- ------------------------------------------------------------
-- Annuler une prise. La cascade de `origine_prelevement_id` rend l'unité au
-- stock du vendeur, et la dette retombe d'elle-même.
--
-- Réservé aux gérants : c'est une écriture qui pèse sur une dette, et la
-- laisser défaire par son propre débiteur demanderait au minimum la fenêtre de
-- correction des ventes. Le geste passe donc par celui qui encadre.
-- ------------------------------------------------------------
create or replace function supprimer_prelevement(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p record;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;

  select pl.*, pr.nom as produit_nom, po.nom as vendeur_nom, po.role as vendeur_role
    into v_p
    from prelevements pl
    join produits pr on pr.id = pl.produit_id
    join profils  po on po.id = pl.vendeur_id
   where pl.id = p_id;
  if not found then
    raise exception 'Prélèvement introuvable.' using errcode = '22023';
  end if;
  perform exiger_gestion_de(v_p.vendeur_role);

  -- Tracé AVANT la suppression : le libellé cite un produit et un vendeur que
  -- la ligne effacée ne dira plus.
  perform tracer_operation(
    'prelevement', p_id, 'suppression',
    format('Prélèvement annulé · %s · %s × %s', v_p.vendeur_nom, v_p.quantite, v_p.produit_nom),
    v_p.quantite, (v_p.quantite * v_p.prix_unitaire)::numeric(12,2));

  delete from prelevements where id = p_id;
end $$;

-- ------------------------------------------------------------
-- Lectures.
-- ------------------------------------------------------------
create or replace function mes_prelevements(p_limite int default 20)
returns table (
  id            uuid,
  produit       text,
  quantite      int,
  prix_unitaire numeric(10,2),
  montant       numeric(12,2),
  cree_le       timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;
  return query
    select pl.id, mo.nom || ' · ' || pr.nom, pl.quantite, pl.prix_unitaire,
           (pl.quantite * pl.prix_unitaire)::numeric(12,2), pl.cree_le
      from prelevements pl
      join produits pr on pr.id = pl.produit_id
      join modeles  mo on mo.id = pr.modele_id
     where pl.vendeur_id = auth.uid()
     order by pl.cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

create or replace function prelevements_vendeur(
  p_vendeur_id uuid,
  p_limite     int default 20
) returns table (
  id            uuid,
  produit       text,
  quantite      int,
  prix_unitaire numeric(10,2),
  montant       numeric(12,2),
  cree_le       timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;
  return query
    select pl.id, mo.nom || ' · ' || pr.nom, pl.quantite, pl.prix_unitaire,
           (pl.quantite * pl.prix_unitaire)::numeric(12,2), pl.cree_le
      from prelevements pl
      join produits pr on pr.id = pl.produit_id
      join modeles  mo on mo.id = pr.modele_id
     where pl.vendeur_id = p_vendeur_id
     order by pl.cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

-- Le tarif applicable à chaque MODÈLE pour un vendeur donné, exceptions et
-- replis mêlés. C'est ce que lit l'écran de tarification : sans `personnalise`,
-- impossible de distinguer un tarif choisi d'un tarif qui suit le conseillé.
--
-- UN VENDEUR PEUT LIRE LES SIENS. Il doit savoir ce que va lui coûter une prise
-- avant de la faire : lui cacher le tarif reviendrait à lui faire signer une
-- dette dont il ignore le montant. Il ne voit que les siens, jamais ceux d'un
-- autre.
drop function if exists tarifs_preleves(uuid);

create or replace function tarifs_preleves(p_vendeur_id uuid)
returns table (
  modele_id            uuid,
  modele               text,
  prix_vente_conseille numeric(10,2),
  prix_effectif        numeric(10,2),
  personnalise         boolean,
  nb_parfums           int
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_vendeur_id <> auth.uid() and not est_admin() then
    raise exception 'Consulter les tarifs d''un autre compte est réservé aux gérants.'
      using errcode = '42501';
  end if;
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select mo.id, mo.nom, mo.prix_vente_conseille,
           coalesce(
             pp.prix,
             greatest(0, mo.prix_vente_conseille
                         - coalesce((select p.commission_unitaire
                                       from profils p where p.id = p_vendeur_id), 0))
           )::numeric(10,2),
           pp.prix is not null,
           (select count(*)::int from produits pr
             where pr.modele_id = mo.id and pr.actif)
      from modeles mo
      left join prix_preleves pp
             on pp.modele_id = mo.id and pp.vendeur_id = p_vendeur_id
     where mo.actif
     order by mo.nom;
end $$;
