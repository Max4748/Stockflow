"use server";

import { revalidatePath } from "next/cache";

import { exigerProfil } from "@/lib/auth";
import { euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { EtatAction, LigneVenteSaisie } from "@/lib/types";

/**
 * Chaque action rappelle exigerProfil(). Le layout ne suffit pas : une Server
 * Action est une URL, et rien n'oblige un appelant à passer par l'interface.
 *
 * Aucun calcul métier ici. Les totaux, le contrôle de stock et la dette sont
 * calculés en SQL : c'est ce qui garantit qu'un vendeur ne peut pas fabriquer
 * un montant qui l'arrange en modifiant la requête.
 */

/** Extrait les lignes d'un formulaire à répétition (produit_id[], quantite[]…). */
function lireLignesVente(formData: FormData): LigneVenteSaisie[] {
  const produits = formData.getAll("produit_id").map(String);
  const quantites = formData.getAll("quantite").map(String);
  const prix = formData.getAll("prix_vente_unitaire").map(String);

  const lignes: LigneVenteSaisie[] = [];
  for (let i = 0; i < produits.length; i++) {
    const q = Number(quantites[i]);
    const p = Number(prix[i]);
    // Une ligne laissée vide dans le formulaire est simplement ignorée.
    if (!produits[i] || !Number.isFinite(q) || q <= 0) continue;
    if (!Number.isFinite(p) || p < 0) continue;
    lignes.push({
      produit_id: produits[i],
      quantite: Math.trunc(q),
      prix_vente_unitaire: p,
    });
  }
  return lignes;
}

export async function enregistrerVente(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerProfil();

  const lignes = lireLignesVente(formData);
  if (lignes.length === 0) {
    return { erreur: "Ajouter au moins un produit avec une quantité." };
  }

  const client = String(formData.get("client") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();

  const supabase = await creerClient();
  const { error } = await supabase.rpc("enregistrer_vente", {
    p_lignes: lignes,
    p_client: client || "Anonyme",
    ...(date ? { p_date: date } : {}),
  });

  if (error) {
    // Les messages des RPC sont déjà rédigés pour un humain (« Stock
    // insuffisant pour Produit A : 999 demandée(s), 25 disponible(s). ») :
    // on les affiche tels quels plutôt que de les retraduire.
    return { erreur: error.message };
  }

  const total = lignes.reduce(
    (s, l) => s + l.quantite * l.prix_vente_unitaire,
    0,
  );
  revalidatePath("/vendeur", "layout");
  return {
    succes: `Vente enregistrée : ${euros(total)}.`,
    jeton: crypto.randomUUID(),
  };
}

export async function demanderRestock(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerProfil();

  const produits = formData.getAll("produit_id").map(String);
  const quantites = formData.getAll("quantite").map(String);

  const lignes: { produit_id: string; quantite: number }[] = [];
  for (let i = 0; i < produits.length; i++) {
    const q = Number(quantites[i]);
    if (!produits[i] || !Number.isFinite(q) || q <= 0) continue;
    lignes.push({ produit_id: produits[i], quantite: Math.trunc(q) });
  }

  if (lignes.length === 0) {
    return { erreur: "Indiquer au moins un produit et une quantité." };
  }

  const note = String(formData.get("note") ?? "").trim();

  const supabase = await creerClient();
  const { error } = await supabase.rpc("creer_demande_restock", {
    p_lignes: lignes,
    p_note: note || null,
  });

  if (error) return { erreur: error.message };

  revalidatePath("/vendeur", "layout");
  return {
    succes: "Demande envoyée à l'administrateur.",
    jeton: crypto.randomUUID(),
  };
}

export async function annulerDemande(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerProfil();

  const id = String(formData.get("demande_id") ?? "");
  if (!id) return { erreur: "Demande introuvable." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("annuler_demande_restock", {
    p_demande_id: id,
  });

  if (error) return { erreur: error.message };

  revalidatePath("/vendeur", "layout");
  return { succes: "Demande annulée.", jeton: crypto.randomUUID() };
}

/**
 * Signaler une défaillance sur une de ses ventes.
 *
 * Le vendeur est le seul à constater la panne : il déclare, et c'est le SQL qui
 * décide du régime. Un échange prend effet immédiatement — il a déjà remis
 * l'unité au client, refuser de l'écrire ferait mentir son stock. Un
 * remboursement reste en attente du gérant : c'est de l'argent, et il diminue
 * la dette de celui qui le déclare.
 *
 * Rien de tout cela n'est un paramètre : cette action ne transmet que ce que le
 * vendeur a saisi.
 */
export async function signalerSav(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerProfil();

  const [venteId, produitId] = String(formData.get("ligne") ?? "").split("|");
  if (!venteId || !produitId) return { erreur: "Vente non précisée." };

  const quantite = Number(formData.get("quantite"));
  if (!Number.isFinite(quantite) || quantite <= 0) {
    return { erreur: "Indiquer une quantité d'au moins une unité." };
  }

  const resolution = String(formData.get("resolution") ?? "");
  if (resolution !== "echange" && resolution !== "remboursement") {
    return { erreur: "Choisir l'échange ou le remboursement." };
  }

  const motif = String(formData.get("motif") ?? "").trim();
  if (!motif) return { erreur: "Décrire la défaillance." };

  const montant = Number(formData.get("montant") ?? 0);
  if (
    resolution === "remboursement" &&
    (!Number.isFinite(montant) || montant <= 0)
  ) {
    return { erreur: "Indiquer le montant remboursé au client." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("declarer_sav", {
    p_vente_id: venteId,
    p_produit_id: produitId,
    p_quantite: Math.trunc(quantite),
    p_resolution: resolution,
    p_motif: motif,
    p_montant: resolution === "remboursement" ? montant : 0,
  });

  if (error) return { erreur: error.message };

  revalidatePath("/vendeur", "layout");
  return {
    succes:
      resolution === "echange"
        ? "Échange enregistré : l'unité est sortie de votre stock."
        : "Demande envoyée au gérant. Votre dette ne bougera qu'après sa validation.",
    jeton: crypto.randomUUID(),
  };
}

/**
 * Marquer les SAV comme consultés — c'est ce qui éteint la pastille.
 *
 * Appelée depuis un effet de montage, pas pendant le rendu de la page : la
 * route est `force-dynamic` et le projet n'a aucun `loading.tsx`, donc un
 * préchargement de lien peut faire rendre la page côté serveur sans que le
 * vendeur l'ait vue. Éteindre la pastille là serait éteindre une information
 * qu'il n'a jamais reçue.
 *
 * `borne` est l'horodatage du dossier le plus récent AFFICHÉ, enregistré à la
 * place de `now()` : un arbitrage rendu entre le rendu et cet appel resterait
 * sinon marqué vu sans l'avoir été (voir 0021).
 */
export async function marquerSavVu(borne: string | null): Promise<void> {
  await exigerProfil();

  const supabase = await creerClient();
  await supabase.rpc("marquer_sav_vu", { p_vu_jusqu_a: borne });

  // Le compteur vit dans le layout : sans cette revalidation, la pastille
  // resterait allumée jusqu'à la navigation suivante.
  revalidatePath("/vendeur", "layout");
}

/** Retirer une demande de remboursement encore en attente. */
export async function retirerSav(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerProfil();

  const id = String(formData.get("sav_id") ?? "");
  if (!id) return { erreur: "Dossier introuvable." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("annuler_sav", { p_sav_id: id });

  if (error) return { erreur: error.message };

  revalidatePath("/vendeur", "layout");
  return { succes: "Demande retirée.", jeton: crypto.randomUUID() };
}

/**
 * Corriger une vente récente.
 *
 * La fenêtre (48 h) et l'appartenance sont contrôlées EN SQL par
 * droit_correction() : ce n'est pas cette action qui protège quoi que ce soit.
 * Avancer l'horloge de son téléphone n'ouvre donc rien.
 */
export async function modifierVente(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerProfil();

  const venteId = String(formData.get("vente_id") ?? "");
  if (!venteId) return { erreur: "Vente introuvable." };

  const lignes = lireLignesVente(formData);
  if (lignes.length === 0) {
    return {
      erreur:
        "Une vente doit garder au moins un produit. Pour la supprimer entièrement, utiliser l'annulation.",
    };
  }

  const client = String(formData.get("client") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();

  const supabase = await creerClient();
  const { error } = await supabase.rpc("modifier_vente", {
    p_vente_id: venteId,
    p_lignes: lignes,
    p_client: client || null,
    ...(date ? { p_date: date } : {}),
  });

  if (error) return { erreur: error.message };

  const total = lignes.reduce(
    (s, l) => s + l.quantite * l.prix_vente_unitaire,
    0,
  );
  revalidatePath("/vendeur", "layout");
  return {
    succes: `Vente corrigée : ${euros(total)}.`,
    jeton: crypto.randomUUID(),
  };
}

/** Annuler une de ses ventes récentes. Mêmes gardes SQL que la modification. */
export async function annulerMaVente(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerProfil();

  const venteId = String(formData.get("vente_id") ?? "");
  if (!venteId) return { erreur: "Vente introuvable." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("supprimer_vente", {
    p_vente_id: venteId,
  });

  if (error) return { erreur: error.message };

  revalidatePath("/vendeur", "layout");
  return {
    succes: "Vente annulée, stock remis dans le vôtre.",
    jeton: crypto.randomUUID(),
  };
}
