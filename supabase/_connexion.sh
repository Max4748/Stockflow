# Résout COMMENT joindre la base, et rien d'autre. Sourcé par
# `appliquer-schema.sh` et par `tests/lancer.sh` : les deux doivent viser
# le même moteur, et deux définitions auraient divergé au premier ajustement.
#
# Définit une fonction `psql` et la variable `CIBLE` (pour les messages).
#
#   DATABASE_URL  un Postgres joignable, quel qu'il soit. C'est ce qu'emploient
#                 la CI et `compose.test.yaml`, et le seul chemin qui ne
#                 suppose rien de l'installation locale.
#   STACK         à défaut, le dossier de l'instance Supabase de l'auteur,
#                 pilotée par docker compose. Le plus court en développement,
#                 mais plus obligatoire.

if [ -n "${DATABASE_URL:-}" ]; then
  CIBLE="$DATABASE_URL"
  if command -v psql >/dev/null 2>&1; then
    psql() { command psql "$DATABASE_URL" "$@"; }
  else
    # Aucun client sur la machine : on en emprunte un à Docker. `--network
    # host` parce que DATABASE_URL désigne en général 127.0.0.1 vu de l'hôte,
    # que le réseau par défaut d'un conteneur ne joint pas.
    psql() {
      docker run --rm -i --network host postgres:17-alpine psql "$DATABASE_URL" "$@"
    }
  fi
  if ! psql -tAc 'select 1' >/dev/null 2>&1; then
    echo "DATABASE_URL est posée mais la base ne répond pas :" >&2
    echo "  $DATABASE_URL" >&2
    exit 1
  fi
else
  STACK="${STACK:-$HOME/stockflow-supabase}"
  CIBLE="stack $STACK"
  cd "$STACK"
  if ! docker compose ps --status running --quiet db >/dev/null 2>&1; then
    echo "Aucune DATABASE_URL, et la stack $STACK n'est pas démarrée." >&2
    echo "  Soit : cd $STACK && docker compose up -d" >&2
    echo "  Soit : docker compose -f compose.test.yaml up -d --wait" >&2
    echo "         puis DATABASE_URL=postgres://postgres:test@127.0.0.1:5433/postgres" >&2
    exit 1
  fi
  psql() { docker compose exec -T db psql -U postgres -d postgres "$@"; }
fi
