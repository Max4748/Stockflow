import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Rafraîchissement de session et cloisonnement public / authentifié.
 *
 * Fichier nommé `proxy.ts` : c'est la convention Next 16, l'ancien
 * `middleware.ts`.
 *
 * Ce proxy ne distingue QUE connecté / non connecté. Le contrôle de rôle
 * appartient aux layouts (src/lib/auth.ts) et à la RLS : le mettre ici
 * donnerait l'illusion d'une barrière que les Server Actions contourneraient.
 */

/**
 * Chemins joignables sans session.
 *
 * `/auth` couvre le route handler des liens de courriel : c'est lui qui
 * ÉTABLIT la session, il ne peut donc pas exiger d'en avoir déjà une.
 */
const CHEMINS_PUBLICS = ["/login", "/mot-de-passe-oublie", "/auth"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesAEcrire, headers) {
        for (const { name, value } of cookiesAEcrire) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesAEcrire) {
          response.cookies.set(name, value, options);
        }
        // Recopie les en-têtes fournis par @supabase/ssr (Cache-Control
        // notamment) : sans ça, un cache intermédiaire pourrait conserver une
        // réponse porteuse de cookies d'auth et servir la session d'un vendeur
        // à un autre.
        for (const [cle, valeur] of Object.entries(headers ?? {})) {
          response.headers.set(cle, valeur);
        }
      },
    },
  });

  // getUser() revalide le jeton auprès de Supabase. getSession() ne lit que le
  // cookie : jamais pour une décision d'autorisation.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const chemin = request.nextUrl.pathname;
  const estPublic = CHEMINS_PUBLICS.some((p) => chemin.startsWith(p));

  if (!user && !estPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("suite", chemin);
    return NextResponse.redirect(url);
  }

  if (user && chemin === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // `manifest.webmanifest` et `sw.js` sont exclus au même titre que
  // `favicon.ico` : le navigateur les demande SANS session, depuis l'écran de
  // connexion, pour proposer l'installation. Les laisser passer par le proxy
  // les faisait rediriger vers /login, et l'application n'était jamais
  // installable. Ni l'un ni l'autre ne porte de donnée : le manifeste ne
  // contient qu'un nom et des chemins d'icônes, le service worker ne met en
  // cache que ces icônes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
