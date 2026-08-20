import { cookies } from "next/headers";

/**
 * Mémoire du dernier espace utilisé par un compte d'encadrement.
 *
 * Un gérant pilote ET vend : le forcer à repasser par /gestion à chaque
 * connexion lui coûte un clic de plus tous les matins alors qu'il passe sa
 * journée sur le terrain.
 *
 * Ce cookie est un CONFORT DE NAVIGATION, jamais une autorisation. Il ne dit
 * pas ce qu'un compte a le droit de faire, seulement où il aimerait atterrir :
 * un vendeur qui le fabriquerait à la main obtiendrait exactement ce qu'il
 * obtient déjà en tapant /gestion — une redirection vers /vendeur par
 * exigerAdmin(). Voir docs/securite.md.
 */

export const COOKIE_ESPACE = "sf-espace";

export type Espace = "gestion" | "vendeur";

export const CHEMIN_ESPACE: Record<Espace, string> = {
  gestion: "/gestion",
  vendeur: "/vendeur",
};

/** Un an : la valeur ne vaut rien, la reperdre n'est qu'un désagrément. */
export const DUREE_COOKIE_ESPACE = 60 * 60 * 24 * 365;

/**
 * Espace mémorisé, ou `null` — cookie absent comme valeur inconnue. Le défaut
 * (`/gestion`) appartient à l'appelant, pas à ce lecteur.
 */
export async function espaceMemorise(): Promise<Espace | null> {
  const valeur = (await cookies()).get(COOKIE_ESPACE)?.value;
  return valeur === "gestion" || valeur === "vendeur" ? valeur : null;
}
