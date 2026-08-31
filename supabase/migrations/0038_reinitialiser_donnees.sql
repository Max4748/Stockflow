-- ============================================================
-- StockFlow — 0038_reinitialiser_donnees.sql
-- Vider les données d'exploitation, garder les comptes.
-- ============================================================
-- Sert à repartir d'une base propre après une période d'essai, sans refaire le
-- travail de création des comptes ni redemander à chacun son mot de passe.
--
-- CE QUI EST EFFACÉ : tout ce qui décrit l'activité. Ventes, mouvements de
-- stock, versements, SAV, demandes de réassort, achats, produits, et les deux
-- journaux qui les commentent.
--
-- CE QUI SURVIT, et pourquoi chacun :
--
--   profils, auth.users     ce que la demande exclut explicitement.
--   invitations             une invitation en attente est un compte en cours
--                           de création, donc du même ressort que les comptes.
--   roles                   une table de référence, pas des données.
--   ip_bloquees             de l'état de SÉCURITÉ, pas de l'activité. Vider
--                           les blocages rendrait l'accès à une adresse
--                           bloquée pour cause de bourrage : une remise à zéro
--                           des données ne doit pas être une porte de sortie.
--   journal_admin           il parle des COMPTES, qui survivent. L'effacer
--                           perdrait la trace des accès accordés, alors que
--                           les accès, eux, restent ouverts.
--
-- LA REMISE À ZÉRO S'INSCRIT DANS `journal_admin`, avec les comptages. C'est la
-- seule trace qui restera de ce qui a existé, et elle survit précisément parce
-- que ce journal n'est pas effacé.
--
-- DEUX VERROUS, et le second est le vrai :
--
--   1. `est_dev()`. Un gérant n'y a pas accès.
--   2. Une phrase de confirmation exacte, exigée EN BASE et non seulement dans
--      l'interface. Un appel direct à la RPC, par curl ou par erreur de
--      manipulation, échoue sans elle. Un bouton se clique par accident, une
--      phrase se tape à dessein.
--
-- Il n'y a PAS de sauvegarde automatique ici : la fonction ne peut pas en
-- déclencher une. La sauvegarde quotidienne existe par ailleurs
-- (docs/exploitation.md), et l'interface le rappelle avant de demander la
-- confirmation.
-- ------------------------------------------------------------

create or replace function reinitialiser_donnees(p_confirmation text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_comptes jsonb;
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  if p_confirmation is distinct from 'REINITIALISER' then
    raise exception
      'Confirmation absente ou incorrecte : saisir REINITIALISER pour valider.'
      using errcode = '22023';
  end if;

  -- Compté AVANT, forcément : après, il ne reste rien à compter, et c'est ce
  -- décompte qui constituera la seule trace de ce qui a existé.
  select jsonb_build_object(
    'ventes',           (select count(*) from ventes),
    'ventes_annulees',  (select count(*) from ventes_annulees),
    'mouvements',       (select count(*) from mouvements_stock),
    'versements',       (select count(*) from versements),
    'sav',              (select count(*) from sav),
    'demandes',         (select count(*) from demandes_restock),
    'achats',           (select count(*) from restocks),
    'produits',         (select count(*) from produits),
    'operations',       (select count(*) from journal_operations)
  ) into v_comptes;

  -- `where true` PARTOUT, et ce n'est pas du bruit à nettoyer.
  --
  -- L'instance charge `supautils` en `session_preload_libraries`, qui arme
  -- `safeupdate` pour les rôles non superutilisateur : un `delete` sans clause
  -- `where` y est refusé par « DELETE requires a WHERE clause ». Le garde-fou
  -- vise les suppressions massives accidentelles, et il a raison ; ici la
  -- suppression massive est l'objet même de la fonction, d'où la clause
  -- explicite qui dit « oui, je sais ».
  --
  -- `security definer` n'y change rien : il modifie l'utilisateur effectif, pas
  -- les réglages de session, et c'est la connexion PostgREST qui les porte.
  --
  -- À NE PAS RETIRER : aucun test ne rattraperait la régression. Le harnais
  -- pgTAP se connecte en `postgres` et simule le rôle par `set role`, où
  -- `safeupdate` n'est pas armé. Le défaut n'apparaît qu'en conditions
  -- réelles, à travers l'application.
  --
  -- Ordre imposé par les clés étrangères en RESTRICT vers profils et produits :
  -- l'activité part avant les produits, qui partent avant tout le reste.
  delete from sav where true;
  delete from mouvements_stock where true;
  delete from vente_lignes where true;
  delete from ventes where true;
  delete from ventes_annulees where true;
  delete from versements where true;
  delete from demande_lignes where true;
  delete from demandes_restock where true;
  delete from restock_lignes where true;
  delete from restocks where true;
  delete from produits where true;
  delete from journal_operations where true;

  -- Écrite APRÈS les suppressions : si l'une échoue, la transaction est annulée
  -- et aucune trace ne prétend qu'une remise à zéro a eu lieu.
  perform tracer_admin('réinitialisation des données', null, v_comptes, null);

  return v_comptes;
end $$;

comment on function reinitialiser_donnees(text) is
  'Vide les données d''activité, conserve comptes, invitations, blocages IP et journal d''administration. Réservée au dev, exige la phrase REINITIALISER.';

grant execute on function reinitialiser_donnees(text) to authenticated;
