#!/usr/bin/env bash
# Empreinte du schéma `public` : un texte trié, déterministe, comparable d'une
# base à l'autre avec un simple `diff`.
#
# POURQUOI PAS `pg_dump`. Son ordre de sortie dépend des OID, donc de l'ordre de
# création des objets. Deux bases au schéma identique, construites par des
# chemins différents, rendent des dumps qui diffèrent sans qu'aucune différence
# réelle existe — exactement le cas que ce script doit trancher.
#
# CE QU'ELLE COUVRE, et pourquoi chaque ligne y est :
#
#   colonnes, contraintes, index, enums   la forme des données
#   fonctions (pg_get_functiondef)        corps, volatilité, security definer,
#                                         search_path : tout est dans la sortie
#   vues, triggers                        le dérivé
#   RLS, policies                         qui voit quoi
#   DROITS (proacl / relacl)              voir ci-dessous
#   commentaires                          la documentation embarquée
#
# LES DROITS SONT LE POINT SENSIBLE. Sur une base neuve, PostgreSQL accorde
# `execute` à PUBLIC sur toute fonction créée. C'est un `revoke` explicite qui
# ferme `bloquer_ip` à `service_role` seul. Une réorganisation qui perdrait ce
# revoke rouvrirait la faille de 0034 sans qu'aucun test de comportement ne
# bronche, puisque le comportement nominal, lui, resterait correct. Les entrées
# d'ACL sont TRIÉES : `proacl` est un tableau dont l'ordre suit celui des
# grants, pas le contenu.
#
# `collate "C"` partout : l'ordre alphabétique dépend de la locale, et deux
# conteneurs peuvent ne pas avoir la même.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/_connexion.sh"

psql -X -q -t -A <<'SQL'
with tout as (

  -- ---------- colonnes ----------
  -- Aucune table n'a de trou d'attnum : la position ordinale est comparable
  -- telle quelle, et elle compte (`select *`, `insert` sans liste de colonnes).
  select 1 as sec,
         format('COLONNE   %s.%s  #%s  %s  %s  defaut=%s',
                c.relname, a.attname, a.attnum,
                format_type(a.atttypid, a.atttypmod),
                case when a.attnotnull then 'NOT NULL' else 'NULL' end,
                coalesce(pg_get_expr(d.adbin, d.adrelid), '-')) as ligne
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and a.attnum > 0 and not a.attisdropped

  union all
  -- ---------- contraintes ----------
  -- Le NOM est dans l'empreinte : 72 des 80 contraintes portent un nom
  -- auto-généré, et deux contraintes du même type sur la même colonne se
  -- départagent par un suffixe numéroté qui suit l'ordre de création.
  select 2, format('CONTRAINTE %s  %s  %s',
                   c.relname, con.conname, pg_get_constraintdef(con.oid))
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'

  union all
  -- ---------- index ----------
  select 3, 'INDEX     ' || pg_get_indexdef(i.indexrelid)
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'

  union all
  -- ---------- types énumérés ----------
  -- L'ORDRE des libellés fait partie du type : `alter type ... add value`
  -- ajoute en fin, une définition inline doit reproduire la même position.
  select 4, format('ENUM      %s = %s', t.typname,
                   string_agg(e.enumlabel, ', ' order by e.enumsortorder))
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
   group by t.typname

  union all
  -- ---------- fonctions ----------
  select 5, format('FONCTION  %s%s%s',
                   p.oid::regprocedure::text, chr(10), pg_get_functiondef(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'

  union all
  -- ---------- vues ----------
  select 6, format('VUE       %s%s%s',
                   c.relname, chr(10), pg_get_viewdef(c.oid, true))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'

  union all
  -- ---------- triggers ----------
  select 7, 'TRIGGER   ' || pg_get_triggerdef(tg.oid)
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not tg.tgisinternal

  union all
  -- ---------- RLS ----------
  select 8, format('RLS       %s  enabled=%s  forced=%s',
                   c.relname, c.relrowsecurity, c.relforcerowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'

  union all
  -- ---------- policies ----------
  select 9, format('POLICY    %s.%s  cmd=%s  roles=%s  using=%s  check=%s',
                   c.relname, pol.polname, pol.polcmd,
                   coalesce((select string_agg(r.rolname, ',' order by r.rolname)
                               from pg_roles r where r.oid = any (pol.polroles)), 'PUBLIC'),
                   coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                   coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'))
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'

  union all
  -- ---------- droits sur les fonctions ----------
  -- proacl NULL = droits par défaut, c'est-à-dire EXECUTE pour PUBLIC. Ce n'est
  -- pas la même chose qu'un ACL vide, et la distinction est justement ce qui
  -- sépare une fonction ouverte d'une fonction fermée.
  select 10, format('DROIT-FN  %s  %s', p.oid::regprocedure::text,
                    case when p.proacl is null then '(defaut: EXECUTE a PUBLIC)'
                    else coalesce((select string_agg(x, ' | ' order by x)
                                     from unnest(p.proacl::text[]) as x), '(vide)') end)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'

  union all
  -- ---------- droits sur les tables et vues ----------
  select 11, format('DROIT-TB  %s  %s', c.relname,
                    case when c.relacl is null then '(defaut)'
                    else coalesce((select string_agg(x, ' | ' order by x)
                                     from unnest(c.relacl::text[]) as x), '(vide)') end)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v')

  union all
  -- ---------- commentaires ----------
  select 12, format('COMMENT-O %s  %s', c.relname, obj_description(c.oid, 'pg_class'))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v')
     and obj_description(c.oid, 'pg_class') is not null

  union all
  select 13, format('COMMENT-C %s.%s  %s', c.relname, a.attname,
                    col_description(c.oid, a.attnum))
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
     and col_description(c.oid, a.attnum) is not null

  union all
  select 14, format('COMMENT-F %s  %s', p.oid::regprocedure::text,
                    obj_description(p.oid, 'pg_proc'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and obj_description(p.oid, 'pg_proc') is not null
)
select ligne from tout order by sec, ligne collate "C";
SQL
