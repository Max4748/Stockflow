"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { exigerAdmin, exigerDev } from "@/lib/auth";
import { clientAdmin } from "@/lib/supabase/admin";
import { creerClient } from "@/lib/supabase/server";
import type { EtatAction, EtatActionSecret } from "@/lib/types";

/**
 * Server Actions de l'espace administrateur.
 *
 * CHAQUE action commence par exigerAdmin(). Le layout ne suffit pas : une
 * Server Action est une URL, et rien n'oblige un appelant à passer par
 * l'interface. La RLS reste la dernière barrière, mais une garde applicative
 * donne un message clair plutôt qu'un résultat vide.
 *
 * Aucun calcul métier ici. Coûts, marges, dettes et contrôles de stock sont
 * faits en SQL — voir les migrations 0005 à 0008.
 */

function rafraichir() {
  revalidatePath("/gestion", "layout");
  // L'espace vendeur voit aussi les effets : un transfert change son stock,
  // un versement change sa dette.
  revalidatePath("/vendeur", "layout");
}

function jeton() {
  return crypto.randomUUID();
}

/** Lit des paires produit/quantité d'un formulaire à champs répétés. */
function lireLignes(
  formData: FormData,
  champQuantite = "quantite",
): { produit_id: string; quantite: number }[] {
  const produits = formData.getAll("produit_id").map(String);
  const quantites = formData.getAll(champQuantite).map(String);

  const lignes: { produit_id: string; quantite: number }[] = [];
  for (let i = 0; i < produits.length; i++) {
    const q = Number(quantites[i]);
    if (!produits[i] || !Number.isFinite(q) || q <= 0) continue;
    lignes.push({ produit_id: produits[i], quantite: Math.trunc(q) });
  }
  return lignes;
}

// ---------------------------------------------------------------------------
// Demandes de réassort
// ---------------------------------------------------------------------------

export async function traiterDemande(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const demandeId = String(formData.get("demande_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const motif = String(formData.get("motif") ?? "").trim();

  if (!demandeId) return { erreur: "Demande introuvable." };
  if (decision !== "approuver" && decision !== "refuser") {
    return { erreur: "Décision invalide." };
  }

  // On transmet toujours les quantités saisies, jamais `null` : l'interface
  // pré-remplit chaque champ au minimum entre demandé et disponible, donc la
  // valeur par défaut est déjà celle qui passera le contrôle de stock. Passer
  // `null` (« accorde tout ce qui est demandé ») risquerait un refus SQL sur
  // une ligne que l'entrepôt ne couvre pas.
  const lignes =
    decision === "approuver" ? lireLignes(formData, "accordee") : [];

  const supabase = await creerClient();
  const { data, error } = await supabase.rpc("traiter_demande_restock", {
    p_demande_id: demandeId,
    p_decision: decision,
    p_lignes_accordees: decision === "approuver" ? lignes : null,
    p_motif: motif || null,
  });

  if (error) {
    // Messages déjà rédigés pour un humain, y compris « Demande déjà traitée
    // (statut : partielle). » quand deux onglets envoient la requête. On les
    // affiche tels quels et on rafraîchit pour montrer l'état réel.
    rafraichir();
    return { erreur: error.message };
  }

  rafraichir();
  const statut = String(data ?? "");
  const libelles: Record<string, string> = {
    approuvee: "Demande approuvée en totalité.",
    partielle: "Demande approuvée partiellement.",
    refusee: "Demande refusée.",
  };
  return { succes: libelles[statut] ?? "Demande traitée.", jeton: jeton() };
}

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------

export async function enregistrerProduit(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("id") ?? "");
  const nom = String(formData.get("nom") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const prix = Number(formData.get("prix_vente_conseille"));
  const seuil = Number(formData.get("seuil_alerte"));
  const actif = formData.get("actif") === "1";

  if (!nom) return { erreur: "Le nom du produit est obligatoire." };
  if (!Number.isFinite(prix) || prix < 0) return { erreur: "Prix invalide." };
  if (!Number.isFinite(seuil) || seuil < 0)
    return { erreur: "Seuil invalide." };

  const supabase = await creerClient();
  const valeurs = {
    nom,
    sku: sku || null,
    prix_vente_conseille: prix,
    seuil_alerte: Math.trunc(seuil),
    actif,
  };

  const { error } = id
    ? await supabase.from("produits").update(valeurs).eq("id", id)
    : await supabase.from("produits").insert(valeurs);

  if (error) {
    // L'unicité est insensible à la casse (index sur lower(nom)) :
    // « Produit A » et « produit a » sont le même produit, et deux jumeaux
    // fausseraient durablement le coût moyen pondéré.
    if (error.code === "23505") {
      return { erreur: "Un produit porte déjà ce nom ou ce SKU." };
    }
    return { erreur: error.message };
  }

  rafraichir();
  return {
    succes: id ? "Produit modifié." : "Produit créé.",
    jeton: jeton(),
  };
}

// ---------------------------------------------------------------------------
// Achats fournisseur
// ---------------------------------------------------------------------------

export async function enregistrerAchat(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const lignes = lireLignes(formData);
  if (lignes.length === 0) {
    return { erreur: "Indiquer au moins un produit et une quantité." };
  }

  const prixBase = Number(formData.get("prix_base"));
  const fraisPort = Number(formData.get("frais_port") ?? 0);
  const reference = String(formData.get("reference") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();

  if (!Number.isFinite(prixBase) || prixBase < 0) {
    return { erreur: "Montant de la commande invalide." };
  }
  if (!Number.isFinite(fraisPort) || fraisPort < 0) {
    return { erreur: "Frais de port invalides." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("creer_restock_fournisseur", {
    p_lignes: lignes,
    p_prix_base: prixBase,
    p_frais_port: fraisPort,
    p_reference: reference || null,
    ...(date ? { p_date: date } : {}),
  });

  if (error) return { erreur: error.message };

  rafraichir();
  const unites = lignes.reduce((s, l) => s + l.quantite, 0);
  return {
    succes: `Achat enregistré : ${unites} unité(s) entrées en entrepôt.`,
    jeton: jeton(),
  };
}

// ---------------------------------------------------------------------------
// Stock : ajustements et retours
// ---------------------------------------------------------------------------

export async function ajusterStock(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const produitId = String(formData.get("produit_id") ?? "");
  const delta = Number(formData.get("delta"));
  const motif = String(formData.get("motif") ?? "").trim();
  const detenteurId = String(formData.get("detenteur_id") ?? "");

  if (!produitId) return { erreur: "Produit non précisé." };
  if (!Number.isFinite(delta) || delta === 0) {
    return { erreur: "Indiquer un écart non nul (négatif pour une perte)." };
  }
  if (!motif) {
    // Le motif est aussi exigé par un CHECK en base : un écart sans
    // explication devient inexplicable six mois plus tard.
    return { erreur: "Le motif est obligatoire pour un ajustement." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("ajuster_stock", {
    p_produit_id: produitId,
    p_delta: Math.trunc(delta),
    p_motif: motif,
    // Chaîne vide = entrepôt (detenteur_id NULL en base).
    p_detenteur_id: detenteurId || null,
  });

  if (error) return { erreur: error.message };

  rafraichir();
  return { succes: "Stock ajusté.", jeton: jeton() };
}

/**
 * Distribuer du stock de l'entrepôt vers un compte, sans demande préalable.
 *
 * Le détenteur n'est pas forcément un vendeur : un gérant qui vend sur le
 * terrain a besoin de stock comme les autres. C'est la fonction SQL qui
 * contrôle que le compte existe et qu'il est actif.
 */
export async function transfererStock(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const detenteurId = String(formData.get("detenteur_id") ?? "");
  const lignes = lireLignes(formData);
  const motif = String(formData.get("motif") ?? "").trim();

  if (!detenteurId) return { erreur: "Destinataire non précisé." };
  if (lignes.length === 0) {
    return { erreur: "Indiquer au moins un produit et une quantité." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("transferer_stock", {
    p_detenteur_id: detenteurId,
    p_lignes: lignes,
    p_motif: motif || null,
  });

  if (error) return { erreur: error.message };

  rafraichir();
  const unites = lignes.reduce((s, l) => s + l.quantite, 0);
  return {
    succes: `${unites} unité(s) distribuées depuis l'entrepôt.`,
    jeton: jeton(),
  };
}

export async function retournerStock(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const vendeurId = String(formData.get("vendeur_id") ?? "");
  const lignes = lireLignes(formData);
  const motif = String(formData.get("motif") ?? "").trim();

  if (!vendeurId) return { erreur: "Vendeur non précisé." };
  if (lignes.length === 0) {
    return { erreur: "Indiquer au moins un produit et une quantité." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("retourner_stock", {
    p_vendeur_id: vendeurId,
    p_lignes: lignes,
    p_motif: motif || null,
  });

  if (error) return { erreur: error.message };

  rafraichir();
  const unites = lignes.reduce((s, l) => s + l.quantite, 0);
  return {
    succes: `${unites} unité(s) reprises en entrepôt.`,
    jeton: jeton(),
  };
}

// ---------------------------------------------------------------------------
// Service après-vente
// ---------------------------------------------------------------------------

/**
 * Déclarer une défaillance sur une vente.
 *
 * Le formulaire envoie un couple vente/produit sous la forme « id|id » : c'est
 * un SEUL choix pour le gérant (« la vente à un client du 3, un Produit A »),
 * et le découper ici évite deux listes déroulantes à tenir cohérentes entre
 * elles.
 *
 * Aucun contrôle comptable ici : le plafond des unités, celui du remboursement
 * et le stock disponible pour l'échange sont vérifiés par declarer_sav().
 */
export async function declarerSav(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

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
    p_depuis_entrepot: formData.get("depuis_entrepot") === "on",
  });

  if (error) return { erreur: error.message };

  rafraichir();
  return {
    succes:
      resolution === "echange"
        ? "SAV enregistré : unité de remplacement sortie du stock."
        : "SAV enregistré : la dette du vendeur baisse d'autant.",
    jeton: jeton(),
  };
}

export async function annulerSav(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("sav_id") ?? "");
  if (!id) return { erreur: "Dossier SAV introuvable." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("supprimer_sav", { p_sav_id: id });

  if (error) return { erreur: error.message };

  rafraichir();
  return {
    succes: "SAV supprimé. L'unité échangée, s'il y en avait une, est revenue.",
    jeton: jeton(),
  };
}

/**
 * Révoquer un dossier DÉJÀ VALIDÉ, en le conservant.
 *
 * À distinguer de `annulerSav`, qui supprime : la suppression convient à une
 * saisie franchement erronée, pas à un dossier qu'on estime abusif. Ce qui
 * caractérise un abus est un motif RÉPÉTÉ ; effacer chaque dossier au fur et à
 * mesure effacerait précisément ce qui le rendrait visible.
 *
 * Le motif est exigé ici comme en base : révoquer après coup un dossier sur
 * lequel le vendeur comptait demande de s'expliquer, et c'est cette trace qui
 * s'accumule.
 */
export async function revoquerSav(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("sav_id") ?? "");
  if (!id) return { erreur: "Dossier SAV introuvable." };

  const motif = String(formData.get("motif") ?? "").trim();
  if (!motif) {
    return { erreur: "Indiquer pourquoi ce dossier est révoqué." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("revoquer_sav", {
    p_sav_id: id,
    p_motif: motif,
  });

  if (error) return { erreur: error.message };

  rafraichir();
  return {
    succes:
      "Dossier révoqué. Il reste visible, avec son motif, et le vendeur le voit.",
    jeton: jeton(),
  };
}

/**
 * Marquer les dossiers comme consultés côté gestion — éteint la pastille.
 *
 * Même motif que `marquerSavVu` de l'espace vendeur : appelée depuis un effet
 * de montage et non pendant le rendu, parce qu'un préchargement de lien peut
 * faire rendre la page sans que le gérant l'ait vue. Éteindre la pastille là
 * éteindrait une information qu'il n'a jamais reçue.
 *
 * `borne` est l'horodatage du dossier le plus récent AFFICHÉ. C'est lui qui
 * est enregistré, et non `now()` : entre le rendu et cet appel, un vendeur a
 * pu déclarer un dossier que le gérant n'a jamais vu passer (voir 0021). La
 * valeur vient du navigateur — la fonction SQL la borne des deux côtés.
 */
export async function marquerSavGestionVu(borne: string | null): Promise<void> {
  await exigerAdmin();

  const supabase = await creerClient();
  await supabase.rpc("marquer_sav_gestion_vu", { p_vu_jusqu_a: borne });

  revalidatePath("/gestion", "layout");
}

/**
 * Arbitrer un remboursement demandé par un vendeur.
 *
 * Le sens de la décision vient d'un champ caché du formulaire, pas d'une action
 * paramétrée : deux boutons distincts dans la même page, une seule action.
 * C'est le SQL qui refuse un dossier déjà traité, y compris sur double-clic.
 */
export async function arbitrerSav(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("sav_id") ?? "");
  if (!id) return { erreur: "Dossier SAV introuvable." };

  const decision = String(formData.get("decision") ?? "");
  if (decision !== "valider" && decision !== "refuser") {
    return { erreur: "Décision invalide." };
  }

  const supabase = await creerClient();
  const { error } =
    decision === "valider"
      ? await supabase.rpc("valider_sav", { p_sav_id: id })
      : await supabase.rpc("refuser_sav", {
          p_sav_id: id,
          p_motif: String(formData.get("motif") ?? "").trim() || null,
        });

  if (error) {
    // Le message couvre « Dossier déjà traité » quand deux onglets envoient la
    // requête : on l'affiche et on rafraîchit pour montrer l'état réel.
    rafraichir();
    return { erreur: error.message };
  }

  rafraichir();
  return {
    succes:
      decision === "valider"
        ? "Remboursement validé : la dette du vendeur baisse d'autant."
        : "Demande refusée. Le vendeur voit le motif.",
    jeton: jeton(),
  };
}

// ---------------------------------------------------------------------------
// Créances
// ---------------------------------------------------------------------------

export async function encaisserVersement(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const vendeurId = String(formData.get("vendeur_id") ?? "");
  const montant = Number(formData.get("montant"));
  const date = String(formData.get("date") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const excedent = formData.get("autoriser_excedent") === "1";

  if (!vendeurId) return { erreur: "Vendeur non précisé." };
  if (!Number.isFinite(montant) || montant <= 0) {
    return { erreur: "Le montant doit être strictement positif." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("enregistrer_versement", {
    p_vendeur_id: vendeurId,
    p_montant: montant,
    p_note: note || null,
    p_autoriser_excedent: excedent,
    ...(date ? { p_date: date } : {}),
  });

  // La borne anti-surversement est en SQL, pas seulement ici : un admin
  // passant par PostgREST se heurterait à la même limite.
  if (error) return { erreur: error.message };

  rafraichir();
  return { succes: "Versement enregistré.", jeton: jeton() };
}

export async function supprimerVersement(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("versement_id") ?? "");
  if (!id) return { erreur: "Versement introuvable." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("supprimer_versement", {
    p_versement_id: id,
  });
  if (error) return { erreur: error.message };

  rafraichir();
  return { succes: "Versement supprimé.", jeton: jeton() };
}

// ---------------------------------------------------------------------------
// Comptabilité
// ---------------------------------------------------------------------------

export async function annulerVente(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("vente_id") ?? "");
  if (!id) return { erreur: "Vente introuvable." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("supprimer_vente", { p_vente_id: id });

  if (error) {
    // Refus attendu quand des ventes postérieures ont figé un coût qui dépend
    // de celle-ci : ce n'est pas une panne, le message oriente vers un
    // ajustement de stock motivé.
    return { erreur: error.message };
  }

  rafraichir();
  return {
    succes: "Vente annulée, stock restitué au vendeur.",
    jeton: jeton(),
  };
}

// ---------------------------------------------------------------------------
// Comptes vendeurs
// ---------------------------------------------------------------------------

/**
 * Mot de passe provisoire lisible mais imprévisible. Aucun SMTP n'est
 * configuré sur cette machine : il est affiché une fois à l'écran, jamais
 * envoyé ni stocké. Perdu = réinitialisé.
 */
function motDePasseProvisoire(): string {
  return randomBytes(9).toString("base64url");
}

export async function creerVendeur(
  _etat: EtatActionSecret,
  formData: FormData,
): Promise<EtatActionSecret> {
  await exigerAdmin();

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const nom = String(formData.get("nom") ?? "").trim();
  const commission = Number(formData.get("commission_unitaire") ?? 0);
  // Le rôle vient du formulaire, mais c'est le SQL qui décide : inviter_utilisateur
  // refuse tout niveau supérieur ou égal à celui de l'appelant. Un gérant qui
  // trafiquerait ce champ pour demander « dev » serait rejeté en base.
  const role = String(formData.get("role") ?? "vendeur");

  if (!email || !email.includes("@"))
    return { erreur: "Adresse e-mail invalide." };
  if (!nom) return { erreur: "Le nom est obligatoire." };
  if (!Number.isFinite(commission) || commission < 0) {
    return { erreur: "Commission invalide." };
  }

  const supabase = await creerClient();

  // ÉTAPE 1 — l'invitation, via RPC : l'écriture directe dans `invitations` est
  // révoquée depuis 0011, précisément parce que sa colonne `role` était
  // librement insérable — donc une escalade de privilèges en une requête.
  const { error: erreurInvitation } = await supabase.rpc(
    "inviter_utilisateur",
    {
      p_email: email,
      p_nom: nom,
      p_role: role,
      p_commission: commission,
    },
  );

  if (erreurInvitation) return { erreur: erreurInvitation.message };

  // ÉTAPE 2 — le compte. clientAdmin() porte la clé service_role : c'est le
  // SEUL usage légitime, `auth.admin.*` n'étant pas accessible autrement.
  const motDePasse = motDePasseProvisoire();
  const { error: erreurCompte } = await clientAdmin().auth.admin.createUser({
    email,
    password: motDePasse,
    email_confirm: true,
  });

  if (erreurCompte) {
    // Les deux étapes ne sont PAS atomiques. L'invitation subsiste, inoffensive
    // (`utilisee = false`, réutilisable) — mais il faut le dire plutôt que
    // d'annoncer un succès trompeur.
    return {
      erreur:
        `Compte non créé : ${erreurCompte.message}. ` +
        `L'invitation pour ${email} a été enregistrée et sera réutilisée au prochain essai.`,
    };
  }

  rafraichir();
  return {
    succes: `Compte créé pour ${nom}.`,
    email,
    motDePasse,
    jeton: jeton(),
  };
}

export async function reinitialiserMotDePasse(
  _etat: EtatActionSecret,
  formData: FormData,
): Promise<EtatActionSecret> {
  await exigerAdmin();

  const vendeurId = String(formData.get("vendeur_id") ?? "");
  if (!vendeurId) return { erreur: "Vendeur introuvable." };

  const motDePasse = motDePasseProvisoire();
  const { error } = await clientAdmin().auth.admin.updateUserById(vendeurId, {
    password: motDePasse,
  });
  if (error) return { erreur: error.message };

  // Le drapeau force le vendeur à choisir son propre mot de passe à la
  // prochaine connexion — flux déjà en place côté vendeur. Via RPC : l'update
  // direct sur `profils` est révoqué depuis 0011.
  const supabase = await creerClient();
  const { error: erreurDrapeau } = await supabase.rpc("exiger_changement_mdp", {
    p_id: vendeurId,
  });
  if (erreurDrapeau) return { erreur: erreurDrapeau.message };

  rafraichir();
  return {
    succes: "Mot de passe réinitialisé.",
    motDePasse,
    jeton: jeton(),
  };
}

export async function modifierVendeur(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("vendeur_id") ?? "");
  const nom = String(formData.get("nom") ?? "").trim();
  const commission = Number(formData.get("commission_unitaire"));

  if (!id) return { erreur: "Vendeur introuvable." };
  if (!nom) return { erreur: "Le nom est obligatoire." };
  if (!Number.isFinite(commission) || commission < 0) {
    return { erreur: "Commission invalide." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("modifier_compte", {
    p_id: id,
    p_nom: nom,
    p_commission: commission,
  });

  if (error) return { erreur: error.message };

  rafraichir();
  return {
    // Le figeage comptable mérite d'être rappelé : sans ça le patron peut
    // craindre d'avoir réécrit l'historique en corrigeant une commission.
    succes:
      "Vendeur modifié. La nouvelle commission ne s'applique qu'aux ventes à venir.",
    jeton: jeton(),
  };
}

export async function basculerActivation(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerAdmin();

  const id = String(formData.get("vendeur_id") ?? "");
  const actif = formData.get("actif") === "1";
  if (!id) return { erreur: "Vendeur introuvable." };

  const supabase = await creerClient();
  const { error } = await supabase.rpc("changer_actif", {
    p_id: id,
    p_actif: actif,
  });

  if (error) return { erreur: error.message };

  rafraichir();
  return {
    // La suppression n'est pas proposée : `on delete restrict` la ferait
    // échouer dès qu'un vendeur a un historique comptable.
    succes: actif
      ? "Compte réactivé."
      : "Compte désactivé : plus aucun accès, historique conservé.",
    jeton: jeton(),
  };
}

// ---------------------------------------------------------------------------
// Comptes d'encadrement — réservé au propriétaire technique
// ---------------------------------------------------------------------------

/**
 * Promouvoir un vendeur en gérant, ou rétrograder un gérant.
 *
 * La garde applicative est exigerDev(), mais ce n'est PAS elle qui protège :
 * `changer_role` vérifie en base que l'ancien ET le nouveau rôle sont
 * strictement inférieurs au niveau de l'appelant. Un gérant appelant cette
 * action directement serait rejeté par le SQL même si la garde sautait.
 */
export async function changerRole(
  _etat: EtatAction,
  formData: FormData,
): Promise<EtatAction> {
  await exigerDev();

  const id = String(formData.get("compte_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!id) return { erreur: "Compte introuvable." };
  if (role !== "gerant" && role !== "vendeur") {
    return { erreur: "Rôle invalide." };
  }

  const supabase = await creerClient();
  const { error } = await supabase.rpc("changer_role", {
    p_id: id,
    p_role: role,
  });
  if (error) return { erreur: error.message };

  rafraichir();
  return {
    succes:
      role === "gerant"
        ? "Compte promu gérant : accès complet à la gestion."
        : "Compte rétrogradé vendeur.",
    jeton: jeton(),
  };
}
