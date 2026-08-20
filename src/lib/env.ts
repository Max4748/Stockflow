/**
 * Variables d'environnement, validées au chargement.
 *
 * Aucune n'est préfixée NEXT_PUBLIC_ : StockFlow ne parle à Supabase que
 * depuis le serveur. Trois conséquences voulues :
 *   - la clé anon ne part jamais dans le bundle navigateur ;
 *   - changer d'URL (dev → conteneur → Cloudflare) ne demande aucun rebuild ;
 *   - un import accidentel de ce module depuis un composant client échouerait
 *     au build, ce qui est exactement le garde-fou souhaité.
 */

function requis(nom: string): string {
  const v = process.env[nom];
  if (!v) {
    // Message explicite : sans ça, l'absence de variable se manifesterait bien
    // plus tard sous forme d'un « fetch failed » sans contexte.
    throw new Error(
      `Variable d'environnement manquante : ${nom}. ` +
        `Vérifier .env.local (dev) ou .env (conteneur) — modèle dans .env.example.`,
    );
  }
  return v;
}

export const env = {
  SUPABASE_URL: requis("SUPABASE_URL"),
  SUPABASE_ANON_KEY: requis("SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: requis("SUPABASE_SERVICE_ROLE_KEY"),
} as const;
