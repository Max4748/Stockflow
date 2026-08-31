"use server";

import { revalidatePath } from "next/cache";

import { exigerDev } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import type { EtatAction } from "@/lib/types";

/**
 * Rendre l'accès à une IP bloquée.
 *
 * La garde applicative est `exigerDev()`, mais ce n'est pas elle qui protège :
 * `lever_blocage_ip` vérifie `est_dev()` en base. Un gérant appelant l'action
 * directement serait rejeté par le SQL même si la garde sautait.
 */
export async function leverBlocageIp(
  _etat: EtatAction,
  donnees: FormData,
): Promise<EtatAction> {
  await exigerDev();

  const ip = String(donnees.get("ip") ?? "").trim();
  if (!ip) return { erreur: "Adresse manquante." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("lever_blocage_ip", { p_ip: ip });
  if (error) return { erreur: error.message };

  revalidatePath("/gestion/journal-admin");
  return { succes: `Accès rendu à ${ip}.`, jeton: crypto.randomUUID() };
}

/**
 * Bloquer une IP sans échéance.
 *
 * Le seul chemin vers un blocage définitif, et il est humain. Les blocages
 * automatiques expirent toujours : une IP n'est pas une identité, et celle qui
 * attaque aujourd'hui appartiendra à quelqu'un d'autre dans trois semaines.
 * Le motif est obligatoire, imposé en base : c'est lui qui rendra la décision
 * relisible le jour où quelqu'un se demandera pourquoi cette adresse est là.
 */
export async function bloquerIpDefinitivement(
  _etat: EtatAction,
  donnees: FormData,
): Promise<EtatAction> {
  await exigerDev();

  const ip = String(donnees.get("ip") ?? "").trim();
  const motif = String(donnees.get("motif") ?? "").trim();
  if (!ip) return { erreur: "Adresse manquante." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("bloquer_ip_definitivement", {
    p_ip: ip,
    p_motif: motif,
  });
  if (error) return { erreur: error.message };

  revalidatePath("/gestion/journal-admin");
  return { succes: `${ip} bloquée sans échéance.`, jeton: crypto.randomUUID() };
}
