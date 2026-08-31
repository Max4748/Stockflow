-- ============================================================
-- StockFlow — 0022_retirer_produit.sql
-- Retirer un produit du catalogue, sans jamais casser l'historique.
-- ============================================================
-- La création et la modification d'un produit passent en écriture directe
-- (policy `produits_admin_all`) : un produit ne porte aucun invariant
-- comptable, et une RPC n'apporterait rien.
--
-- Le RETRAIT est l'exception, parce qu'il en toucherait un. Les cinq clés
-- étrangères qui pointent vers `produits` sont en `on delete restrict` : le
-- registre de mouvements et les coûts figés des lignes de vente le
-- référencent, et perdre le produit rendrait une ligne de vente illisible.
--
-- D'où DEUX dénouements, choisis par la fonction et non par l'appelant :
--
--   SUPPRESSION   si le produit n'a jamais servi. C'est le cas de la faute de
--                 frappe à la création, où effacer ne perd rien.
--   DÉSACTIVATION dès qu'un historique existe. Le produit sort des listes de
--                 saisie, la comptabilité reste entière.
--
-- Le choix est en base et non dans l'interface : c'est ici qu'on sait ce qui
-- référence le produit, et un contrôle côté client serait une seconde vérité
-- à maintenir — celle qui ment en premier.
--
-- `drop` avant le `create` : 0022 a d'abord existé avec `returns void`, et
-- `create or replace` ne sait pas changer un type de retour. Sans ce drop, le
-- rejeu échouerait sur une base déjà migrée (voir donnees.md).
-- ------------------------------------------------------------

drop function if exists supprimer_produit(uuid);
drop function if exists retirer_produit(uuid);

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
    delete from produits where id = p_id;
    return format('%s a été supprimé du catalogue.', v_nom);
  end if;

  -- Déjà inactif : le dire plutôt que de prétendre avoir agi. Sans ce cas,
  -- un second clic renverrait le même message de succès qu'au premier.
  if not v_actif then
    return format('%s est déjà inactif. Son historique interdit de le supprimer.', v_nom);
  end if;

  update produits set actif = false where id = p_id;
  return format(
    '%s a un historique : il est passé INACTIF plutôt que supprimé. Il disparaît des listes de saisie, la comptabilité est conservée.',
    v_nom);
end $$;

comment on function retirer_produit(uuid) is
  'Supprime un produit jamais employé, désactive celui qui a un historique. Renvoie le message à afficher.';

grant execute on function retirer_produit(uuid) to authenticated;
