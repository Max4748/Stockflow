-- ============================================================
-- StockFlow — 0025_stock_lie_entrepot.sql
-- Un gérant dont le stock EST l'entrepôt.
-- ============================================================
-- Cas réel : l'entrepôt est chez le gérant. Lui faire transférer du stock
-- vers lui-même avant chaque vente est une écriture qui ne décrit aucun
-- déplacement — la marchandise n'a pas bougé d'un mètre.
--
-- Mais ce n'est pas vrai de tous les gérants : un second, sur le terrain,
-- reçoit du stock comme un vendeur. D'où un drapeau PAR COMPTE, et non un
-- réglage global qui serait faux pour l'un des deux.
--
-- CE QUE LE DRAPEAU CHANGE, et rien d'autre :
--   • `stock_disponible()` lit l'entrepôt au lieu du stock détenu ;
--   • `enregistrer_vente()` prend dans l'entrepôt ce qui manque, en écrivant
--     le transfert lui-même.
--
-- CE QU'IL NE CHANGE PAS, délibérément : le SAV (`declarer_sav` a déjà son
-- `p_depuis_entrepot` depuis 0015), la dette (elle vaut déjà 0 pour un
-- non-vendeur), et l'attribution des ventes — elles restent les SIENNES,
-- seule la source du stock diffère.
--
-- LE TRANSFERT EST ÉCRIT, PAS CONTOURNÉ. La contrainte `mvt_coherence`
-- impose depuis 0004 qu'une vente sorte d'un détenteur nommé. L'assouplir
-- pour ce cas aurait affaibli un invariant qui tient pour tout le monde, afin
-- d'épargner deux lignes au registre. Le geste disparaît de l'écran du
-- gérant ; il reste dans le journal, où il décrit exactement ce qui s'est
-- passé : la marchandise a quitté l'entrepôt, puis le client l'a emportée.
-- ------------------------------------------------------------

alter table profils
  add column if not exists stock_lie_entrepot boolean not null default false;

comment on column profils.stock_lie_entrepot is
  'Vrai quand l''entrepôt EST le stock de ce compte : ses ventes y puisent directement. Réservé à l''encadrement.';

-- Un vendeur n'a jamais accès à l'entrepôt : le drapeau n'a de sens que pour
-- l'encadrement. La contrainte le garantit même si une future rétrogradation
-- oubliait de le baisser — et `changer_role` le baisse, plus bas.
alter table profils drop constraint if exists profils_stock_lie_encadrement;
alter table profils add constraint profils_stock_lie_encadrement
  check (not stock_lie_entrepot or role <> 'vendeur');

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

grant execute on function source_stock(uuid) to authenticated;

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
-- Rétrograder un gérant en vendeur baisse le drapeau.
--
-- Sans ça, la contrainte ci-dessus ferait échouer la rétrogradation avec un
-- message de contrainte illisible, pour une raison que l'appelant n'a aucun
-- moyen de deviner.
-- ------------------------------------------------------------
create or replace function changer_role(p_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ancien text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_id = auth.uid() then
    raise exception 'On ne change pas son propre rôle.' using errcode = '42501';
  end if;

  select role into v_ancien from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;

  -- L'ANCIEN et le NOUVEAU rôle doivent être strictement sous l'appelant :
  -- sans le premier contrôle, un gérant rétrograderait un dev.
  perform exiger_gestion_de(v_ancien);
  perform exiger_gestion_de(p_role);

  update profils
     set role = p_role,
         stock_lie_entrepot = case when p_role = 'vendeur' then false
                                   else stock_lie_entrepot end
   where id = p_id;
end $$;

-- ------------------------------------------------------------
-- Poser ou retirer le drapeau.
-- ------------------------------------------------------------
create or replace function changer_stock_lie(p_id uuid, p_lie boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select role into v_role from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;

  if v_role = 'vendeur' then
    raise exception
      'Un vendeur n''a pas accès à l''entrepôt : ce réglage ne concerne que l''encadrement.'
      using errcode = '23514';
  end if;

  -- Se régler soi-même est LÉGITIME ici, contrairement au rôle ou à
  -- l'activation : le gérant qui héberge l'entrepôt est le mieux placé pour
  -- le déclarer, et le réglage ne lui donne aucun droit qu'il n'a pas déjà.
  -- Un gérant ne règle en revanche pas un dev.
  if p_id <> auth.uid() then
    perform exiger_gestion_de(v_role);
  end if;

  update profils set stock_lie_entrepot = coalesce(p_lie, false) where id = p_id;
end $$;

grant execute on function changer_stock_lie(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- Écriture : la vente prend dans l'entrepôt ce qui manque au vendeur.
--
-- Seul le bloc de verrouillage et de disponibilité change ; tout le reste est
-- identique à 0005. Le figeage comptable, l'ordre en-tête puis mouvements, et
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
    -- `transferer_stock` (0013) : en dévier produirait des interblocages
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

-- ------------------------------------------------------------
-- L'écran Comptes doit voir et régler le drapeau.
--
-- `drop` avant le `create` : ajouter une colonne de sortie change le type de
-- retour, et `create or replace` ne sait que les ajouter EN FIN de liste.
-- Ici `stock_lie_entrepot` s'insère avant `cree_le` pour rester près de
-- `actif`, donc le drop est obligatoire. Règle documentée dans donnees.md,
-- et c'est exactement ce que la 2ᵉ passe du harnais de rejeu attrape.
-- ------------------------------------------------------------
drop function if exists comptes_encadrement();

create or replace function comptes_encadrement()
returns table (
  id                 uuid,
  nom                text,
  role               text,
  libelle            text,
  niveau             int,
  actif              boolean,
  mdp_provisoire     boolean,
  stock_lie_entrepot boolean,
  cree_le            timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
    select p.id, p.nom, p.role, r.libelle, r.niveau, p.actif,
           p.doit_changer_mdp, p.stock_lie_entrepot, p.cree_le
      from profils p
      join roles r on r.cle = p.role
     where r.niveau >= 2
     order by r.niveau desc, p.nom;
end $$;

grant execute on function comptes_encadrement() to authenticated;
