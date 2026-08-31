"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  enregistrerEchec,
  evaluer,
  oublier,
} from "@/lib/anti-bourrage";
import { creerClient } from "@/lib/supabase/server";
import type { EtatAction } from "@/lib/types";

/** Identifiant d'appareil, opaque, sans rapport avec un compte. */
const COOKIE_APPAREIL = "sf-appareil";

const attendre = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * L'IP réelle de l'appelant.
 *
 * `CF-Connecting-IP` fait foi ICI et nulle part ailleurs : l'application
 * n'écoute que sur `127.0.0.1` derrière `cloudflared`, avec `ufw` en deny-all.
 * Personne d'autre que le tunnel ne peut poser cet en-tête. Contrairement à
 * `x-forwarded-host` (voir env.ts), il n'existe aucune autre source pour cette
 * information : la règle est « ne pas faire confiance sans nécessité », pas
 * « ne jamais faire confiance ».
 */
async function ipAppelante(): Promise<string | null> {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? null;
}

export async function seConnecter(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const motDePasse = String(formData.get("motDePasse") ?? "");

  if (!email || !motDePasse) {
    return { erreur: "Renseigner l'adresse e-mail et le mot de passe." };
  }

  const supabase = await creerClient();
  const ip = await ipAppelante();
  const boite = await cookies();
  const appareil = boite.get(COOKIE_APPAREIL)?.value ?? null;

  // Palier 3, en base : il survit aux redéploiements, contrairement aux deux
  // premiers. Le message ne dit pas que c'est l'IP qui est en cause.
  if (ip) {
    const { data: bloquee } = await supabase.rpc("ip_est_bloquee", { p_ip: ip });
    if (bloquee === true) {
      return { erreur: "Trop de tentatives. Réessayer plus tard." };
    }
  }

  // Paliers 1 et 2, en mémoire. Les deux clés : l'appareil ne pénalise jamais
  // le titulaire du compte, l'adresse rattrape celui qui efface son cookie.
  const cles = [appareil ? `a:${appareil}` : null, `e:${email}`].filter(
    (c): c is string => c !== null,
  );
  const decision = evaluer(cles);
  if (decision.refuser) {
    return {
      erreur: `Trop de tentatives. Réessayer dans ${decision.secondesRestantes} s.`,
    };
  }
  await attendre(decision.delaiMs);
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: motDePasse,
  });

  if (error) {
    // Le cookie n'est posé QU'ICI, au premier échec : afficher la page de
    // connexion ne marque personne.
    const id = appareil ?? randomUUID();
    if (!appareil) {
      boite.set(COOKIE_APPAREIL, id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    const { doitBloquerIp, adressesDistinctes } = enregistrerEchec(
      [`a:${id}`, `e:${email}`],
      ip,
      email,
    );

    // Une seule écriture par blocage, au franchissement du seuil, et non une
    // par tentative : le journal doit rester lisible.
    if (doitBloquerIp && ip) {
      await supabase.rpc("bloquer_ip", {
        p_ip: ip,
        p_motif: `${adressesDistinctes} adresses distinctes essayées`,
      });
    }

    // Message volontairement identique pour un e-mail inconnu et un mot de
    // passe faux : distinguer les deux révélerait quels comptes existent.
    return { erreur: "Identifiants incorrects." };
  }

  oublier(cles);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function seDeconnecter() {
  const supabase = await creerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
