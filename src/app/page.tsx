import { redirect } from "next/navigation";

import { profilCourant } from "@/lib/auth";
import { CHEMIN_ESPACE, espaceMemorise } from "@/lib/espace";
import { estEncadrement } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Aiguillage selon le rôle. Aucun contenu propre. */
export default async function Accueil() {
  const profil = await profilCourant();

  if (!profil) redirect("/login");
  if (!profil.actif) redirect("/en-attente");
  if (profil.doit_changer_mdp) redirect("/changer-mot-de-passe");

  if (!estEncadrement(profil.role)) redirect("/vendeur");

  // L'encadrement a deux espaces : on le renvoie là où il était la dernière
  // fois. Cookie absent ou illisible → la gestion, qui reste sa porte d'entrée
  // par défaut.
  redirect(CHEMIN_ESPACE[(await espaceMemorise()) ?? "gestion"]);
}
