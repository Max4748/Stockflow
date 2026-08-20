"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { exigerAdmin } from "@/lib/auth";
import {
  CHEMIN_ESPACE,
  COOKIE_ESPACE,
  DUREE_COOKIE_ESPACE,
  type Espace,
} from "@/lib/espace";

/**
 * Bascule entre l'espace de gestion et l'espace vendeur.
 *
 * Deux actions plutôt qu'une paramétrée : une Server Action est une URL, et
 * une action « aller à l'espace X » prendrait X de l'appelant. Ici la
 * destination est écrite dans le code, il n'y a rien à falsifier.
 *
 * La garde est RAPPELÉE comme dans toute action du projet — même si un vendeur
 * n'obtiendrait de toute façon qu'un cookie sans effet, exigerAdmin() le
 * renvoie sur son espace sans jamais l'écrire.
 *
 * `cookies()` ne s'écrit que depuis une Server Action ou un Route Handler :
 * c'est ce qui interdit un simple <Link> et impose ce fichier.
 */
async function basculer(espace: Espace): Promise<never> {
  await exigerAdmin();

  (await cookies()).set(COOKIE_ESPACE, espace, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: DUREE_COOKIE_ESPACE,
  });

  redirect(CHEMIN_ESPACE[espace]);
}

export async function basculerVersVendeur() {
  await basculer("vendeur");
}

export async function basculerVersGestion() {
  await basculer("gestion");
}
