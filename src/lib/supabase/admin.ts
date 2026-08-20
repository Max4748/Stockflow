import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * ⚠️ CLIENT À PRIVILÈGES — LA CLÉ service_role CONTOURNE TOUTE LA RLS. ⚠️
 *
 * Ce client ignore les 17 policies du schéma et toutes les gardes des RPC.
 * Il n'a donc qu'UN usage légitime : les opérations `auth.admin.*` (créer un
 * compte, réinitialiser un mot de passe), que l'API publique ne permet pas.
 *
 * RÈGLE ABSOLUE : ne JAMAIS s'en servir pour lire ou écrire des données
 * métier. Un `clientAdmin().from("ventes").select()` renverrait les ventes de
 * tout le monde sans le moindre contrôle — et sans aucune erreur pour le
 * signaler. Pour ces cas, utiliser creerClient() de ./server.ts, qui respecte
 * la session et la RLS.
 *
 * Toute nouvelle utilisation de ce module doit être relue avec cette question :
 * est-ce bien une opération de gestion de COMPTE, et non de DONNÉES ?
 */
export function clientAdmin() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // Ce client est sans état : il n'a pas de session à entretenir.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
