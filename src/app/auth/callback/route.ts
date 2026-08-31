import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { creerClient } from "@/lib/supabase/server";

/**
 * Point d'atterrissage des liens envoyés par courriel.
 *
 * Seul route handler du projet, et il ne peut pas être autre chose : c'est ici
 * qu'une session est établie, donc ni un layout ni une Server Action ne
 * conviendraient. Il doit rester joignable sans session (voir CHEMINS_PUBLICS
 * dans src/proxy.ts).
 *
 * `@supabase/ssr` utilise le flux PKCE : le lien porte un `token_hash` et un
 * `type`, échangés ici contre de vrais cookies de session. C'est aussi pour ça
 * que le gabarit d'email construit son URL à la main plutôt que d'employer
 * `{{ .ConfirmationURL }}` — celle-ci passe par `/auth/v1/verify` de GoTrue,
 * qui renvoie la session dans le FRAGMENT de l'URL, lequel n'est jamais
 * transmis au serveur. Cette fonction ne verrait rien.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // `request.url` porte l'origine interne du conteneur : rediriger dessus
  // enverrait l'utilisateur sur une adresse injoignable. L'origine publique
  // vient de la configuration, jamais d'un en-tête que l'appelant contrôle.
  const origine = env.APP_URL;

  // Seul un chemin interne est accepté : `//ailleurs.example` est une URL
  // absolue pour un navigateur, et laisserait ce lien servir de redirection
  // ouverte depuis un domaine de confiance.
  const suiteBrute = searchParams.get("next") ?? "/changer-mot-de-passe";
  const suite =
    suiteBrute.startsWith("/") && !suiteBrute.startsWith("//")
      ? suiteBrute
      : "/changer-mot-de-passe";

  if (tokenHash && type) {
    const supabase = await creerClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origine}${suite}`);
    }
  }

  // Lien expiré, déjà consommé, ou tronqué par un client de messagerie. Le
  // message est le même dans les trois cas : distinguer « expiré » de
  // « inconnu » renseignerait un attaquant sur la validité d'un jeton.
  return NextResponse.redirect(`${origine}/login?erreur=lien-invalide`);
}
