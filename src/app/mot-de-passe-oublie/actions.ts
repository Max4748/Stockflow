"use server";

import { env } from "@/lib/env";
import { creerClient } from "@/lib/supabase/server";

export type EtatOubli = { erreur?: string; envoye?: boolean };

/**
 * Demande un lien de réinitialisation.
 *
 * Aucune garde `exiger*` : par définition, celui qui arrive ici n'a pas de
 * session. C'est la quatrième action du projet dans ce cas, avec `seConnecter`,
 * `seDeconnecter` et `changerMotDePasse` (voir securite.md).
 */
export async function demanderReinitialisation(
  _etat: EtatOubli,
  donnees: FormData,
): Promise<EtatOubli> {
  const email = String(donnees.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email.includes("@")) {
    return { erreur: "Adresse e-mail invalide." };
  }

  // L'origine vient de la configuration. La déduire de `x-forwarded-host`
  // laissait l'appelant choisir la destination du lien qu'il allait recevoir,
  // et donc l'orienter vers un domaine qu'il contrôle.
  const supabase = await creerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.APP_URL}/auth/callback?next=/changer-mot-de-passe`,
  });

  if (error) {
    // Journalisé pour pouvoir diagnostiquer un souci SMTP
    // (`docker compose logs auth`), jamais renvoyé à l'appelant : le message
    // dirait si l'adresse est connue.
    console.error("[reinitialisation] envoi impossible :", error.message);
  }

  // Réponse IDENTIQUE dans tous les cas, y compris sur une adresse inconnue.
  // Sans ça, ce formulaire deviendrait un moyen d'énumérer les comptes, et un
  // vendeur saurait quelles adresses existent. Même logique que le message de
  // `seConnecter`, qui ne distingue pas non plus les deux causes d'échec.
  return { envoye: true };
}
