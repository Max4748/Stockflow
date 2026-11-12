import type { BrowserContext } from "@playwright/test";

/**
 * Ouvre une session sans passer par l'écran de connexion : le cookie que
 * `@supabase/ssr` aurait posé, fabriqué à la main.
 *
 * Le jeton n'est signé par personne. Le faux Supabase ne vérifie pas la
 * signature, il lit seulement l'identifiant (`sub`) ; c'est précisément
 * pourquoi ce cookie ne vaut rien contre un vrai projet.
 *
 * Le nom du cookie dérive de l'hôte de `SUPABASE_URL` : `127.0.0.1` → `127`.
 */
export const GERANT = "a0000000-0000-4000-8000-000000000001";
export const VENDEUR = "b0000000-0000-4000-8000-000000000001";

const base64 = (valeur: unknown) =>
  Buffer.from(JSON.stringify(valeur)).toString("base64url");

export async function connecter(contexte: BrowserContext, identifiant: string) {
  const expiration = Math.floor(Date.now() / 1000) + 3600;
  const jeton = [
    base64({ alg: "HS256", typ: "JWT" }),
    base64({
      sub: identifiant,
      exp: expiration,
      aal: "aal1",
      role: "authenticated",
      aud: "authenticated",
      session_id: "e2e",
    }),
    Buffer.alloc(32, 7).toString("base64url"),
  ].join(".");

  await contexte.addCookies([
    {
      name: "sb-127-auth-token",
      value: `base64-${base64({
        access_token: jeton,
        refresh_token: "e2e",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: expiration,
        user: { id: identifiant, aud: "authenticated", email: "e2e@exemple.fr", factors: [] },
      })}`,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}
