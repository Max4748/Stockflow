"use server";

import { revalidatePath } from "next/cache";

import { exigerDev } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import type { EtatAction } from "@/lib/types";

/**
 * Vide les données d'exploitation, conserve les comptes.
 *
 * La garde applicative est `exigerDev()`, mais ce n'est pas elle qui protège :
 * `reinitialiser_donnees` vérifie `est_dev()` ET exige la phrase de
 * confirmation en base. Un appel direct à la RPC sans la phrase échoue, ce
 * qu'aucun contrôle côté client ne pourrait garantir.
 *
 * La phrase est transmise telle que saisie, sans normalisation : c'est la base
 * qui juge, et elle doit juger de ce que l'utilisateur a réellement tapé.
 */
export async function reinitialiserDonnees(
  _etat: EtatAction,
  donnees: FormData,
): Promise<EtatAction> {
  await exigerDev();

  const confirmation = String(donnees.get("confirmation") ?? "");

  const supabase = await creerClient();
  const { data, error } = await supabase.rpc("reinitialiser_donnees", {
    p_confirmation: confirmation,
  });
  if (error) return { erreur: error.message };

  const comptes = (data ?? {}) as Record<string, number>;
  const total = Object.values(comptes).reduce((s, n) => s + Number(n), 0);

  revalidatePath("/", "layout");
  return {
    succes: `Base réinitialisée : ${total} ligne(s) effacée(s). Les comptes sont intacts.`,
    jeton: crypto.randomUUID(),
  };
}
