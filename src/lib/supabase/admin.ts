import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * ⚠️ CLIENT À PRIVILÈGES — LA CLÉ service_role CONTOURNE TOUTE LA RLS. ⚠️
 *
 * Ce client ignore toutes les policies du schéma et toutes les gardes des RPC.
 *
 * RÈGLE ABSOLUE : ne JAMAIS s'en servir pour lire ou écrire des données
 * MÉTIER. Un `clientAdmin().from("ventes").select()` renverrait les ventes de
 * tout le monde sans le moindre contrôle, et sans aucune erreur pour le
 * signaler. Pour ces cas, utiliser creerClient() de ./server.ts, qui respecte
 * la session et la RLS.
 *
 * DEUX USAGES LÉGITIMES, et deux seulement :
 *
 *   1. Les opérations `auth.admin.*` (créer un compte, réinitialiser un mot de
 *      passe), que l'API publique ne permet pas.
 *   2. Les opérations qui doivent être réservées AU SERVEUR parce qu'aucune
 *      session ne peut les autoriser. À ce jour une seule : `bloquer_ip()`,
 *      appelée depuis le formulaire de connexion, donc sans session par
 *      définition, et dont le paramètre est une adresse arbitraire. L'ouvrir à
 *      `anon` laissait bloquer n'importe qui (voir la migration 0034).
 *
 * Le second cas ne dilue pas la règle : une adresse IP bloquée n'est pas une
 * donnée métier, c'est de l'état d'infrastructure. Le critère reste le même,
 * et la question à se poser en ajoutant un usage n'a pas changé de nature :
 * est-ce une donnée de l'entreprise, ou le fonctionnement du serveur ?
 *
 * Un secret partagé passé en paramètre aurait été le choix alternatif. Il a
 * été écarté : un secret dans un paramètre de fonction finit dans
 * `pg_stat_statements`, dans les journaux Postgres, et dans les messages
 * d'erreur. Réutiliser une clé déjà confinée au serveur expose moins.
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
