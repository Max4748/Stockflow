-- ============================================================
-- StockFlow — 0024_retirer_compte.sql
-- Retirer un compte, sans jamais orpheliner sa comptabilité.
-- ============================================================
-- Même principe que `retirer_produit()` (0022), et pour la même raison : ce
-- qu'on veut presque toujours est « qu'il n'ait plus accès », pas « qu'il
-- n'ait jamais existé ». Deux dénouements, choisis par la fonction :
--
--   SUPPRESSION   si le compte n'a laissé AUCUNE trace. C'est le cas de
--                 l'adresse mal saisie, où effacer ne perd rien.
--   DÉSACTIVATION dès qu'une seule ligne le référence. Le compte perd tout
--                 accès, l'historique reste entier.
--
-- Dix clés étrangères pointent vers `profils`, et elles comptent TOUTES :
-- quatre en `restrict` (ce qu'il a vendu, détenu, versé, demandé) et six en
-- `no action` (ce qu'il a créé ou arbitré pour d'autres). Les secondes ne sont
-- pas moins bloquantes, elles sont seulement vérifiées à la fin de la
-- transaction. Un gérant qui n'a jamais rien vendu mais qui a validé un SAV a
-- donc bien un historique, et ce SAV doit continuer de dire qui l'a tranché.
--
-- La suppression retire la ligne d'`auth.users`, dont `profils` dépend en
-- cascade — comme les sessions, les identités et les facteurs TOTP. C'est le
-- même geste que le tableau de bord Supabase, fait ici pour que la décision et
-- l'exécution restent au même endroit.
--
-- Les gardes sont celles de `changer_actif`, réutilisée telle quelle pour la
-- désactivation : une seule définition de « désactiver un compte ».
-- ------------------------------------------------------------

create or replace function retirer_compte(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nom   text;
  v_role  text;
  v_actif boolean;
  v_refs  int;
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;

  -- Se retirer soi-même verrouillerait la maison, éventuellement sans
  -- personne pour rouvrir. Même refus que dans `changer_actif`.
  if p_id = auth.uid() then
    raise exception 'On ne retire pas son propre compte.' using errcode = '42501';
  end if;

  select nom, role, actif into v_nom, v_role, v_actif from profils where id = p_id;
  if not found then
    raise exception 'Compte introuvable.' using errcode = '02000';
  end if;

  -- « On ne gère qu'un niveau strictement inférieur au sien » : un gérant ne
  -- retire pas un autre gérant, et personne ne retire un dev.
  perform exiger_gestion_de(v_role);

  select (select count(*) from ventes           where vendeur_id  = p_id)
       + (select count(*) from mouvements_stock where detenteur_id = p_id)
       + (select count(*) from mouvements_stock where cree_par     = p_id)
       + (select count(*) from versements       where vendeur_id   = p_id)
       + (select count(*) from versements       where cree_par     = p_id)
       + (select count(*) from demandes_restock where vendeur_id   = p_id)
       + (select count(*) from demandes_restock where traitee_par  = p_id)
       + (select count(*) from restocks         where cree_par     = p_id)
       + (select count(*) from sav              where cree_par     = p_id)
       + (select count(*) from sav              where traite_par   = p_id)
    into v_refs;

  if v_refs = 0 then
    delete from auth.users where id = p_id;
    return format('%s a été supprimé : ce compte n''avait aucun historique.', v_nom);
  end if;

  if not v_actif then
    return format('%s est déjà désactivé. Son historique interdit de le supprimer.', v_nom);
  end if;

  perform changer_actif(p_id, false);
  return format(
    '%s a un historique : le compte est DÉSACTIVÉ plutôt que supprimé. Il perd tout accès immédiatement, sa comptabilité et son stock détenu restent intacts.',
    v_nom);
end $$;

comment on function retirer_compte(uuid) is
  'Supprime un compte sans aucune trace, désactive celui qui a un historique. Renvoie le message à afficher.';

grant execute on function retirer_compte(uuid) to authenticated;
