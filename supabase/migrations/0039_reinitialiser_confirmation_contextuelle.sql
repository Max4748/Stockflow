-- ============================================================
-- StockFlow — 0039_reinitialiser_confirmation_contextuelle.sql
-- La confirmation devient propre à CETTE base, à cet instant.
-- ============================================================
-- 0038 exigeait la phrase littérale 'REINITIALISER'. Elle est écrite en clair
-- dans un dépôt public sous licence MIT, donc connue de quiconque lit le code,
-- et surtout IDENTIQUE partout : une confirmation valide sur l'instance
-- d'essai l'était aussi sur celle d'exploitation.
--
-- LE SCÉNARIO QU'ON VEUT FERMER n'est pas le clic accidentel, ni l'appelant
-- hostile. C'est l'ERREUR DE CONTEXTE : deux onglets ouverts, on croit être sur
-- l'instance d'essai, on tape la phrase apprise par cœur, et c'est la base
-- d'exploitation qui se vide. La phrase se tapait de mémoire ; c'est
-- exactement ce qui la rendait inopérante.
--
-- LA CONFIRMATION EST DÉSORMAIS LE NOMBRE DE LIGNES que cette base va perdre,
-- calculé par elle. Deux propriétés, et la seconde vaut mieux que la première :
--
--   • il diffère d'une instance à l'autre ;
--   • il change DANS LE TEMPS sur la même instance, à chaque vente saisie. Il
--     ne peut donc pas être mémorisé du tout, et il oblige à lire l'inventaire
--     affiché juste au-dessus du champ, c'est-à-dire à regarder ce qu'on
--     s'apprête à détruire.
--
-- TOTAL À ZÉRO : refusé. La confirmation attendue serait « 0 », que n'importe
-- quel contexte produit. C'est un changement de comportement délibéré, et il
-- ne coûte rien : il n'y avait rien à effacer.
--
-- L'ORDRE DES VERROUS, que les commentaires de 0038 inversaient :
--
--   `est_dev()` est LE verrou d'autorisation. Lui seul empêche quelqu'un
--   d'autre de vider la base.
--
--   La confirmation n'est PAS un verrou de sécurité : sa valeur est affichée à
--   l'écran, et un appelant hostile qui a déjà passé `est_dev()` la lit en une
--   requête. C'est un garde-fou contre l'erreur de contexte, rien de plus, et
--   le présenter autrement donnerait une fausse assurance.
-- ------------------------------------------------------------

create or replace function reinitialiser_donnees(p_confirmation text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_comptes jsonb;
  v_total   int;
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  -- Compté AVANT, forcément : après, il ne reste rien à compter. Ce décompte
  -- sert deux fois : il constitue la confirmation attendue, et il restera la
  -- seule trace de ce qui a existé.
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

  select sum(value::int) into v_total from jsonb_each_text(v_comptes);

  -- Rien à effacer : le dire plutôt que d'accepter un geste vide. Sans ce cas,
  -- la confirmation attendue serait « 0 », que n'importe quel contexte
  -- produit, et le garde-fou ne garderait plus rien.
  if coalesce(v_total, 0) = 0 then
    raise exception 'Rien à effacer : la base ne contient aucune donnée d''activité.'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_confirmation, '')), '') is distinct from v_total::text then
    raise exception
      'Confirmation incorrecte : saisir %, le nombre de lignes que cette base va perdre.',
      v_total using errcode = '22023';
  end if;

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
  'Vide les données d''activité, conserve comptes, invitations, blocages IP et journal d''administration. Réservée au dev (seul verrou d''autorisation) ; la confirmation attendue est le nombre de lignes à effacer, garde-fou contre l''erreur d''instance.';
