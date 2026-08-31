-- ============================================================
-- StockFlow — Reprises de données
-- ============================================================
-- Pas des définitions de schéma mais des corrections de données,
-- idempotentes, conservées parce qu'une base qui ne les a pas encore subies
-- en a besoin. Sans effet sur une base à jour comme sur une base vide.
-- ------------------------------------------------------------
-- ------------------------------------------------------------
-- Rapatriement des unités échouées avant ce correctif.
--
-- Toute vente d'un compte lié annulée avant ce correctif a laissé ses
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
