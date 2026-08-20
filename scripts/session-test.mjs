/**
 * Utilitaire de DÉVELOPPEMENT — fabrique les cookies de session d'un compte
 * pour tester les pages au curl, sans navigateur.
 *
 *   node scripts/session-test.mjs <adresse> '<mot-de-passe>'
 *
 * On laisse @supabase/ssr produire les cookies lui-même : leur nom dérive de
 * l'URL Supabase, la valeur est encodée et parfois découpée en morceaux.
 * Deviner ce format à la main serait fragile.
 */
import { createServerClient } from "@supabase/ssr";
import fs from "node:fs";
import path from "node:path";

const racine = path.resolve(import.meta.dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(racine, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const captures = [];
const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  cookies: { getAll: () => [], setAll: (liste) => captures.push(...liste) },
});

const { error } = await supabase.auth.signInWithPassword({
  email: process.argv[2],
  password: process.argv[3],
});
if (error) {
  console.error("ERREUR:", error.message);
  process.exit(1);
}

process.stdout.write(captures.map((c) => `${c.name}=${c.value}`).join("; "));
