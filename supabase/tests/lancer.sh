#!/usr/bin/env bash
# Lance les tests pgTAP. Chaque fichier tourne dans sa propre transaction,
# systématiquement annulée : la base sort de là exactement comme elle y est
# entrée, extension pgtap comprise.
#
#   ./supabase/tests/lancer.sh              # tout
#   ./supabase/tests/lancer.sh 03           # les fichiers dont le nom contient 03
#
# STACK pointe le dossier de l'instance Supabase (celui du docker-compose.yml).
set -euo pipefail

STACK="${STACK:-$HOME/stockflow-supabase}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTRE="${1:-}"

cd "$STACK"

if ! docker compose ps --status running --quiet db >/dev/null 2>&1; then
  echo "La stack n'est pas démarrée. Lancer : cd $STACK && docker compose up -d" >&2
  exit 1
fi

psql() { docker compose exec -T db psql -U postgres -d postgres "$@"; }

total=0; echecs=0; fichiers=0

for f in "$DIR"/[0-9]*.sql; do
  [ -n "$FILTRE" ] && [[ "$(basename "$f")" != *"$FILTRE"* ]] && continue
  fichiers=$((fichiers + 1))
  echo "── $(basename "$f")"

  # -X ignore le .psqlrc, -t -A donnent du TAP propre sans en-têtes ni cadres.
  if sortie="$(cat "$DIR/_amorce.sql" "$f" "$DIR/_fin.sql" \
                | psql -v ON_ERROR_STOP=1 -q -X -t -A 2>&1)"; then
    :
  else
    echecs=$((echecs + 1))
  fi

  echo "$sortie" | sed '/^$/d'
  total=$((total + $(grep -c '^ok ' <<<"$sortie" || true)))
  # Deux échecs ne font pas sortir psql en erreur, parce qu'aucun des deux
  # n'est une erreur SQL :
  #   `not ok`      — une assertion fausse ;
  #   `# Looks like` — un plan qui ne correspond pas au nombre d'assertions
  #                   réellement exécutées, donc un test ajouté sans bumper
  #                   plan(), ou pire, une série interrompue en silence.
  if grep -qE '^not ok|^# Looks like' <<<"$sortie"; then echecs=$((echecs + 1)); fi
  echo
done

if [ "$fichiers" -eq 0 ]; then
  echo "Aucun fichier de test ne correspond à « $FILTRE »." >&2
  exit 1
fi

echo "── $total assertions, $echecs fichier(s) en échec"
[ "$echecs" -eq 0 ]
