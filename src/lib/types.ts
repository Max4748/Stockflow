/**
 * Types de la base, écrits à la main.
 *
 * Pas de `supabase gen types` : les retours de RPC exigent de toute façon un
 * cast côté TypeScript, et un fichier généré de plusieurs milliers de lignes
 * masquerait ce qui compte — la forme exacte de ce que chaque écran consomme.
 * La contrepartie est réelle : ces types doivent être mis à jour à la main si
 * une migration change une signature.
 */

/**
 * Hiérarchie stricte : dev (3) ⊃ gerant (2) ⊃ vendeur (1).
 * `admin` n'existe plus — l'ancien sommet est devenu `gerant`, et `dev` s'est
 * ajouté au-dessus (migration 0000).
 */
export type RoleUtilisateur = "dev" | "gerant" | "vendeur";

export const NIVEAUX: Record<RoleUtilisateur, number> = {
  dev: 3,
  gerant: 2,
  vendeur: 1,
};

/** Gérant ou au-dessus. Pendant exact de est_admin() en SQL. */
export function estEncadrement(role: RoleUtilisateur): boolean {
  return NIVEAUX[role] >= 2;
}

export type StatutDemande =
  "en_attente" | "approuvee" | "partielle" | "refusee" | "annulee";

export type Profil = {
  id: string;
  nom: string;
  role: RoleUtilisateur;
  commission_unitaire: number;
  actif: boolean;
  doit_changer_mdp: boolean;
  /**
   * Dernière ouverture de l'écran SAV. Sert UNIQUEMENT à la pastille de
   * nouveauté — jamais à une décision d'autorisation.
   */
  sav_vu_le: string | null;
  cree_le: string;
};

export type Produit = {
  id: string;
  nom: string;
  sku: string | null;
  prix_vente_conseille: number;
  seuil_alerte: number;
  actif: boolean;
};

/** rpc('stock_disponible') — stock du vendeur connecté, sans aucun coût. */
export type LigneStock = {
  produit_id: string;
  produit: string;
  quantite: number;
  seuil_alerte: number;
};

/** rpc('stock_entrepot') — quantités de l'entrepôt, sans valorisation. */
export type LigneStockEntrepot = {
  produit_id: string;
  produit: string;
  quantite: number;
};

/** rpc('ma_dette') — renvoie UNE ligne. */
export type MaDette = {
  ca: number;
  commissions: number;
  verse: number;
  /** Remboursements SAV sortis de sa poche : ils diminuent sa dette. */
  rembourse: number;
  reste_a_verser: number;
  nb_ventes: number;
  qte_vendue: number;
};

/** rpc('mon_journal') */
export type LigneJournalVendeur = {
  horodatage: string;
  type: "vente" | "reception" | "versement";
  libelle: string;
  quantite: number | null;
  montant: number | null;
};

export type Vente = {
  id: string;
  date: string;
  vendeur_id: string;
  client: string;
  quantite_totale: number;
  montant_total: number;
  cree_le: string;
};

export type DemandeLigne = {
  id: string;
  demande_id: string;
  produit_id: string;
  quantite_demandee: number;
  quantite_accordee: number;
};

export type DemandeRestock = {
  id: string;
  vendeur_id: string;
  statut: StatutDemande;
  note: string | null;
  motif_refus: string | null;
  cree_le: string;
  traitee_le: string | null;
  demande_lignes: (DemandeLigne & { produits: { nom: string } | null })[];
};

/** Ligne envoyée à rpc('enregistrer_vente'). */
export type LigneVenteSaisie = {
  produit_id: string;
  quantite: number;
  prix_vente_unitaire: number;
};

/**
 * État de retour commun à toutes les Server Actions.
 *
 * `jeton` est un identifiant unique par succès. Il sert de `key` React pour
 * remonter le formulaire et réinitialiser son état — sans quoi il faudrait
 * appeler setState dans un useEffect, ce qui déclenche des renders en cascade.
 * Un même message de succès répété doit produire deux jetons distincts, sinon
 * la seconde saisie ne serait pas remise à zéro.
 */
export type EtatAction = {
  erreur?: string;
  succes?: string;
  jeton?: string;
};

// ---------------------------------------------------------------------------
// Retours des RPC d'administration. Colonnes calquées sur les migrations
// 0007_dette.sql et 0008_lectures.sql — les vérifier là-bas avant de modifier.
// ---------------------------------------------------------------------------

/** rpc('bilan_global') — renvoie UNE ligne. */
export type BilanGlobal = {
  ca: number;
  nb_ventes: number;
  qte_vendue: number;
  cout_marchandises: number;
  commissions: number;
  marge_nette: number;
  montant_a_recuperer: number;
  valeur_stock: number;
  achats_total: number;
};

/**
 * rpc('revenus_vendeurs')
 *
 * `role` depuis 0013 : un compte d'encadrement qui a vendu sur la période y
 * figure, puisque son chiffre d'affaires compte déjà dans le bilan global.
 */
export type RevenuVendeur = {
  vendeur_id: string;
  nom: string;
  role: RoleUtilisateur;
  actif: boolean;
  nb_ventes: number;
  qte_vendue: number;
  /** Net des remboursements SAV de la période. */
  ca: number;
  commissions: number;
  /** Net des remboursements ET du coût des unités échangées. */
  marge_nette: number;
  sav_unites: number;
};

/**
 * rpc('creances')
 *
 * `role` depuis 0013 : un gérant qui vend apparaît dans la liste, avec un
 * `reste_a_verser` toujours nul — il ne se doit rien à lui-même.
 */
export type Creance = {
  vendeur_id: string;
  nom: string;
  role: RoleUtilisateur;
  actif: boolean;
  ca: number;
  commissions: number;
  verse: number;
  /** Ce qu'il a remboursé à des clients au titre du SAV, de sa poche. */
  rembourse: number;
  reste_a_verser: number;
  nb_ventes: number;
};

/**
 * rpc('totaux_stock') — renvoie UNE ligne.
 *
 * Existe pour que l'écran Stock et le Bilan affichent la MÊME valeur : sommer
 * en TypeScript des montants déjà arrondis au centime les faisait diverger.
 */
export type TotauxStock = {
  entrepot: number;
  distribue: number;
  total: number;
  valeur: number;
};

/** rpc('stock_valorise') — porte le COÛT : admin uniquement. */
export type StockValorise = {
  produit_id: string;
  produit: string;
  actif: boolean;
  seuil_alerte: number;
  stock_entrepot: number;
  stock_distribue: number;
  stock_total: number;
  cout_unitaire: number;
  valeur_totale: number;
};

/** rpc('stock_detenteurs') — detenteur_id null = entrepôt. */
export type StockDetenteur = {
  detenteur_id: string | null;
  detenteur: string;
  produit_id: string;
  produit: string;
  quantite: number;
  valeur: number;
};

/** rpc('journal_transactions') */
export type LigneJournal = {
  horodatage: string;
  date_compta: string;
  type: string;
  libelle: string | null;
  vendeur: string | null;
  quantite: number | null;
  montant: number | null;
  reference: string;
};

/** rpc('verifier_coherence_stock') */
export type Anomalie = {
  anomalie: string;
  detail: string;
};

export type Restock = {
  id: string;
  date: string;
  reference: string | null;
  quantite_totale: number;
  prix_achat_base: number;
  frais_port: number;
  prix_achat_unitaire: number;
  cree_le: string;
};

export type Invitation = {
  email: string;
  nom: string;
  role: RoleUtilisateur;
  commission_unitaire: number;
  utilisee: boolean;
  cree_le: string;
};

/**
 * Retour d'une action qui produit un secret à montrer UNE seule fois (mot de
 * passe provisoire). Il n'est jamais stocké : s'il est perdu, on réinitialise.
 */
export type EtatActionSecret = EtatAction & {
  motDePasse?: string;
  email?: string;
};

/**
 * rpc('mes_ventes') — les ventes du vendeur connecté.
 *
 * `corrigeable` est calculé EN SQL : le laisser au client laisserait croire
 * qu'avancer l'horloge du téléphone rouvre la fenêtre de correction.
 */
export type MaVente = {
  id: string;
  date: string;
  client: string;
  quantite_totale: number;
  montant_total: number;
  cree_le: string;
  corrigeable: boolean;
  /**
   * `sav_unites` compte le validé ET l'en-attente — le badge répond à « cette
   * vente a-t-elle posé problème ? ». `sav_rembourse` ne compte que le validé :
   * c'est le seul argent réellement sorti.
   */
  sav_unites: number;
  sav_rembourse: number;
  sav_en_attente: number;
};

/** rpc('ventes_vendeur') — les ventes d'un vendeur vues par l'encadrement. */
export type VenteVendeur = {
  id: string;
  date: string;
  client: string;
  quantite_totale: number;
  montant_total: number;
  cree_le: string;
  sav_unites: number;
  sav_rembourse: number;
  sav_en_attente: number;
};

/**
 * rpc('ventes_savables') — une ligne par couple vente/produit encore
 * couvrable, avec ce qu'il reste possible de passer en SAV.
 */
export type VenteSavable = {
  vente_id: string;
  date: string;
  /**
   * Heure de saisie. Seule information qui distingue deux ventes du même jour
   * au même client pour le même produit — sans elle, la liste de choix affiche
   * des lignes identiques.
   */
  cree_le: string;
  client: string;
  vendeur: string;
  vendeur_id: string;
  produit_id: string;
  produit: string;
  quantite: number;
  deja_en_sav: number;
  restant: number;
  prix_unitaire: number;
};

export type StatutSav = "valide" | "en_attente" | "refuse" | "annule";

export type ResolutionSav = "echange" | "remboursement";

/**
 * rpc('dossiers_sav') — un dossier de SAV, tel que l'écran de gestion et le
 * vendeur le voient. Le filtrage par vendeur est fait EN SQL.
 *
 * Rappel du régime (migration 0015) : un échange déclaré par un vendeur est
 * `valide` d'emblée — il a déjà remis l'unité — tandis qu'un remboursement
 * reste `en_attente` jusqu'à l'arbitrage du gérant.
 */
export type DossierSav = {
  id: string;
  vente_id: string;
  date: string;
  statut: StatutSav;
  resolution: ResolutionSav;
  quantite: number;
  montant_rembourse: number;
  motif: string;
  motif_refus: string | null;
  produit: string;
  client: string;
  vendeur: string;
  vendeur_id: string;
  declare_par: string;
  /** Qui a tranché, et quand. `null` tant que le dossier est en attente. */
  traite_par: string | null;
  traite_le: string | null;
  cree_le: string;
};

/** Une ligne d'une vente existante, pour pré-remplir le formulaire d'édition. */
export type LigneVenteExistante = {
  produit_id: string;
  quantite: number;
  prix_vente_unitaire: number;
};

/**
 * Horodatage du dossier le plus récent d'une liste — la borne de ce que
 * l'écran a réellement affiché.
 *
 * C'est ce que les deux pastilles SAV enregistrent comme « vu jusqu'à », à la
 * place de l'heure du clic : entre le rendu de la page et l'appel de marquage,
 * un dossier peut arriver, et il doit rester non vu (voir la migration 0021).
 *
 * `traite_le` d'abord, `cree_le` en repli : c'est l'ordre qu'emploient
 * `sav_non_vus()` et `sav_gestion_non_vus()` pour dater un dossier, et les
 * deux doivent comparer la même chose.
 */
export function borneVue(dossiers: DossierSav[]): string | null {
  let max: string | null = null;
  for (const d of dossiers) {
    const t = d.traite_le ?? d.cree_le;
    if (max === null || Date.parse(t) > Date.parse(max)) max = t;
  }
  return max;
}
