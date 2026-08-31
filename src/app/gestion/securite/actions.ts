"use server";

import { revalidatePath } from "next/cache";

import { exigerAdminSansFacteur } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";

export type EtatMfa = { erreur?: string; succes?: string };

/**
 * Démarre un enrôlement TOTP.
 *
 * Renvoie le QR code ET le secret en clair : un poste sans caméra, ou un
 * gestionnaire de mots de passe, ne peut rien faire d'une image.
 *
 * `exigerAdminSansFacteur` partout dans ce fichier : au moment de
 * l'enrôlement la session est forcément en `aal1`, puisque aucun facteur
 * vérifié n'existe encore.
 */
export async function demarrerEnrolement(): Promise<{
  erreur?: string;
  factorId?: string;
  qr?: string;
  secret?: string;
}> {
  await exigerAdminSansFacteur();
  const supabase = await creerClient();

  // Un enrôlement abandonné en cours de route laisse un facteur `unverified`
  // qui fait échouer le suivant : le nom du facteur doit être unique. On
  // nettoie donc avant, plutôt que de renvoyer une erreur incompréhensible.
  const { data: existants } = await supabase.auth.mfa.listFactors();
  for (const facteur of existants?.all ?? []) {
    if (facteur.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: facteur.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `StockFlow ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) return { erreur: error.message };

  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirme l'enrôlement avec le premier code produit par l'authentificateur. */
export async function confirmerEnrolement(
  _etat: EtatMfa,
  donnees: FormData,
): Promise<EtatMfa> {
  await exigerAdminSansFacteur();

  const factorId = String(donnees.get("factorId") ?? "").trim();
  const code = String(donnees.get("code") ?? "").replace(/\s/g, "");

  if (!factorId) return { erreur: "Enrôlement introuvable, recommencer." };
  if (!/^\d{6}$/.test(code)) {
    return { erreur: "Le code doit comporter 6 chiffres." };
  }

  const supabase = await creerClient();

  const { data: defi, error: erreurDefi } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (erreurDefi) return { erreur: erreurDefi.message };

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: defi.id,
    code,
  });
  if (error) {
    return {
      erreur: "Code incorrect. Vérifier l'heure du téléphone, puis réessayer.",
    };
  }

  revalidatePath("/gestion/securite");
  return { succes: "Double authentification activée." };
}

/** Retire le facteur : le compte revient au seul mot de passe. */
export async function retirerFacteur(
  _etat: EtatMfa,
  donnees: FormData,
): Promise<EtatMfa> {
  await exigerAdminSansFacteur();

  const factorId = String(donnees.get("factorId") ?? "").trim();
  if (!factorId) return { erreur: "Facteur manquant." };

  const supabase = await creerClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { erreur: error.message };

  revalidatePath("/gestion/securite");
  return { succes: "Double authentification désactivée." };
}
