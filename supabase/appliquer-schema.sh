#!/usr/bin/env bash
# Applique le schéma StockFlow, couche par couche, en s'arrêtant à la première
# erreur. Les fichiers sont rejouables : relancer ce script sur une base déjà à
# jour est sans effet (hormis des NOTICE « already exists, skipping »).
#
# L'ORDRE DES COUCHES EST LA SEULE CHOSE QUI COMPTE ICI. À l'intérieur d'une
# couche, l'ordre alphabétique suffit — vérifié : les 10 fonctions `language
# sql`, seules dont le corps est validé à la création, n'appellent aucune autre
# fonction du schéma.
#
#   10  types, tables, index, RLS, triggers   ce qui est incrémental
#   20  fonctions                             `create or replace`, une seule fois chacune
#   30  vues                                  après 20 : v_lignes_vente appelle est_admin()
#   40  policies, droits, commentaires        après 20 : les 24 policies citent est_admin/est_dev
#   90  amorçage
#
# La couche 40 vient APRÈS toutes les tables, et c'est ce qui corrige un défaut
# des migrations numérotées : leur `revoke all on all tables ... from anon` ne
# couvrait que les tables existant à cet instant, laissant `select` à `anon` sur
# les cinq tables créées plus tard, jusqu'à la deuxième application.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCH="$DIR/schema"

. "$DIR/_connexion.sh"

# L'ORDRE VIENT DU SEUL SYSTÈME DE FICHIERS : `schema/*/*.sql` trié. C'est la
# même règle pour ce script, pour `rejeu.test.mjs` et pour `verifier-schema.mjs`,
# donc aucune liste à tenir à jour en double — les trois liraient une liste qui
# aurait divergé au premier fichier ajouté.
for f in "$SCH"/*/*.sql; do
  couche="$(basename "$(dirname "$f")")"
  if [ "$couche" != "${couche_vue:-}" ]; then echo "── $couche"; couche_vue="$couche"; fi
  printf '  %-32s' "$(basename "$f")"
  if psql -v ON_ERROR_STOP=1 -q < "$f" 2>/tmp/stockflow-schema.err; then
    echo "OK"
  else
    echo "ÉCHEC"; cat /tmp/stockflow-schema.err >&2; exit 1
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
