"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { creerClient } from "@/lib/supabase/server";
import type { EtatAction } from "@/lib/types";

export async function seConnecter(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  const email = String(formData.get("email") ?? "").trim();
  const motDePasse = String(formData.get("motDePasse") ?? "");

  if (!email || !motDePasse) {
    return { erreur: "Renseigner l'adresse e-mail et le mot de passe." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: motDePasse,
  });

  if (error) {
    // Message volontairement identique pour un e-mail inconnu et un mot de
    // passe faux : distinguer les deux révélerait quels comptes existent.
    return { erreur: "Identifiants incorrects." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function seDeconnecter() {
  const supabase = await creerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
