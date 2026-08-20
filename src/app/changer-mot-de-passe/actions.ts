"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { creerClient } from "@/lib/supabase/server";
import type { EtatAction } from "@/lib/types";

const LONGUEUR_MINIMALE = 10;

export async function changerMotDePasse(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  const nouveau = String(formData.get("nouveau") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (nouveau.length < LONGUEUR_MINIMALE) {
    return {
      erreur: `Le mot de passe doit faire au moins ${LONGUEUR_MINIMALE} caractères.`,
    };
  }
  if (nouveau !== confirmation) {
    return { erreur: "Les deux saisies ne correspondent pas." };
  }

  const supabase = await creerClient();

  // La garde est ici, pas seulement dans le layout : cette action est une URL
  // et rien n'oblige un appelant à passer par l'interface.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erreur: "Session expirée. Se reconnecter." };

  const { error } = await supabase.auth.updateUser({ password: nouveau });
  if (error) return { erreur: error.message };

  // Lève le drapeau `doit_changer_mdp`. Cette RPC n'écrit que sa propre ligne
  // et que cette colonne — portée minimale volontaire.
  const { error: erreurDrapeau } = await supabase.rpc("marquer_mdp_change");
  if (erreurDrapeau) return { erreur: erreurDrapeau.message };

  revalidatePath("/", "layout");
  redirect("/");
}
