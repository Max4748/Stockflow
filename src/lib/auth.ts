import { redirect } from "next/navigation";

import { creerClient } from "@/lib/supabase/server";
import { estEncadrement, type Profil } from "@/lib/types";

/**
 * Gardes d'autorisation.
 *
 * Elles sont appelées dans les layouts ET rappelées dans CHAQUE Server Action.
 * Un layout ne protège pas une action invoquée directement : une Server Action
 * est une URL comme une autre, et rien n'oblige un appelant à passer par
 * l'interface. La RLS reste la dernière barrière, mais une garde applicative
 * donne un message clair au lieu d'un tableau vide.
 */

export async function profilCourant(): Promise<Profil | null> {
  const supabase = await creerClient();

  // getUser() et non getSession() : getUser revalide le jeton auprès de
  // Supabase. getSession se contente de lire le cookie, qui est manipulable
  // côté client — inutilisable pour une décision d'autorisation.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // La RLS de `profils` restreint déjà à sa propre ligne.
  const { data } = await supabase
    .from("profils")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return (data as Profil | null) ?? null;
}

/** Exige un compte connecté, actif, et dont le mot de passe est à jour. */
export async function exigerProfil(): Promise<Profil> {
  const profil = await profilCourant();

  if (!profil) redirect("/login");
  if (!profil.actif) redirect("/en-attente");
  if (profil.doit_changer_mdp) redirect("/changer-mot-de-passe");

  return profil;
}

/**
 * Exige un niveau d'encadrement — gérant OU dev.
 *
 * Le nom est conservé volontairement : tous ses appels signifient « gérant ou
 * au-dessus », exactement comme la fonction SQL est_admin() dont c'est le
 * pendant applicatif. Les renommer n'aurait rien apporté et aurait multiplié
 * les occasions d'en oublier un.
 */
export async function exigerAdmin(): Promise<Profil> {
  const profil = await exigerProfil();
  if (!estEncadrement(profil.role)) redirect("/vendeur");
  return profil;
}

/**
 * Exige le propriétaire technique.
 *
 * Un gérant est renvoyé sur le bilan, pas en erreur : il n'a rien fait de mal,
 * l'écran ne le concerne simplement pas.
 */
export async function exigerDev(): Promise<Profil> {
  const profil = await exigerAdmin();
  if (profil.role !== "dev") redirect("/gestion");
  return profil;
}
