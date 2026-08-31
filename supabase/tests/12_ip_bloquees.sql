-- ============================================================
-- Blocage d'adresse IP, palier 3 de l'anti-bourrage.
-- ============================================================
-- Les deux premiers paliers vivent en mémoire du processus Next et sont
-- couverts par `npm run test:unit`. Le troisième est en base parce qu'il doit
-- survivre à un redéploiement, et c'est cette partie que ce fichier vérifie :
-- la durée croissante, l'expiration automatique, et le fait que le définitif
-- reste un geste humain réservé au dev.
-- ------------------------------------------------------------

select plan(19);

select t_compte('t-dev@test.invalid',    'T-Dev',    'dev')    as dev    \gset
select t_compte('t-gerant@test.invalid', 'T-Gérant', 'gerant') as gerant \gset

-- ---------- Poser un blocage est réservé au serveur ----------
-- Le défaut de 0033 : `bloquer_ip` était accordée à `anon` et `authenticated`,
-- sans garde de rôle, alors que l'adresse bloquée est son PARAMÈTRE. N'importe
-- quel détenteur de la clé publique pouvait donc bloquer l'IP de son choix, y
-- compris celle du dev, qui ne pouvait alors plus lever son propre blocage
-- puisque `lever_blocage_ip` exige une session. Corrigé en 0034.
--
-- Les assertions de durée qui suivent tournent en superutilisateur, donc sans
-- passer par ce droit : elles vérifient le CALCUL, celle-ci vérifie l'ACCÈS.
select t_agir(:'gerant') as _ \gset
select throws_ok(
  $$ select bloquer_ip('198.51.100.9', 'tentative directe') $$,
  '42501', null,
  'un compte authentifié ne peut pas poser de blocage : réservé à service_role');

reset role;

-- ---------- La durée croît à chaque récidive ----------
select is((select bloquer_ip('198.51.100.1', 'essai') - now())::interval,
          interval '15 minutes', 'première fois : 15 minutes');
select is((select bloquer_ip('198.51.100.1', 'essai') - now())::interval,
          interval '1 hour', 'deuxième : une heure');
select is((select bloquer_ip('198.51.100.1', 'essai') - now())::interval,
          interval '24 hours', 'troisième : un jour');
select is((select bloquer_ip('198.51.100.1', 'essai') - now())::interval,
          interval '7 days', 'quatrième : une semaine');
select is((select bloquer_ip('198.51.100.1', 'essai') - now())::interval,
          interval '7 days', 'et le plafond ne monte plus');

-- ---------- L'expiration est automatique ----------
select is(ip_est_bloquee('198.51.100.1'), true, 'l''adresse est bloquée');

reset role;
update ip_bloquees set jusqu_a = now() - interval '1 second'
 where ip = '198.51.100.1';
select is(ip_est_bloquee('198.51.100.1'), false,
          'échéance passée : elle se libère seule, sans purge ni tâche de fond');

select is(ip_est_bloquee('203.0.113.99'), false,
          'une adresse jamais vue n''est pas bloquée');

-- ---------- Le définitif est un geste humain, réservé au dev ----------
select t_agir(:'gerant') as _ \gset
select throws_ok(
  $$ select bloquer_ip_definitivement('198.51.100.2', 'motif') $$,
  '42501', null, 'un gérant ne pose pas de blocage définitif');

reset role;
select t_agir(:'dev') as _ \gset
select throws_ok(
  $$ select bloquer_ip_definitivement('198.51.100.2', '   ') $$,
  '23514', null,
  'un motif est obligatoire : sans lui la ligne est incompréhensible plus tard');

select lives_ok(
  $$ select bloquer_ip_definitivement('198.51.100.2', 'Bourrage répété, IP fixe connue') $$,
  'le dev peut retirer l''échéance');

reset role;
select is((select jusqu_a is null from ip_bloquees where ip = '198.51.100.2'), true,
          'et le blocage n''a plus d''échéance');

-- ---------- Une ligne éteinte depuis longtemps ne compte plus ----------
-- Le défaut fermé par 0041 : le blocage expirait, le compteur non. Une adresse
-- vue une fois l'an dernier repartait à une heure, puis à un jour. Comme les
-- adresses tournent, la peine finissait sur quelqu'un d'autre.
--
-- `now()` est figé pour toute la transaction : antidater `jusqu_a` est le seul
-- moyen de faire vieillir une ligne ici, et c'est suffisant puisque la purge
-- compare `jusqu_a` à `now() - 30 jours`.
reset role;

select is((select bloquer_ip('203.0.113.10', 'essai') - now())::interval,
          interval '15 minutes', 'adresse neuve : premier palier');

-- Expirée depuis une heure : c'est un récidiviste, l'escalade doit tenir.
update ip_bloquees set jusqu_a = now() - interval '1 hour'
 where ip = '203.0.113.10';
select is((select bloquer_ip('203.0.113.10', 'essai') - now())::interval,
          interval '1 hour',
          'blocage récemment expiré : l''escalade continue normalement');

-- Éteinte depuis quarante jours : le casier est vidé, pas seulement la peine.
update ip_bloquees set jusqu_a = now() - interval '40 days'
 where ip = '203.0.113.10';
select is((select bloquer_ip('203.0.113.10', 'essai') - now())::interval,
          interval '15 minutes',
          'éteinte depuis plus de 30 jours : repart au premier palier');

-- Le nettoyage est global : sans quoi la table garderait indéfiniment les
-- lignes des adresses qui ne redéclenchent jamais.
insert into ip_bloquees (ip, bloquee_le, jusqu_a, recidive)
values ('203.0.113.12', now() - interval '90 days',
        now() - interval '83 days', 4);
select bloquer_ip('203.0.113.13', 'déclenche le nettoyage') as _ \gset
select is((select count(*)::int from ip_bloquees where ip = '203.0.113.12'), 0,
          'le nettoyage n''est pas limité à l''adresse qui déclenche');

-- ---------- Le définitif survit à tout nettoyage ----------
-- `jusqu_a is null` est un geste humain : aucune ancienneté ne le périme.
-- 198.51.100.2 est définitif depuis l'assertion précédente.
update ip_bloquees set bloquee_le = now() - interval '400 days'
 where ip = '198.51.100.2';
select bloquer_ip('203.0.113.14', 'déclenche le nettoyage') as _ \gset

select is((select count(*)::int from ip_bloquees where ip = '198.51.100.2'), 1,
          'un blocage définitif traverse le nettoyage, quel que soit son âge');
select is(ip_est_bloquee('198.51.100.2'), true,
          'et il bloque toujours');
