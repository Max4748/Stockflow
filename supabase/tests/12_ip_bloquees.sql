-- ============================================================
-- Blocage d'adresse IP, palier 3 de l'anti-bourrage.
-- ============================================================
-- Les deux premiers paliers vivent en mémoire du processus Next et sont
-- couverts par `npm run test:unit`. Le troisième est en base parce qu'il doit
-- survivre à un redéploiement, et c'est cette partie que ce fichier vérifie :
-- la durée croissante, l'expiration automatique, et le fait que le définitif
-- reste un geste humain réservé au dev.
-- ------------------------------------------------------------

select plan(12);

select t_compte('t-dev@test.invalid',    'T-Dev',    'dev')    as dev    \gset
select t_compte('t-gerant@test.invalid', 'T-Gérant', 'gerant') as gerant \gset

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
