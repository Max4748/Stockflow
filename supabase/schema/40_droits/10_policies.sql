-- ============================================================
-- StockFlow — Policies RLS
-- ============================================================

-- ------------------------------------------------------------
-- 3. Policies
-- ------------------------------------------------------------

-- profils : chacun lit la sienne, l'admin lit et écrit tout.
drop policy if exists profils_select    on profils;

drop policy if exists profils_admin_all on profils;

create policy profils_select on profils for select
  using (id = auth.uid() or est_admin());

create policy profils_admin_all on profils for all
  using (est_admin()) with check (est_admin());

-- invitations : admin uniquement (elles portent les conditions commerciales).
drop policy if exists invitations_admin_all on invitations;

create policy invitations_admin_all on invitations for all
  using (est_admin()) with check (est_admin());

-- produits : lecture par tout compte actif, écriture admin.
drop policy if exists produits_select    on produits;

drop policy if exists produits_admin_all on produits;

create policy produits_select on produits for select using (est_actif());

create policy produits_admin_all on produits for all
  using (est_admin()) with check (est_admin());

-- restocks : admin STRICTEMENT. Ces tables portent les prix d'achat ; un
-- vendeur qui les lirait déduirait la marge de la maison.
drop policy if exists restocks_admin_all       on restocks;

drop policy if exists restock_lignes_admin_all on restock_lignes;

create policy restocks_admin_all on restocks for all
  using (est_admin()) with check (est_admin());

create policy restock_lignes_admin_all on restock_lignes for all
  using (est_admin()) with check (est_admin());

-- ventes : un vendeur ne voit que les siennes.
drop policy if exists ventes_select on ventes;

create policy ventes_select on ventes for select
  using (vendeur_id = auth.uid() or est_admin());

-- vente_lignes : admin SEULEMENT — la colonne cout_unitaire est la marge.
-- Les vendeurs passent par la vue v_lignes_vente, qui n'expose pas le coût.
drop policy if exists vente_lignes_admin_all on vente_lignes;

create policy vente_lignes_admin_all on vente_lignes for all
  using (est_admin()) with check (est_admin());

-- mouvements_stock : un vendeur ne voit QUE son propre stock.
-- Les lignes d'entrepôt (detenteur_id IS NULL) sont exclues gratuitement :
-- « NULL = auth.uid() » vaut NULL, jamais vrai. L'isolation vient de la
-- logique à trois valeurs, pas d'une condition à maintenir.
drop policy if exists mvt_select    on mouvements_stock;

drop policy if exists mvt_admin_all on mouvements_stock;

create policy mvt_select on mouvements_stock for select
  using (detenteur_id = auth.uid() or est_admin());

create policy mvt_admin_all on mouvements_stock for all
  using (est_admin()) with check (est_admin());

-- demandes de restock : le vendeur lit les siennes, l'admin tout.
-- L'ÉCRITURE passe exclusivement par les RPC (INSERT/UPDATE révoqués plus
-- bas) : c'est ce qui rend « pas de modification après envoi » tenable.
drop policy if exists demandes_select    on demandes_restock;

drop policy if exists demandes_admin_all on demandes_restock;

create policy demandes_select on demandes_restock for select
  using (vendeur_id = auth.uid() or est_admin());

create policy demandes_admin_all on demandes_restock for all
  using (est_admin()) with check (est_admin());

drop policy if exists demande_lignes_select    on demande_lignes;

drop policy if exists demande_lignes_admin_all on demande_lignes;

create policy demande_lignes_select on demande_lignes for select
  using (exists (
    select 1 from demandes_restock d
     where d.id = demande_lignes.demande_id
       and (d.vendeur_id = auth.uid() or est_admin())
  ));

create policy demande_lignes_admin_all on demande_lignes for all
  using (est_admin()) with check (est_admin());

-- versements : le vendeur voit ce qu'il a reversé, l'admin tout.
drop policy if exists versements_select    on versements;

drop policy if exists versements_admin_all on versements;

create policy versements_select on versements for select
  using (vendeur_id = auth.uid() or est_admin());

create policy versements_admin_all on versements for all
  using (est_admin()) with check (est_admin());

drop policy if exists roles_select on roles;

create policy roles_select on roles for select using (est_actif());

drop policy if exists sav_select    on sav;

drop policy if exists sav_admin_all on sav;

create policy sav_select on sav for select
  using (
    est_admin()
    or exists (select 1 from ventes v
                where v.id = sav.vente_id and v.vendeur_id = auth.uid())
  );

create policy sav_admin_all on sav for all
  using (est_admin()) with check (est_admin());

-- Mêmes règles de visibilité que `ventes` : chacun les siennes, l'encadrement
-- toutes. Aucune policy d'écriture : le seul chemin est `supprimer_vente`,
-- qui est `security definer`.
drop policy if exists ventes_annulees_select on ventes_annulees;

create policy ventes_annulees_select on ventes_annulees
  for select using (vendeur_id = auth.uid() or est_admin());

drop policy if exists journal_admin_select on journal_admin;

create policy journal_admin_select on journal_admin
  for select using (est_dev());

drop policy if exists ip_bloquees_select on ip_bloquees;

create policy ip_bloquees_select on ip_bloquees
  for select using (est_dev());

-- Lisible par l'encadrement, comme le journal comptable qu'elle complète.
drop policy if exists journal_operations_select on journal_operations;

create policy journal_operations_select on journal_operations
  for select using (est_admin());

-- ------------------------------------------------------------
-- Prélèvements personnels.
--
-- Un vendeur voit ce qu'il a pris et à quel tarif : c'est sa dette, la lui
-- cacher rendrait `reste_a_verser` inexplicable de son point de vue.
-- ------------------------------------------------------------
drop policy if exists prelevements_select on prelevements;

create policy prelevements_select on prelevements
  for select using (vendeur_id = auth.uid() or est_admin());

drop policy if exists prix_preleves_select on prix_preleves;

create policy prix_preleves_select on prix_preleves
  for select using (vendeur_id = auth.uid() or est_admin());
