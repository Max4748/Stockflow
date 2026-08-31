/**
 * Rejeu du schéma sur un Postgres neuf, trois fois de suite.
 *
 *     npm run test:db
 *
 * Moteur : PGlite (Postgres compilé en WASM). Ni Docker ni instance Supabase
 * requis, donc exécutable sur une machine de développement comme en CI.
 *
 * Ce que ce test prouve, et que `appliquer-schema.sh` ne prouve pas :
 *
 *   passe 1  l'installation depuis une base VIDE. Le script d'exploitation
 *            rejoue toujours sur une base déjà migrée : il ne dirait rien
 *            d'un `alter table ... add column` qui présuppose la colonne.
 *   passe 2  le redéploiement. C'est la passe qui attrape une vue dont les
 *            colonnes de sortie ont changé (`create or replace view` ne sait
 *            qu'ajouter des colonnes en fin de liste) ou une fonction dont
 *            le type de retour a bougé.
 *   passe 3  la stabilité. Un fichier peut être idempotent une fois sans
 *            l'être deux, typiquement un renommage gardé par un `if exists`
 *            qui redevient vrai après le passage suivant.
 *
 * Les assertions MÉTIER ne sont pas ici : elles vivent en pgTAP dans les
 * fichiers voisins, contre le vrai moteur, avec les vraies extensions. Ce
 * fichier ne répond qu'à une question, celle qui casse un déploiement entier
 * quand la réponse est non : le schéma se rejoue-t-il ?
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

import { instructions } from "../../scripts/instructions-sql.mjs";
import { fichiersSchema } from "../../scripts/fichiers-schema.mjs";


const PASSES = 3;

const db = new PGlite();

// ---------------------------------------------------------------------------
// Shim Supabase : ce que l'instance fournit et sur quoi le schéma s'appuie.
//
// Aucun privilège par défaut n'est accordé, volontairement. Un projet Supabase
// réel accorde `select` à `authenticated` sur les nouvelles tables ; ne pas le
// faire ici reproduit le cas le plus strict et vérifie que les fichiers
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

  -- auth.uid() lit le même GUC que l'instance réelle : les fichiers
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

const fichiers = fichiersSchema();

if (fichiers.length === 0) {
  console.error("Aucun fichier trouvé dans supabase/schema/.");
  process.exit(1);
}

console.log(`\x1b[36m── Rejeu de ${fichiers.length} fichiers de schéma, ${PASSES} passes\x1b[0m`);

const RAISON = {
  1: "installation depuis une base vide",
  2: "redéploiement sur une base déjà migrée",
  3: "stabilité du rejeu",
};

for (let passe = 1; passe <= PASSES; passe++) {
    for (const { couche, nom, chemin } of fichiers) {
      const f = `${couche}/${nom}`;
    let courante = "";
    try {
        for (const s of instructions(readFileSync(chemin, "utf8"))) {
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
// Inventaire : le même que celui d'appliquer-schema.sh, pour que les deux
// chemins racontent la même chose. Une divergence signalerait un objet créé
// par l'instance Supabase plutôt que par le schéma.
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
