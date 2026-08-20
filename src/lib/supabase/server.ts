import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Client Supabase pour Server Components et Server Actions.
 *
 * Il porte la clé anon et la session de l'utilisateur : toutes ses requêtes
 * sont donc soumises à la RLS. C'est le client à utiliser partout, sauf pour
 * les opérations d'administration de comptes (voir ./admin.ts).
 */
export async function creerClient() {
  const cookieStore = await cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesAEcrire) {
        try {
          for (const { name, value, options } of cookiesAEcrire) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Écrire un cookie depuis un Server Component est interdit par Next.
          // Ce n'est pas une erreur : le rafraîchissement de session est fait
          // par src/proxy.ts, qui lui a le droit d'écrire sur la réponse.
        }
      },
    },
  });
}
