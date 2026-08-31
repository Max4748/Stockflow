/**
 * Rejeu des migrations sur un Postgres neuf, trois fois de suite.
 *
 *     npm run test:db
 *
 * Moteur : PGlite (Postgres compilé en WASM). Ni Docker ni instance Supabase
 * requis, donc exécutable sur une machine de développement comme en CI.
 *
 * Ce que ce test prouve, et que `appliquer-migrations.sh` ne prouve pas :
 *
 *   passe 1  l'installation depuis une base VIDE. Le script d'exploitation
 *            rejoue toujours sur une base déjà migrée : il ne dirait rien
 *            d'un `alter table ... add column` qui présuppose la colonne.
 *   passe 2  le redéploiement. C'est la passe qui attrape une vue dont les
 *            colonnes de sortie ont changé (`create or replace view` ne sait
 *            qu'ajouter des colonnes en fin de liste) ou une fonction dont
 *            le type de retour a bougé.
 *   passe 3  la stabilité. Une migration peut être idempotente une fois sans
 *            l'être deux, typiquement un renommage gardé par un `if exists`
 *            qui redevient vrai après le passage suivant.
 *
 * Les assertions MÉTIER ne sont pas ici : elles vivent en pgTAP dans les
 * fichiers voisins, contre le vrai moteur, avec les vraies extensions. Ce
 * fichier ne répond qu'à une question, celle qui casse un déploiement entier
 * quand la réponse est non : le schéma se rejoue-t-il ?
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Découpe un fichier en instructions, pour les envoyer UNE PAR UNE.
 *
 * Ce n'est pas un détail d'implémentation : envoyer tout un fichier d'un bloc
 * le fait exécuter dans une seule transaction implicite, et Postgres refuse
 * alors d'utiliser une valeur d'enum ajoutée dans cette même transaction
 * (« unsafe use of new value »). C'est le cas de 0014, qui ajoute 'sav' à
 * type_mouvement puis s'en sert. Le comportement reproduit ici est celui de
 * appliquer-migrations.sh, c'est-à-dire psql SANS -1 : autocommit par
 * instruction.
 *
 * Corollaire à connaître : le schéma de StockFlow ne peut PAS être appliqué
 * d'un bloc dans une transaction unique. Un bundle `psql -1` échouerait à
 * 0014, sur le vrai moteur comme ici.
 *
 * Le découpage respecte le dollar-quoting (`$$`, `$fn$`), sans quoi chaque
 * `;` d'un corps plpgsql couperait au mauvais endroit.
 */
function instructions(sql) {
  const out = [];
  let debut = 0, i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const f = sql.indexOf("\n", i);
      i = f === -1 ? n : f + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const f = sql.indexOf("*/", i + 2);
      i = f === -1 ? n : f + 2;
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n && sql[i] !== c) i += sql[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "$") {
      const m = /^\$[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const f = sql.indexOf(m[0], i + m[0].length);
        i = f === -1 ? n : f + m[0].length;
      } else i++;
    } else if (c === ";") {
      const s = sql.slice(debut, i).trim();
      if (s) out.push(s);
      debut = ++i;
    } else i++;
  }
  const reste = sql.slice(debut).trim();
  if (reste) out.push(reste);
  return out;
}

const MIG = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const PASSES = 3;

const db = new PGlite();

// ---------------------------------------------------------------------------
// Shim Supabase : ce que l'instance fournit et sur quoi le schéma s'appuie.
//
// Aucun privilège par défaut n'est accordé, volontairement. Un projet Supabase
// réel accorde `select` à `authenticated` sur les nouvelles tables ; ne pas le
// faire ici reproduit le cas le plus strict et vérifie que les migrations
// posent elles-mêmes tous les GRANT dont l'application a besoin.
// ---------------------------------------------------------------------------
await db.exec(`
  create schema if not exists auth;

  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    encrypted_password text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at         timestamptz default now()
  );

  create role authenticated;
  create role anon;
  create role service_role;

  -- auth.uid() lit le même GUC que l'instance réelle : les migrations
  -- utilisent request.jwt.claims, pas une variable inventée pour le test.
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(
      coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ), '')::uuid;
  $fn$;

  create or replace function auth.role() returns text language sql stable as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    )::text;
  $fn$;
`);

const fichiers = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (fichiers.length === 0) {
  console.error("Aucune migration trouvée dans supabase/migrations/.");
  process.exit(1);
}

console.log(`\x1b[36m── Rejeu de ${fichiers.length} migrations, ${PASSES} passes\x1b[0m`);

const RAISON = {
  1: "installation depuis une base vide",
  2: "redéploiement sur une base déjà migrée",
  3: "stabilité du rejeu",
};

for (let passe = 1; passe <= PASSES; passe++) {
  for (const f of fichiers) {
    let courante = "";
    try {
      for (const s of instructions(readFileSync(join(MIG, f), "utf8"))) {
        courante = s;
        await db.exec(s);
      }
    } catch (e) {
      const ligne = e.message.split("\n")[0];
      console.error(`\n  \x1b[31mÉCHEC\x1b[0m passe ${passe} (${RAISON[passe]}) — ${f}`);
      console.error(`         → ${ligne}`);
      if (e.detail) console.error(`         détail : ${e.detail}`);
      if (e.hint) console.error(`         indice : ${e.hint}`);
      console.error(`         instruction : ${courante.split("\n")[0].slice(0, 100)}`);
      console.error(
        passe === 1
          ? "\n\x1b[31mLe schéma ne s'installe pas sur une base vide.\x1b[0m"
          : "\n\x1b[31mLe schéma n'est pas rejouable : le prochain déploiement échouerait.\x1b[0m",
      );
      process.exit(1);
    }
  }
  console.log(`  \x1b[32mOK  \x1b[0m passe ${passe}/${PASSES} — ${RAISON[passe]}`);
}

// ---------------------------------------------------------------------------
// Inventaire : le même que celui d'appliquer-migrations.sh, pour que les deux
// chemins racontent la même chose. Une divergence signalerait un objet créé
// par l'instance Supabase plutôt que par une migration.
// ---------------------------------------------------------------------------
const { rows } = await db.query(`
  select
    (select count(*)::int from pg_tables  where schemaname = 'public') as tables,
    (select count(*)::int from pg_views   where schemaname = 'public') as vues,
    (select count(*)::int from pg_policies where schemaname = 'public') as policies,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public') as fonctions,
    (select count(*)::int from pg_tables t where t.schemaname = 'public'
       and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'public' and c.relname = t.tablename
                          and c.relrowsecurity)) as sans_rls
`);
const i = rows[0];
console.log(
  `\n  ${i.tables} tables · ${i.vues} vues · ${i.policies} policies · ${i.fonctions} fonctions`,
);

if (i.sans_rls !== 0) {
  console.error(`\n  \x1b[31mÉCHEC\x1b[0m ${i.sans_rls} table(s) sans RLS\x1b[0m`);
  process.exit(1);
}
console.log(`  \x1b[32mOK  \x1b[0m aucune table sans RLS`);

console.log("\n\x1b[32mSchéma rejouable.\x1b[0m");
process.exit(0);
