-- ============================================================
-- StockFlow — Remise à zéro des données d'activité
-- ============================================================
-- Réservée au dev, confirmation contextuelle, et elle laisse une ligne
-- visible par l'encadrement là où l'historique était.
-- ------------------------------------------------------------

-- ============================================================
-- La remise à zéro s'explique à ceux qui la subissent.
-- ============================================================
-- Le défaut : la remise à zéro vide `journal_operations`, qui est justement ce
-- qui explique les suppressions passées, et n'écrit sa propre trace que dans
-- `journal_admin`, réservé au dev. Un gérant voyait donc toute l'activité
-- disparaître sans une ligne pour le dire, sur les deux écrans qu'il peut
-- ouvrir.
--
-- La table rase reste réelle, elle ne devient pas un demi-effacement : là où
-- l'historique était, il reste UNE ligne qui dit ce qui s'est passé et combien
-- de lignes ont été perdues.
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

  -- DEUX traces, pour deux lectorats.
  --
  -- `journal_admin` est réservé au dev. Un gérant y voyait donc toutes les
  -- données disparaître sans la moindre explication visible, d'autant que la
  -- remise à zéro vide `journal_operations`, qui est précisément ce qui
  -- expliquait les suppressions passées.
  --
  -- L'ordre compte : vider PUIS tracer. L'inverse effacerait la ligne qu'on
  -- vient d'écrire. Et les deux sont APRÈS les suppressions : si l'une échoue,
  -- la transaction est annulée et aucune trace ne prétend qu'une remise à zéro
  -- a eu lieu.
  perform tracer_admin('réinitialisation des données', null, v_comptes, null);

  perform tracer_operation(
    'base', null, 'réinitialisation',
    format('Données réinitialisées · %s ligne(s) effacée(s)', v_total),
    null, null, v_comptes);

  return v_comptes;
end $$;
