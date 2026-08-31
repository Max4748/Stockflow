#!/usr/bin/env bash
# Applique les migrations StockFlow dans l'ordre, en s'arrêtant à la première
# erreur. Les fichiers sont rejouables : relancer ce script sur une base déjà
# à jour est sans effet (hormis des NOTICE « does not exist, skipping »).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$DIR/migrations"

# Une seule définition de « comment joindre la base », partagée avec
# tests/lancer.sh : DATABASE_URL si elle est posée, la stack Supabase sinon.
. "$DIR/_connexion.sh"

for f in "$MIG"/*.sql; do
  printf '  %-32s' "$(basename "$f")"
  if psql -v ON_ERROR_STOP=1 -q < "$f" 2>/tmp/stockflow-mig.err; then
    echo "OK"
  else
    echo "ÉCHEC"
    cat /tmp/stockflow-mig.err >&2
    exit 1
  fi
done

echo
echo "--- inventaire ---"
psql -q <<'SQL'
select 'tables' as objet, count(*) from pg_tables where schemaname = 'public'
union all select 'vues',        count(*) from pg_views   where schemaname = 'public'
union all select 'policies RLS', count(*) from pg_policies where schemaname = 'public'
union all select 'fonctions',   count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all select 'tables SANS RLS (doit valoir 0)', count(*) from pg_tables t
   where t.schemaname = 'public'
     and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t.tablename
                        and c.relrowsecurity);
SQL
