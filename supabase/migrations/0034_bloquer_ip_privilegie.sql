-- ============================================================
-- StockFlow — 0034_bloquer_ip_privilegie.sql
-- Poser un blocage d'IP redevient une opération du serveur seul.
-- ============================================================
-- CORRECTIF D'UNE FAILLE INTRODUITE EN 0033.
--
-- `bloquer_ip(p_ip, p_motif)` y était accordée à `anon` ET `authenticated`,
-- sans aucune garde de rôle dans son corps. Or l'adresse bloquée est le
-- PARAMÈTRE `p_ip`, entièrement choisi par l'appelant : rien dans la fonction
-- ne le rapproche de l'adresse d'où vient l'appel.
--
-- Le commentaire de 0033 affirmait « le pire qu'un appelant puisse en tirer est
-- de se bloquer lui-même ». C'était FAUX, et c'est la raison pour laquelle la
-- garde manquait. Ce que la faille permettait réellement :
--
--   1. La clé anon est publique par construction (voir 0009). N'importe qui la
--      détenant pouvait donc bloquer n'importe quelle adresse IP, sans compte
--      ni session.
--   2. `recidive` s'incrémente à CHAQUE appel. Quatre appels suffisaient à
--      porter la durée à sept jours, et il suffisait de recommencer ensuite.
--   3. `ip_est_bloquee` est consultée AVANT `signInWithPassword` : une adresse
--      bloquée ne peut plus ouvrir de session du tout.
--   4. `lever_blocage_ip` exige `est_dev()`, donc une session. Bloquer l'IP du
--      dev le mettait dehors SANS RECOURS depuis l'application : plus personne
--      pour lever le blocage. Le seul retour passait par un accès SSH.
--
-- Le déni de service visait donc l'exploitation entière, pas seulement
-- l'attaquant.
--
-- LE CORRECTIF : la fonction n'est plus appelable que par `service_role`, dont
-- la clé ne quitte jamais le serveur applicatif. Le corps ne change pas, et le
-- flux légitime non plus : c'est la Server Action de connexion qui l'appelle,
-- désormais avec le client à privilèges.
--
-- `service_role` reçoit son droit EXPLICITEMENT plutôt que de compter sur les
-- privilèges par défaut de l'instance : le rejeu ne doit pas dépendre d'un
-- réglage extérieur au dépôt.
-- ------------------------------------------------------------

revoke execute on function bloquer_ip(text, text) from public, anon, authenticated;
grant  execute on function bloquer_ip(text, text) to service_role;

-- Le commentaire de la fonction porte la règle là où on la lit : dans
-- `\df+ bloquer_ip`, pas seulement dans un fichier de migration.
comment on function bloquer_ip(text, text) is
  'Palier 3 de l''anti-bourrage. Réservée à service_role : le paramètre p_ip est choisi par l''appelant, l''ouvrir à anon permettait de bloquer une adresse arbitraire, dev compris.';
