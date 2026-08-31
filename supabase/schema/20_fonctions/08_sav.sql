-- ============================================================
-- StockFlow — SAV : déclaration, arbitrage, révocation
-- ============================================================
-- Un SAV déclaré par un vendeur retire l'unité de son stock et attend
-- l'arbitrage d'un gérant. Le statut porte tout : `valide`, `en_attente`,
-- `refuse`, `annule`.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- DÉCLARER UN SAV — désormais ouverte au vendeur pour SES ventes.
--
-- Le régime (immédiat ou soumis à validation) n'est PAS un paramètre : il se
-- déduit de qui appelle et du dénouement choisi. Un paramètre serait une
-- porte ouverte, puisqu'une Server Action est une URL comme une autre.
-- ------------------------------------------------------------
create or replace function declarer_sav(
  p_vente_id     uuid,
  p_produit_id   uuid,
  p_quantite     integer,
  p_resolution   text,
  p_motif        text,
  p_montant      numeric default 0,
  p_detenteur_id uuid    default null,
  p_depuis_entrepot boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sav_id     uuid;
  v_vendeur    uuid;
  v_admin      boolean := est_admin();
  v_statut     text;
  v_vendue     int;
  v_deja       int;
  v_prix       numeric(10,2);
  v_max        numeric(12,2);
  v_source     uuid;
  v_dispo      int;
  v_produit    text := coalesce((select nom from produits where id = p_produit_id), '?');
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;
  if p_resolution not in ('echange','remboursement') then
    raise exception 'Dénouement invalide : attendu ''echange'' ou ''remboursement''.'
      using errcode = '22023';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'Quantité invalide.' using errcode = '22023';
  end if;
  if p_motif is null or trim(p_motif) = '' then
    raise exception 'Motif obligatoire : « SAV » seul n''explique rien six mois plus tard.'
      using errcode = '22023';
  end if;

  select v.vendeur_id into v_vendeur from ventes v where v.id = p_vente_id;
  if not found then
    raise exception 'Vente introuvable.' using errcode = '02000';
  end if;
  -- Un vendeur n'ouvre un dossier que sur SES ventes. Sans ce contrôle, il
  -- pourrait faire baisser le stock d'un collègue.
  if not v_admin and v_vendeur <> auth.uid() then
    raise exception 'Cette vente n''est pas la vôtre.' using errcode = '42501';
  end if;

  select vl.quantite, vl.prix_vente_unitaire into v_vendue, v_prix
    from vente_lignes vl
   where vl.vente_id = p_vente_id and vl.produit_id = p_produit_id;
  if not found then
    raise exception 'Cette vente ne contient pas de %.', v_produit
      using errcode = '02000';
  end if;

  -- Les dossiers EN ATTENTE comptent dans le cumul : sans cela, déclarer deux
  -- fois la même unité avant l'arbitrage passerait les deux fois.
  select coalesce(sum(s.quantite), 0) into v_deja
    from sav s
   where s.vente_id = p_vente_id and s.produit_id = p_produit_id
     and s.statut in ('valide','en_attente');

  if v_deja + p_quantite > v_vendue then
    raise exception
      'SAV impossible : % unité(s) vendue(s) de %, % déjà en SAV, % demandée(s).',
      v_vendue, v_produit, v_deja, p_quantite
      using errcode = '23514';
  end if;

  if p_resolution = 'remboursement' then
    v_max := (p_quantite * v_prix)::numeric(12,2);
    if p_montant is null or p_montant <= 0 then
      raise exception 'Le montant remboursé doit être strictement positif.'
        using errcode = '22023';
    end if;
    if p_montant > v_max then
      raise exception
        'Remboursement supérieur au payé : % € maximum pour % unité(s) de % à % €.',
        to_char(v_max, 'FM999999990.00'), p_quantite, v_produit,
        to_char(v_prix, 'FM999999990.00')
        using errcode = '23514';
    end if;
  end if;

  -- LA RÈGLE, en une expression. Un gérant tranche seul ; un vendeur agit seul
  -- sur la marchandise et demande pour l'argent.
  v_statut := case
                when v_admin then 'valide'
                when p_resolution = 'echange' then 'valide'
                else 'en_attente'
              end;

  insert into sav (vente_id, produit_id, quantite, resolution,
                   montant_rembourse, motif, statut, cree_par,
                   traite_le, traite_par)
  values (p_vente_id, p_produit_id, p_quantite, p_resolution,
          case when p_resolution = 'remboursement' then p_montant else 0 end,
          trim(p_motif), v_statut, auth.uid(),
          case when v_statut = 'valide' then now() end,
          case when v_statut = 'valide' then auth.uid() end)
  returning id into v_sav_id;

  if p_resolution = 'echange' then
    -- L'unité de remplacement sort du stock du vendeur de la vente : c'est lui
    -- qui est face au client. `p_depuis_entrepot` est une commodité de gérant —
    -- un vendeur n'a pas accès à l'entrepôt, le paramètre est ignoré pour lui.
    if v_admin and p_depuis_entrepot then
      v_source := null;
    elsif v_admin then
      v_source := coalesce(p_detenteur_id, v_vendeur);
    else
      v_source := auth.uid();
    end if;

    perform verrouiller_stock(p_produit_id, v_source);

    v_dispo := stock_detenu(p_produit_id, v_source);
    if v_dispo < p_quantite then
      raise exception 'Stock insuffisant pour l''échange : % demandée(s), % disponible(s) chez %.',
        p_quantite, v_dispo,
        coalesce((select nom from profils where id = v_source), 'l''entrepôt')
        using errcode = '23514';
    end if;

    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_sav_id, motif, cree_par)
    values (p_produit_id, v_source, -p_quantite, 'sav',
            v_sav_id, trim(p_motif), auth.uid());
  end if;

  return v_sav_id;
end $$;

-- ------------------------------------------------------------
-- L'arbitrage du gérant.
--
-- `for update` : verrouille la ligne, sinon une validation et un refus
-- simultanés se croiraient tous deux légitimes — même motif que pour
-- les demandes de réassort.
-- ------------------------------------------------------------
create or replace function valider_sav(p_sav_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s      sav;
  v_source uuid;
  v_dispo  int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select * into v_s from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if v_s.statut <> 'en_attente' then
    raise exception 'Dossier déjà traité (statut : %).', v_s.statut
      using errcode = '23514';
  end if;

  -- Un échange en attente ne devrait pas exister (ils sont validés d'emblée),
  -- mais la fonction reste correcte s'il s'en présentait un : le mouvement se
  -- fait à la validation, jamais deux fois.
  if v_s.resolution = 'echange'
     and not exists (select 1 from mouvements_stock m where m.origine_sav_id = v_s.id)
  then
    v_source := (select vendeur_id from ventes where id = v_s.vente_id);
    perform verrouiller_stock(v_s.produit_id, v_source);
    v_dispo := stock_detenu(v_s.produit_id, v_source);
    if v_dispo < v_s.quantite then
      raise exception 'Stock insuffisant pour l''échange : % demandée(s), % disponible(s).',
        v_s.quantite, v_dispo using errcode = '23514';
    end if;
    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  origine_sav_id, motif, cree_par)
    values (v_s.produit_id, v_source, -v_s.quantite, 'sav',
            v_s.id, v_s.motif, auth.uid());
  end if;

  update sav set statut = 'valide', traite_le = now(), traite_par = auth.uid()
   where id = p_sav_id;
end $$;

-- ------------------------------------------------------------
-- Refuser. Le dossier est CONSERVÉ plutôt que supprimé : un refus fait partie
-- de la relation avec le vendeur, et lui doit savoir pourquoi.
-- ------------------------------------------------------------
create or replace function refuser_sav(p_sav_id uuid, p_motif text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_statut text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select statut into v_statut from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if v_statut <> 'en_attente' then
    raise exception 'Dossier déjà traité (statut : %).', v_statut
      using errcode = '23514';
  end if;

  update sav
     set statut      = 'refuse',
         motif_refus = nullif(trim(coalesce(p_motif, '')), ''),
         traite_le   = now(),
         traite_par  = auth.uid()
   where id = p_sav_id;
end $$;

-- ------------------------------------------------------------
-- Le vendeur retire une demande qu'il n'aurait pas dû faire — tant qu'elle est
-- en attente, donc sans aucun effet à défaire.
-- ------------------------------------------------------------
create or replace function annuler_sav(p_sav_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s sav;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  select * into v_s from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if not est_admin()
     and (select vendeur_id from ventes where id = v_s.vente_id) <> auth.uid()
  then
    raise exception 'Ce dossier n''est pas le vôtre.' using errcode = '42501';
  end if;
  if v_s.statut <> 'en_attente' then
    raise exception 'Seul un dossier en attente peut être retiré (statut : %).',
      v_s.statut using errcode = '23514';
  end if;

  update sav set statut = 'annule', traite_le = now(), traite_par = auth.uid()
   where id = p_sav_id;
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

create or replace function dossiers_sav(
  p_limite      int     default 100,
  p_les_miennes boolean default false
) returns table (
  id            uuid,
  vente_id      uuid,
  date          date,
  statut        text,
  resolution    text,
  quantite      int,
  montant_rembourse numeric(12,2),
  motif         text,
  motif_refus   text,
  produit       text,
  client        text,
  vendeur       text,
  vendeur_id    uuid,
  declare_par   text,
  traite_par    text,
  traite_le     timestamptz,
  cree_le       timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select s.id, s.vente_id, s.date, s.statut, s.resolution, s.quantite,
           s.montant_rembourse, s.motif, s.motif_refus,
           p.nom, v.client, pr.nom, v.vendeur_id,
           coalesce(dp.nom, '—'),
           tp.nom,
           s.traite_le,
           s.cree_le
      from sav s
      join ventes   v  on v.id  = s.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = s.produit_id
      left join profils dp on dp.id = s.cree_par
      left join profils tp on tp.id = s.traite_par
     where v.vendeur_id = auth.uid()
        or (est_admin() and not p_les_miennes)
     -- En attente d'abord : c'est ce qui appelle une décision.
     order by (s.statut = 'en_attente') desc, s.cree_le desc
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

-- ------------------------------------------------------------
-- Ce qui est nouveau POUR L'APPELANT.
--
-- Deux conditions, et la seconde est celle qui rend la pastille utile :
--
--   1. le dernier mouvement du dossier est postérieur à sa dernière visite ;
--   2. ce mouvement n'est PAS de son fait.
--
-- Sans (2), la pastille s'allumerait sur ses propres déclarations — il saurait
-- déjà, et elle deviendrait un bruit qu'on apprend à ignorer. Avec, elle ne
-- signale que ce qu'il n'a pas fait : une validation, un refus, ou un SAV
-- ouvert par le gérant sur une de ses ventes.
-- ------------------------------------------------------------
create or replace function sav_non_vus()
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_vu  timestamptz;
  v_nb  int;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  select p.sav_vu_le into v_vu from profils p where p.id = auth.uid();

  select count(*) into v_nb
    from sav s
    join ventes v on v.id = s.vente_id
   where v.vendeur_id = auth.uid()
     and coalesce(s.traite_le, s.cree_le) > coalesce(v_vu, '-infinity'::timestamptz)
     and coalesce(s.traite_par, s.cree_par) is distinct from auth.uid();

  return coalesce(v_nb, 0);
end $$;

-- ------------------------------------------------------------
-- Ce qui est nouveau POUR LE GÉRANT.
--
-- Symétrique de `sav_non_vus()`, à deux différences près.
--
-- 1. AUCUN FILTRE SUR LE VENDEUR : le gérant surveille les dossiers de tout le
--    monde. C'est le manque que ce fichier corrige.
--
-- 2. SEULEMENT LES DOSSIERS VALIDÉS. L'`en_attente` est déjà compté par la
--    pastille du layout, qui répond à « qu'est-ce qui attend ma décision ? ».
--    Les deux ensembles restent ainsi DISJOINTS et leur somme est honnête ;
--    les confondre afficherait deux fois le même dossier.
--
--    Ce qui reste est exactement ce qui n'avait aucun signal : l'échange qu'un
--    vendeur a déclaré, validé d'emblée, et que personne n'a encore regardé.
--
-- La seconde condition de `sav_non_vus` est reprise telle quelle, et pour la même
-- raison : un dossier que le gérant a lui-même ouvert ou arbitré ne s'annonce
-- pas à lui. Sans elle, la pastille s'allumerait sur ses propres gestes.
-- ------------------------------------------------------------
create or replace function sav_gestion_non_vus()
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_vu timestamptz;
  v_nb int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select p.sav_gestion_vu_le into v_vu from profils p where p.id = auth.uid();

  select count(*) into v_nb
    from sav s
   where s.statut = 'valide'
     and coalesce(s.traite_le, s.cree_le) > coalesce(v_vu, '-infinity'::timestamptz)
     and coalesce(s.traite_par, s.cree_par) is distinct from auth.uid();

  return coalesce(v_nb, 0);
end $$;

create or replace function marquer_sav_vu(p_vu_jusqu_a timestamptz default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  update profils
     set sav_vu_le = greatest(coalesce(sav_vu_le, '-infinity'::timestamptz),
                              least(coalesce(p_vu_jusqu_a, now()), now()))
   where id = auth.uid();
end $$;

create or replace function marquer_sav_gestion_vu(p_vu_jusqu_a timestamptz default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  update profils
     set sav_gestion_vu_le = greatest(coalesce(sav_gestion_vu_le, '-infinity'::timestamptz),
                                      least(coalesce(p_vu_jusqu_a, now()), now()))
   where id = auth.uid();
end $$;
