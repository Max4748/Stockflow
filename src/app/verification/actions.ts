"use server";

import { redirect } from "next/navigation";

import { exigerAdminSansFacteur } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";

export type EtatVerification = { erreur?: string };

/**
 * Valide le second facteur et fait passer la session en `aal2`.
 *
 * `exigerAdminSansFacteur` et non `exigerAdmin` : la session est par
 * définition en `aal1` quand on arrive ici, et `exigerAdmin` redirigerait vers
 * la page qui appelle cette action.
 */
export async function verifierCode(
  _etat: EtatVerification,
  donnees: FormData,
): Promise<EtatVerification> {
  await exigerAdminSansFacteur();

  const code = String(donnees.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    return { erreur: "Le code doit comporter 6 chiffres." };
  }

  const supabase = await creerClient();

  const { data: facteurs, error: erreurFacteurs } =
    await supabase.auth.mfa.listFactors();
  if (erreurFacteurs) return { erreur: erreurFacteurs.message };

  const totp = facteurs?.totp?.find((f) => f.status === "verified");
  if (!totp) return { erreur: "Aucun authentificateur enregistré." };

  const { data: defi, error: erreurDefi } = await supabase.auth.mfa.challenge({
    factorId: totp.id,
  });
  if (erreurDefi) return { erreur: erreurDefi.message };

  const { error } = await supabase.auth.mfa.verify({
    factorId: totp.id,
    challengeId: defi.id,
    code,
  });

  if (error) {
    // Le message de Supabase ne dit pas la cause la plus fréquente : une
    // horloge de téléphone décalée invalide un code pourtant bien recopié.
    return {
      erreur: "Code incorrect. Vérifier l'heure du téléphone, puis réessayer.",
    };
  }

  redirect("/gestion");
}
