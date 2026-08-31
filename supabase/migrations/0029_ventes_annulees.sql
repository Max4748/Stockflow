-- ============================================================
-- StockFlow — 0029_ventes_annulees.sql
-- Une vente annulée reste visible, marquée comme telle.
-- ============================================================
-- Jusqu'ici l'annulation effaçait la vente : plus rien dans « Mes ventes », ni
-- dans le journal. Le vendeur ne pouvait pas vérifier qu'il avait bien annulé,
-- et le gérant ne voyait aucune trace d'une vente saisie puis reprise.
--
-- ARCHIVE PLUTÔT QUE DRAPEAU, et c'est le choix qui compte.
--
-- La solution évidente est un `ventes.annulee_le` laissé dans la table. Mais
-- 21 fonctions et 2 vues lisent `ventes` ou `vente_lignes` : le chiffre
-- d'affaires, les commissions, la dette, le bilan, les revenus par vendeur, et
-- surtout `cout_moyen_pondere()`, qui déduit les unités sorties. Il aurait
-- fallu ajouter « et non annulée » aux 21, et en oublier une seule aurait
-- faussé une dette ou une marge SANS RIEN SIGNALER.
--
-- Une table d'archive donne le même résultat à l'écran pour un risque nul :
-- les lignes annulées ne sont plus là où les agrégats regardent. Le coût est
-- déplacé sur la LECTURE, où une erreur se voit tout de suite, au lieu de la
-- comptabilité, où elle ne se voit jamais.
--
-- Seul l'EN-TÊTE est archivé : les deux listes de ventes n'affichent que lui,
-- jamais le détail des lignes. Archiver ce qui n'est jamais lu serait de la
-- dette sans usage.
-- ------------------------------------------------------------

create table if not exists ventes_annulees (
  -- L'identifiant D'ORIGINE : c'est lui que les motifs de mouvements citent
  -- (« Annulation vente depuis l'entrepôt · 863c6a12 »), et le conserver est
  -- ce qui permet de relier les deux dans le journal.
  id              uuid primary key,
  date            date        not null,
  vendeur_id      uuid        not null references profils(id) on delete restrict,
  client          text        not null,
  quantite_totale integer     not null,
  montant_total   numeric(12,2) not null,
  cree_le         timestamptz not null,
  annulee_le      timestamptz not null default now(),
  annulee_par     uuid        references profils(id),
  motif           text
);

alter table ventes_annulees enable row level security;

-- Mêmes règles de visibilité que `ventes` : chacun les siennes, l'encadrement
-- toutes. Aucune policy d'écriture : le seul chemin est `supprimer_vente`,
-- qui est `security definer`.
drop policy if exists ventes_annulees_select on ventes_annulees;
create policy ventes_annulees_select on ventes_annulees
  for select using (vendeur_id = auth.uid() or est_admin());

grant select on ventes_annulees to authenticated;
revoke insert, update, delete on ventes_annulees from authenticated, anon;

create index if not exists idx_ventes_annulees_vendeur
  on ventes_annulees (vendeur_id, date desc);

-- ------------------------------------------------------------
-- L'annulation archive avant d'effacer.
--
-- Le corps est celui de 0027, avec l'archivage inséré avant le `delete`. Le
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

-- ------------------------------------------------------------
-- Les deux listes de ventes réaffichent les annulées.
--
-- `drop` avant le `create` : la colonne `annulee_le` change le type de retour,
-- et `create or replace` ne sait pas le faire. Les fichiers d'origine, 0014 et
-- 0015, gagnent le même drop plus bas — règle des deux fichiers, documentée
-- dans donnees.md.
--
-- L'archive est jointe par UNION plutôt que par un `left join` : les deux
-- sources n'ont aucune ligne en commun, et une union dit exactement cela.
-- ------------------------------------------------------------
drop function if exists mes_ventes(int);
drop function if exists ventes_vendeur(uuid, int);

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

grant execute on function mes_ventes(int) to authenticated;
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

grant execute on function ventes_vendeur(uuid, int) to authenticated;

-- ------------------------------------------------------------
-- Les deux journaux montrent les ventes annulées.
--
-- Redéfinis ICI et non dans 0028 : `ventes_annulees` naît dans ce fichier, et
-- une fonction ne peut pas lire une table créée après elle lors de la première
-- installation.
--
-- L'horodatage retenu est celui de l'ANNULATION, pas celui de la vente : c'est
-- le geste que le journal raconte, et il doit apparaître à sa date.
-- ------------------------------------------------------------
create or replace function journal_transactions(
  p_du         date default null,
  p_au         date default null,
  p_type       text default null,
  p_vendeur_id uuid default null,
  p_limite     int  default 100,
  p_offset     int  default 0
) returns table (
  horodatage  timestamptz,
  date_compta date,
  type        text,
  libelle     text,
  vendeur     text,
  quantite    int,
  montant     numeric(12,2),
  reference   uuid
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limite int := least(greatest(coalesce(p_limite, 100), 1), 1000);
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  return query
  with bornes as (
    select coalesce(p_du, '-infinity'::date) as du,
           coalesce(p_au, 'infinity'::date)  as au
  ),
  tout as (
    -- L'identifiant court est CE QUE LES MOTIFS CITENT : sans lui sur la
    -- ligne de vente, « Vente depuis l'entrepôt · 863c6a12 » ne se rattache à
    -- rien de visible. Huit caractères suffisent à l'échelle du journal.
    select v.cree_le, v.date, 'vente'::text,
           'Vente à ' || v.client || ' · ' || left(v.id::text, 8), pr.nom,
           v.quantite_totale, v.montant_total::numeric(12,2), v.id
      from ventes v join profils pr on pr.id = v.vendeur_id
    union all
    -- Les annulées, avec leur propre type : le journal doit montrer qu'une
    -- vente a existé puis a été reprise, sans quoi elle disparaît de
    -- l'historique et le vendeur ne peut pas vérifier son geste.
    select a.annulee_le, a.date, 'vente_annulee'::text,
           'Vente annulée · ' || left(a.id::text, 8) || ' · ' || a.client,
           pr.nom, a.quantite_totale, a.montant_total::numeric(12,2), a.id
      from ventes_annulees a join profils pr on pr.id = a.vendeur_id
    union all
    select r.cree_le, r.date, 'achat'::text,
           'Achat ' || coalesce(r.reference, '(sans référence)'), null::text,
           r.quantite_totale, (r.prix_achat_base + r.frais_port)::numeric(12,2), r.id
      from restocks r
    union all
    select m.cree_le, m.cree_le::date, m.type::text,
           -- Le motif d'abord, le libellé générique en repli.
           coalesce(
             nullif(trim(m.motif), ''),
             case m.type when 'transfert' then 'Transfert vers ' || coalesce(pr.nom, 'entrepôt')
                         else 'Retour depuis un vendeur' end
           ),
           pr.nom, m.quantite, null::numeric(12,2), m.id
      from mouvements_stock m
      left join profils pr on pr.id = m.detenteur_id
     where m.type in ('transfert','retour') and m.quantite > 0
    union all
    select m.cree_le, m.cree_le::date, 'ajustement'::text,
           'Ajustement : ' || coalesce(m.motif, '(sans motif)'),
           coalesce(pr.nom, 'Entrepôt'), m.quantite, null::numeric(12,2), m.id
      from mouvements_stock m
      left join profils pr on pr.id = m.detenteur_id
     where m.type = 'ajustement'
    union all
    select s.cree_le, s.date, 'sav'::text,
           'SAV ' || (case s.resolution when 'echange' then 'échange' else 'remboursement' end)
             || ' — ' || p.nom || ' : ' || s.motif,
           pr.nom, -s.quantite,
           nullif(s.montant_rembourse, 0)::numeric(12,2), s.id
      from sav s
      join ventes   v  on v.id  = s.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = s.produit_id
     where s.statut = 'valide'
    union all
    select ver.cree_le, ver.date, 'versement'::text,
           'Versement reçu', pr.nom, null::int, ver.montant::numeric(12,2), ver.id
      from versements ver join profils pr on pr.id = ver.vendeur_id
  )
  select t.*
    from tout t (cree_le, dt, tp, lib, vd, qte, mt, ref)
    cross join bornes b
   where t.dt between b.du and b.au
     and (p_type is null or t.tp = p_type)
     and (p_vendeur_id is null
          or t.vd = (select nom from profils where id = p_vendeur_id))
   order by t.cree_le desc
   limit v_limite offset greatest(coalesce(p_offset, 0), 0);
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
    select ver.cree_le, 'versement'::text, 'Versement effectué',
           null::int, ver.montant::numeric(12,2)
      from versements ver where ver.vendeur_id = auth.uid()
  ) j (cree_le, tp, lib, qte, mt)
  order by j.cree_le desc
  limit v_limite;
end $$;

grant execute on function mon_journal(int) to authenticated;
