-- ============================================================
-- StockFlow — Catalogue produits
-- ============================================================
-- Le catalogue lui-même est du CRUD sous RLS ; seule la suppression
-- demande une fonction, parce qu'elle doit refuser de laisser du stock orphelin.
-- ------------------------------------------------------------

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
    perform tracer_operation('produit', p_id, 'suppression',
      format('Produit supprimé · %s', v_nom), null, null, null);

    delete from produits where id = p_id;
    return format('%s a été supprimé du catalogue.', v_nom);
  end if;

  -- Déjà inactif : le dire plutôt que de prétendre avoir agi. Sans ce cas,
  -- un second clic renverrait le même message de succès qu'au premier.
  if not v_actif then
    return format('%s est déjà inactif. Son historique interdit de le supprimer.', v_nom);
  end if;

  update produits set actif = false where id = p_id;

  perform tracer_operation('produit', p_id, 'désactivation',
    format('Produit désactivé · %s', v_nom), null, null,
    jsonb_build_object('references', v_refs));

  return format(
    '%s a un historique : il est passé INACTIF plutôt que supprimé. Il disparaît des listes de saisie, la comptabilité est conservée.',
    v_nom);
end $$;
