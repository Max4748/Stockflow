import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout : l'application construite (`next start`), servie
 * contre un FAUX Supabase (`e2e/faux-supabase.mjs`).
 *
 * Ils vérifient l'interface (un écran s'affiche, un tri change l'ordre, un
 * vendeur est refoulé de la gestion), pas les règles métier, qui vivent en SQL
 * et ont leurs tests pgTAP. Voir docs/tests.md.
 *
 *   npm run build && npm run test:e2e
 *
 * `next start` et non `next dev` : c'est ce qui tourne en production, et la
 * compilation à la volée de `dev` rendrait les premiers tests lents et
 * instables.
 */
const PORT = 3100;
const PORT_SUPABASE = 8001;
const URL_APP = `http://127.0.0.1:${PORT}`;
// Les serveurs sont muets par défaut : `@supabase/ssr` écrit un avertissement
// à chaque requête quand la session vient d'un cookie non signé, ce qui est
// le cas de TOUTES les requêtes ici, et noierait le compte rendu des tests.
// `JOURNAL_SERVEUR=1` les rend bavards pour déboguer un échec.
const SORTIE = process.env.JOURNAL_SERVEUR ? "pipe" : "ignore";

export default defineConfig({
  testDir: "./e2e",
  // Les données du faux serveur sont en lecture seule : les tests ne se
  // marchent pas dessus et peuvent tourner en parallèle.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: URL_APP,
    // Pas de trace par défaut : elle coûte cher à chaque test. Pour déboguer
    // un échec, relancer ce test avec `--trace on`.
    trace: "off",
    locale: "fr-FR",
    ...devices["Desktop Chrome"],
    // Un Chromium déjà présent sur la machine (conteneur de développement)
    // plutôt que celui que Playwright téléchargerait.
    launchOptions: process.env.CHROMIUM
      ? { executablePath: process.env.CHROMIUM }
      : {},
  },
  webServer: [
    {
      command: "node e2e/faux-supabase.mjs",
      url: `http://127.0.0.1:${PORT_SUPABASE}/auth/v1/health`,
      reuseExistingServer: !process.env.CI,
      env: { PORT_FAUX_SUPABASE: String(PORT_SUPABASE) },
      stdout: SORTIE,
      stderr: SORTIE,
    },
    {
      command: `npx next start -p ${PORT} -H 127.0.0.1`,
      url: `${URL_APP}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: SORTIE,
      stderr: SORTIE,
      // Valeurs de façade : seul l'hôte compte, il pointe sur le faux serveur.
      env: {
        SUPABASE_URL: `http://127.0.0.1:${PORT_SUPABASE}`,
        SUPABASE_ANON_KEY: "e2e-sans-effet",
        SUPABASE_SERVICE_ROLE_KEY: "e2e-sans-effet",
        APP_URL: URL_APP,
      },
    },
  ],
});
