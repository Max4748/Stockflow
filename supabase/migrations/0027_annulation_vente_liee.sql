-- ============================================================
-- StockFlow — 0027_annulation_vente_liee.sql
-- Annuler la vente d'un gérant lié rend l'unité à l'entrepôt.
-- ============================================================
-- Défaut introduit par 0025, et qui ne se voyait pas.
--
-- La vente d'un compte lié écrit trois mouvements : les deux jambes d'un
-- transfert entrepôt → lui, puis la sortie de vente. À l'annulation, le
-- `on delete cascade` de `mouvements_stock.origine_vente_id` n'efface QUE la
-- sortie de vente : les deux jambes du transfert portent un `groupe_id`, pas
-- une origine de vente, et survivent.
--
-- Résultat, les unités restaient chez le gérant. Or son stock détenu n'existe
-- pas de son point de vue : `stock_disponible()` lui montre l'entrepôt. Les
-- unités devenaient donc invisibles ET invendables, pendant que l'entrepôt
-- restait court d'autant. Le total de la maison, lui, était juste : c'est
-- pourquoi `verifier_coherence_stock()` ne signalait rien.
--
-- POURQUOI UN RETOUR PLUTÔT QUE LA SUPPRESSION DU TRANSFERT. Rattacher les
-- jambes du transfert à `origine_vente_id` les aurait fait tomber en cascade,
-- sans une ligne de code ici. Mais le registre n'aurait plus rien montré, et
-- une annulation de vente est justement le moment où l'on veut lire ce qui
-- s'est passé. Le retour est donc écrit, motivé, et se lit dans le journal.
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
      -- Ordre imposé : entrepôt (NULL) avant le détenteur, comme partout.
      perform verrouiller_stock(v_ligne.produit_id, null);
      perform verrouiller_stock(v_ligne.produit_id, v_vendeur);

      -- `least` : on ne rend jamais plus que ce qu'il détient réellement. Un
      -- gérant lié après avoir reçu du stock en propre en garderait sinon
      -- moins que ce qui lui appartient.
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
-- Rapatriement des unités échouées avant ce correctif.
--
-- Toute vente d'un compte lié annulée entre 0025 et ce fichier a laissé ses
-- unités chez le gérant. Elles y sont invisibles et invendables : sans ce
-- bloc, il faudrait les retrouver à la main.
--
-- Écrit comme un `retour` motivé, jamais comme une correction silencieuse :
-- le registre doit pouvoir expliquer d'où vient chaque unité, y compris
-- celles remises en place par une migration.
--
-- Rejouable : la seconde exécution ne trouve plus rien à rapatrier, le
-- `where` ne remontant que les détenteurs au solde non nul.
-- ------------------------------------------------------------
do $$
declare
  v_ligne  record;
  v_groupe uuid;
begin
  for v_ligne in
    select m.produit_id, m.detenteur_id, sum(m.quantite)::int as quantite
      from mouvements_stock m
      join profils p on p.id = m.detenteur_id
     where p.stock_lie_entrepot
     group by 1, 2
    having sum(m.quantite) > 0
     order by 1, 2
  loop
    v_groupe := gen_random_uuid();
    insert into mouvements_stock (produit_id, detenteur_id, quantite, type,
                                  groupe_id, motif, cree_par)
    values (v_ligne.produit_id, v_ligne.detenteur_id, -v_ligne.quantite, 'retour',
            v_groupe, 'Régularisation 0027 : stock d''un compte lié à l''entrepôt', null),
           (v_ligne.produit_id, null, v_ligne.quantite, 'retour',
            v_groupe, 'Régularisation 0027 : stock d''un compte lié à l''entrepôt', null);

    raise notice 'Rapatrié : % unité(s) du produit % vers l''entrepôt.',
      v_ligne.quantite, v_ligne.produit_id;
  end loop;
end $$;
