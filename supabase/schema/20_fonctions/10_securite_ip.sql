-- ============================================================
-- StockFlow — Palier 3 de l'anti-bourrage : blocage d'adresse IP
-- ============================================================
-- Les deux premiers paliers vivent en mémoire du processus Next et sont
-- couverts par `npm run test:unit`. Le troisième est en base parce qu'il doit
-- survivre à un redéploiement.
-- ------------------------------------------------------------

-- ============================================================
-- Une adresse éteinte depuis longtemps redevient une adresse inconnue.
-- ============================================================
-- LE DÉFAUT CORRIGÉ. `bloquer_ip` lisait `recidive` sans jamais regarder l'ancienneté
-- de la ligne. Le blocage expirait — `ip_est_bloquee` filtre sur `jusqu_a` —
-- mais le compteur, lui, ne redescendait jamais. Une adresse bloquée une fois
-- en janvier repartait à une heure en décembre, puis à un jour, puis à sept.
-- Or les adresses résidentielles changent au redémarrage de la box et celles
-- des opérateurs mobiles tournent en permanence : la peine finissait par être
-- purgée sur quelqu'un qui n'avait rien fait. C'est exactement la dérive que
-- le refus du blocage définitif d'office visait à éviter, et que le compteur
-- perpétuel réintroduisait par la fenêtre.
--
-- Sans purge non plus : la table ne perdait aucune ligne, la seule suppression
-- du dépôt étant `lever_blocage_ip`, ciblée et réservée au dev.
--
-- LE DÉLAI : 30 JOURS. Deux contraintes le bornent, la valeur exacte reste un
-- choix.
--
--   Plancher — il doit dépasser le plus long blocage (7 jours), sinon attendre
--   la fin de sa peine suffirait à effacer son casier et l'escalade ne
--   coûterait plus rien : c'est le mécanisme qui s'annulerait lui-même.
--
--   Ordre de grandeur — le raisonnement sur la durée croissante, plus haut,
--   pose un recyclage d'adresse « dans trois semaines ». 30 jours se place
--   juste au-delà de cet horizon, et à plus de quatre fois le plafond de
--   7 jours.
--
-- Je n'ai PAS de mesure du recyclage réel des adresses de ce parc, et rien
-- dans le dépôt n'en donne. Le chiffre est donc un jugement encadré par ces
-- deux bornes, pas un résultat. C'est le seul bouton à tourner si l'escalade
-- se révèle trop tenace ou trop oublieuse : la constante `c_oubli` ci-dessous.
--
-- POURQUOI DÉCROISSANCE ET PURGE SONT LE MÊME GESTE. Supprimer la ligne suffit :
-- le `select recidive + 1 ... where ip = p_ip` qui suit ne trouve alors plus
-- rien, le `coalesce(v_recidive, 1)` rend 1, et l'adresse repart à 15 minutes
-- comme une inconnue. Un second mécanisme qui remettrait `recidive` à 1 serait
-- du code en plus pour le même effet, en laissant la ligne morte en base.
-- L'ORDRE COMPTE : nettoyer AVANT de lire le compteur.
--
-- POURQUOI ICI ET NULLE PART AILLEURS. Le nettoyage aurait pu vivre dans
-- `ip_est_bloquee`, appelée bien plus souvent. Deux raisons de ne pas le faire,
-- la première étant sans appel :
--
--   1. `ip_est_bloquee` est déclarée `stable`, et PostgreSQL refuse net :
--      « DELETE is not allowed in a non-volatile function ». Il faudrait la
--      passer `volatile`, ce qui change aussi son traitement par le planificateur.
--   2. Elle s'exécute à CHAQUE tentative de connexion, avant toute
--      authentification et donc pour n'importe quel appelant. Y placer une
--      écriture donnerait à un inconnu de quoi faire écrire la base à volonté.
--
-- `bloquer_ip` est le seul endroit où l'ancienneté d'une ligne change quelque
-- chose, puisque c'est le seul qui lit `recidive`. La contrepartie est
-- assumée : la table n'est nettoyée qu'au passage d'un blocage. Une adresse qui
-- ne redéclenche jamais laisse sa ligne jusqu'au prochain blocage, quel qu'il
-- soit — le nettoyage est global, pas limité à `p_ip`. La table reste donc
-- bornée par les adresses hostiles des 30 derniers jours, pas par l'historique
-- complet.
--
-- LES BLOCAGES DÉFINITIFS NE SONT JAMAIS TOUCHÉS. `jusqu_a is null` est la
-- signature d'un geste humain (`bloquer_ip_definitivement`, réservée au dev,
-- motif obligatoire). Le `where jusqu_a is not null` les exclut de la purge,
-- comme le `where ip_bloquees.jusqu_a is not null` du `on conflict` les exclut
-- déjà de l'écrasement automatique. Seul `lever_blocage_ip` les retire.
--
-- LA PROMESSE COMPLÈTE. « Une adresse recyclée se libère seule » ne serait
-- vraie qu'à moitié sans ce nettoyage : le blocage se lèverait, la mémoire
-- resterait. Elle est exacte des deux côtés : l'adresse se libère seule à
-- l'échéance, et redevient inconnue 30 jours après. Vérifié par
-- `supabase/tests/12_ip_bloquees.sql`, assertions « éteinte depuis plus de
-- 30 jours : repart au premier palier », « le nettoyage n'est pas limité à
-- l'adresse qui déclenche » et « un blocage définitif traverse le nettoyage ».
--
-- Le `where` du `delete` n'est pas décoratif : `supautils` refuse une
-- suppression non qualifiée en conditions réelles, et `npm run verif:sql` la
-- refuse en intégration continue.
-- ------------------------------------------------------------

create or replace function bloquer_ip(p_ip text, p_motif text default null)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Le seul bouton à tourner. Voir l'en-tête pour les deux bornes.
  c_oubli    constant interval := interval '30 days';
  v_recidive int;
  v_duree    interval;
  v_jusqu_a  timestamptz;
begin
  if p_ip is null or trim(p_ip) = '' then
    raise exception 'Adresse IP manquante.' using errcode = '22023';
  end if;

  -- AVANT de lire le compteur : une ligne éteinte depuis plus de `c_oubli` ne
  -- doit plus peser sur l'escalade. La supprimer suffit à faire repartir
  -- l'adresse à 15 minutes, et borne la table au passage.
  delete from ip_bloquees
   where jusqu_a is not null
     and jusqu_a < now() - c_oubli;

  select recidive + 1 into v_recidive from ip_bloquees where ip = p_ip;
  v_recidive := coalesce(v_recidive, 1);

  v_duree := case
               when v_recidive >= 4 then interval '7 days'
               when v_recidive = 3  then interval '24 hours'
               when v_recidive = 2  then interval '1 hour'
               else interval '15 minutes'
             end;
  v_jusqu_a := now() + v_duree;

  insert into ip_bloquees (ip, bloquee_le, jusqu_a, recidive, motif)
  values (p_ip, now(), v_jusqu_a, v_recidive, p_motif)
  on conflict (ip) do update
    set bloquee_le = now(),
        jusqu_a    = excluded.jusqu_a,
        recidive   = excluded.recidive,
        motif      = excluded.motif,
        -- Un blocage manuel n'est pas réduit par un blocage automatique.
        posee_par  = null
   where ip_bloquees.jusqu_a is not null;

  return v_jusqu_a;
end $$;

-- ------------------------------------------------------------
-- Les deux gestes humains, réservés au dev.
-- ------------------------------------------------------------
create or replace function bloquer_ip_definitivement(p_ip text, p_motif text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_motif, '')), '') is null then
    raise exception 'Un motif est obligatoire pour un blocage définitif.'
      using errcode = '23514';
  end if;

  insert into ip_bloquees (ip, jusqu_a, motif, posee_par)
  values (p_ip, null, trim(p_motif), auth.uid())
  on conflict (ip) do update
    set jusqu_a = null, motif = excluded.motif, posee_par = auth.uid();

  perform tracer_admin('blocage IP définitif', null, null,
    jsonb_build_object('ip', p_ip, 'motif', trim(p_motif)));
end $$;

create or replace function lever_blocage_ip(p_ip text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  delete from ip_bloquees where ip = p_ip;

  perform tracer_admin('levée de blocage IP', null,
    jsonb_build_object('ip', p_ip), null);
end $$;

-- ------------------------------------------------------------
-- L'IP est-elle bloquée ?
--
-- Appelée à CHAQUE tentative de connexion, donc avant toute authentification :
-- elle ne peut pas exiger de session. C'est aussi pourquoi elle ne renvoie
-- qu'un booléen et rien d'autre : elle ne doit renseigner personne.
-- ------------------------------------------------------------
create or replace function ip_est_bloquee(p_ip text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from ip_bloquees
     where ip = p_ip and (jusqu_a is null or jusqu_a > now())
  );
$$;

-- ------------------------------------------------------------
-- Lecture pour l'écran.
-- ------------------------------------------------------------
create or replace function ip_bloquees_actives()
returns table (
  ip         text,
  bloquee_le timestamptz,
  jusqu_a    timestamptz,
  recidive   int,
  motif      text,
  definitif  boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  return query
    select b.ip, b.bloquee_le, b.jusqu_a, b.recidive, b.motif,
           (b.jusqu_a is null)
      from ip_bloquees b
     where b.jusqu_a is null or b.jusqu_a > now()
     order by b.bloquee_le desc;
end $$;
