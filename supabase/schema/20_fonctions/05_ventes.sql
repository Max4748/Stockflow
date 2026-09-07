-- ============================================================
-- StockFlow — Ventes : enregistrement, correction, annulation
-- ============================================================
-- Une vente gèle la commission au moment où elle est faite. Corriger ou
-- annuler doit donc défaire l'écriture comptable ET le mouvement de stock, sans
-- quoi la dette du vendeur part à la dérive.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Écriture : la vente prend dans l'entrepôt ce qui manque au vendeur.
--
-- Seul le bloc de verrouillage et de disponibilité change ; tout le reste est
-- inchangée. Le figeage comptable, l'ordre en-tête puis mouvements, et
-- le recalcul final des totaux ne sont pas touchés.
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
  v_lie        boolean;
  v_commission numeric(10,2);
  v_vente_id   uuid;
  v_ligne      record;
  v_dispo      int;
  v_manque     int;
  v_groupe     uuid;
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

  select commission_unitaire, stock_lie_entrepot into v_commission, v_lie
    from profils where id = v_vendeur and actif;
  if not found then
    raise exception 'Vendeur inconnu ou inactif.' using errcode = '42501';
  end if;

  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne de vente.' using errcode = '22023';
  end if;

  insert into ventes (date, vendeur_id, client, quantite_totale, montant_total)
  values (p_date, v_vendeur, coalesce(nullif(trim(p_client), ''), 'Anonyme'), 0, 0)
  returning id into v_vente_id;

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

    -- VERROU AVANT LECTURE, toujours. Ordre imposé quand les deux sont pris :
    -- entrepôt (NULL) d'abord, détenteur ensuite. Le même que
    -- `transferer_stock` : en dévier produirait des interblocages
    -- intermittents entre une vente et un transfert simultanés.
    if v_lie then
      perform verrouiller_stock(v_ligne.produit_id, null);
    end if;
    perform verrouiller_stock(v_ligne.produit_id, v_vendeur);

    v_dispo := stock_detenu(v_ligne.produit_id, v_vendeur);

    -- Compte lié : ce qui manque est pris à l'entrepôt, par un vrai transfert
    -- à deux jambes. `v_dispo` d'abord, donc le peu qu'il détiendrait déjà
    -- part en premier — sinon deux stocks du même produit coexisteraient.
    if v_lie and v_dispo < v_ligne.quantite then
      v_manque := v_ligne.quantite - v_dispo;

      if stock_detenu(v_ligne.produit_id, null) < v_manque then
        raise exception
          'Stock entrepôt insuffisant pour % : % manquante(s), % disponible(s).',
          coalesce((select nom from produits where id = v_ligne.produit_id), 'produit inconnu'),
          v_manque, stock_detenu(v_ligne.produit_id, null)
          using errcode = '23514';
      end if;

      v_groupe := gen_random_uuid();
      insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                    groupe_id, motif, cree_par)
      -- Le motif porte les 8 premiers caractères de l'identifiant de vente :
      -- assez pour retrouver la vente dans le journal, assez court pour tenir
      -- dans une cellule. L'uuid entier y serait illisible.
      values (v_ligne.produit_id, null, -v_manque, 'transfert',
              v_groupe,
              format('Vente depuis l''entrepôt · %s', left(v_vente_id::text, 8)),
              auth.uid()),
             (v_ligne.produit_id, v_vendeur, v_manque, 'transfert',
              v_groupe,
              format('Vente depuis l''entrepôt · %s', left(v_vente_id::text, 8)),
              auth.uid());

      v_dispo := stock_detenu(v_ligne.produit_id, v_vendeur);
    end if;

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

-- ------------------------------------------------------------
-- L'annulation archive avant d'effacer.
--
-- L'archivage est inséré avant le `delete`. Le
-- reste ne bouge pas : la cascade rend le stock au bon détenteur, et un compte
-- lié le renvoie ensuite à l'entrepôt.
-- ------------------------------------------------------------
create or replace function supprimer_vente(p_vente_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_dans_fenetre boolean;
  v_apres        int;
  v_vendeur      uuid;
  v_lie          boolean;
  v_lignes       jsonb;
  v_ligne        record;
  v_groupe       uuid;
  v_rendre       int;
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

  select v.vendeur_id, p.stock_lie_entrepot into v_vendeur, v_lie
    from ventes v join profils p on p.id = v.vendeur_id
   where v.id = p_vente_id;

  -- Les lignes sont relevées AVANT la suppression : elles partent en cascade
  -- avec la vente, et c'est d'elles qu'on tire les quantités à rendre.
  select jsonb_agg(jsonb_build_object('produit', produit_id, 'quantite', quantite))
    into v_lignes
    from vente_lignes where vente_id = p_vente_id;

  -- L'archive, avant que la ligne ne disparaisse. `on conflict do nothing` :
  -- une vente déjà archivée le reste, une seconde annulation n'écrase pas la
  -- date ni l'auteur de la première.
  insert into ventes_annulees (id, date, vendeur_id, client, quantite_totale,
                               montant_total, cree_le, annulee_par)
  select v.id, v.date, v.vendeur_id, v.client, v.quantite_totale,
         v.montant_total, v.cree_le, auth.uid()
    from ventes v where v.id = p_vente_id
  on conflict (id) do nothing;

  -- Le `on delete cascade` de mouvements_stock.origine_vente_id restitue le
  -- stock AU BON DÉTENTEUR : le mouvement négatif disparaît avec la vente.
  delete from ventes where id = p_vente_id;

  -- Compte lié : ce détenteur n'existe pas de son point de vue. Les unités
  -- rendues par la cascade repartent donc à l'entrepôt, d'où elles venaient.
  if v_lie and v_lignes is not null then
    for v_ligne in
      select (e->>'produit')::uuid as produit_id, (e->>'quantite')::int as quantite
        from jsonb_array_elements(v_lignes) e
       order by 1
    loop
      perform verrouiller_stock(v_ligne.produit_id, null);
      perform verrouiller_stock(v_ligne.produit_id, v_vendeur);

      v_rendre := least(v_ligne.quantite, stock_detenu(v_ligne.produit_id, v_vendeur));

      if v_rendre > 0 then
        v_groupe := gen_random_uuid();
        insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                      groupe_id, motif, cree_par)
        values (v_ligne.produit_id, v_vendeur, -v_rendre, 'retour',
                v_groupe,
                format('Annulation vente depuis l''entrepôt · %s',
                       left(p_vente_id::text, 8)),
                auth.uid()),
               (v_ligne.produit_id, null, v_rendre, 'retour',
                v_groupe,
                format('Annulation vente depuis l''entrepôt · %s',
                       left(p_vente_id::text, 8)),
                auth.uid());
      end if;
    end loop;
  end if;
end $$;

create or replace function mes_ventes(p_limite int default 20)
returns table (
  id              uuid,
  date            date,
  client          text,
  quantite_totale int,
  montant_total   numeric(10,2),
  cree_le         timestamptz,
  corrigeable     boolean,
  sav_unites      int,
  sav_rembourse   numeric(12,2),
  sav_en_attente  int,
  annulee_le      timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.client, v.quantite_totale, v.montant_total, v.cree_le,
           (v.cree_le >= now() - fenetre_correction()) as corrigeable,
           coalesce(s.unites, 0)::int,
           coalesce(s.rembourse, 0)::numeric(12,2),
           coalesce(s.en_attente, 0)::int,
           null::timestamptz
      from ventes v
      left join (
        -- `unites` compte le validé ET l'en-attente : le badge répond à « cette
        -- vente a-t-elle posé problème ? ». `rembourse` ne compte que le validé,
        -- car c'est le seul argent réellement sorti.
        select sv.vente_id,
               sum(sv.quantite) filter (where sv.statut in ('valide','en_attente')) as unites,
               sum(sv.montant_rembourse) filter (where sv.statut = 'valide') as rembourse,
               count(*) filter (where sv.statut = 'en_attente') as en_attente
          from sav sv group by sv.vente_id
      ) s on s.vente_id = v.id
     where v.vendeur_id = auth.uid()

    union all

    -- Les annulées, tirées de l'archive. Aucun SAV possible sur une vente qui
    -- n'existe plus, d'où les zéros ; `corrigeable` est faux par construction.
    select a.id, a.date, a.client, a.quantite_totale, a.montant_total, a.cree_le,
           false, 0, 0::numeric(12,2), 0, a.annulee_le
      from ventes_annulees a
     where a.vendeur_id = auth.uid()

     order by cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 100);
end $$;

create or replace function ventes_vendeur(
  p_vendeur_id uuid,
  p_limite     int default 20
) returns table (
  id              uuid,
  date            date,
  client          text,
  quantite_totale int,
  montant_total   numeric(10,2),
  cree_le         timestamptz,
  sav_unites      int,
  sav_rembourse   numeric(12,2),
  sav_en_attente  int,
  annulee_le      timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.client, v.quantite_totale, v.montant_total, v.cree_le,
           coalesce(s.unites, 0)::int,
           coalesce(s.rembourse, 0)::numeric(12,2),
           coalesce(s.en_attente, 0)::int,
           null::timestamptz
      from ventes v
      left join (
        select sv.vente_id,
               sum(sv.quantite) filter (where sv.statut in ('valide','en_attente')) as unites,
               sum(sv.montant_rembourse) filter (where sv.statut = 'valide') as rembourse,
               count(*) filter (where sv.statut = 'en_attente') as en_attente
          from sav sv group by sv.vente_id
      ) s on s.vente_id = v.id
     where v.vendeur_id = p_vendeur_id

    union all

    select a.id, a.date, a.client, a.quantite_totale, a.montant_total, a.cree_le,
           0, 0::numeric(12,2), 0, a.annulee_le
      from ventes_annulees a
     where a.vendeur_id = p_vendeur_id

     order by cree_le desc
     limit least(greatest(coalesce(p_limite, 20), 1), 200);
end $$;

create or replace function mon_journal(p_limite int default 50)
returns table (
  horodatage timestamptz,
  type       text,
  libelle    text,
  quantite   int,
  montant    numeric(12,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limite int := least(greatest(coalesce(p_limite, 50), 1), 500);
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
  select * from (
    select v.cree_le, 'vente'::text, 'Vente à ' || v.client,
           v.quantite_totale, v.montant_total::numeric(12,2)
      from ventes v where v.vendeur_id = auth.uid()
    union all
    select a.annulee_le, 'vente_annulee'::text,
           'Vente annulée · ' || left(a.id::text, 8) || ' · ' || a.client,
           a.quantite_totale, a.montant_total::numeric(12,2)
      from ventes_annulees a where a.vendeur_id = auth.uid()
    union all
    select m.cree_le, 'reception'::text,
           'Réception de ' || p.nom, m.quantite, null::numeric(12,2)
      from mouvements_stock m join produits p on p.id = m.produit_id
     where m.detenteur_id = auth.uid() and m.type = 'transfert' and m.quantite > 0
    union all
    select pl.cree_le, 'prelevement'::text,
           'Prélèvement · ' || pr.nom,
           pl.quantite, (pl.quantite * pl.prix_unitaire)::numeric(12,2)
      from prelevements pl join produits pr on pr.id = pl.produit_id
     where pl.vendeur_id = auth.uid()
    union all
    select ver.cree_le, 'versement'::text, 'Versement effectué',
           null::int, ver.montant::numeric(12,2)
      from versements ver where ver.vendeur_id = auth.uid()
  ) j (cree_le, tp, lib, qte, mt)
  order by j.cree_le desc
  limit v_limite;
end $$;

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

-- ============================================================
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

create or replace function ventes_savables(
  p_limite      int     default 100,
  p_les_miennes boolean default false
) returns table (
  vente_id       uuid,
  date           date,
  cree_le        timestamptz,
  client         text,
  vendeur        text,
  vendeur_id     uuid,
  produit_id     uuid,
  produit        text,
  quantite       int,
  deja_en_sav    int,
  restant        int,
  prix_unitaire  numeric(10,2)
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select v.id, v.date, v.cree_le, v.client, pr.nom, v.vendeur_id,
           p.id, p.nom,
           vl.quantite,
           coalesce(s.deja, 0)::int,
           (vl.quantite - coalesce(s.deja, 0))::int,
           vl.prix_vente_unitaire
      from vente_lignes vl
      join ventes   v  on v.id  = vl.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = vl.produit_id
      left join (
        select sv.vente_id, sv.produit_id, sum(sv.quantite) as deja
          from sav sv
         where sv.statut in ('valide','en_attente')
         group by sv.vente_id, sv.produit_id
      ) s on s.vente_id = vl.vente_id and s.produit_id = vl.produit_id
     where vl.quantite > coalesce(s.deja, 0)
       -- Un vendeur ne voit que SES ventes. Cette fonction est SECURITY
       -- DEFINER : sans cette clause, elle publierait les clients de tous.
       and (v.vendeur_id = auth.uid() or (est_admin() and not p_les_miennes))
     order by v.cree_le desc, p.nom
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;
