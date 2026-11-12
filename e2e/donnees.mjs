/**
 * Jeu de données du faux Supabase (voir `faux-supabase.mjs`).
 *
 * Tout est DÉTERMINISTE et daté par rapport à aujourd'hui : les filtres de
 * période (« 30 derniers jours », « mois en cours ») trouvent toujours de quoi
 * afficher, et deux exécutions donnent les mêmes écrans. Aucun tirage au sort.
 *
 * Les volumes sont choisis pour ce que les tests vérifient : assez de ventes
 * et de restocks pour remplir plusieurs pages, un client au nom piégeux pour
 * la recherche et pour l'export CSV.
 */

const JOUR = 86_400_000;
const AUJOURDHUI = Date.UTC(
  new Date().getUTCFullYear(),
  new Date().getUTCMonth(),
  new Date().getUTCDate(),
);
/** Date `AAAA-MM-JJ` d'il y a `n` jours. */
export const ilYA = (n) => new Date(AUJOURDHUI - n * JOUR).toISOString().slice(0, 10);
const heure = (n, h = 10) => `${ilYA(n)}T${String(h).padStart(2, "0")}:24:00Z`;
const uuid = (prefixe, n) =>
  `${prefixe}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const GERANT = uuid("a", 1);
export const VENDEUR = uuid("b", 1);
const VENDEUR_2 = uuid("b", 2);
const VENDEUR_3 = uuid("b", 3);

export const profils = [
  { id: GERANT, nom: "Camille Durand", email: "camille@exemple.fr", role: "gerant", actif: true, doit_changer_mdp: false, commission_unitaire: 0, stock_lie_entrepot: true, cree_le: heure(300) },
  { id: VENDEUR, nom: "Yanis Morel", email: "yanis@exemple.fr", role: "vendeur", actif: true, doit_changer_mdp: false, commission_unitaire: 2, stock_lie_entrepot: false, cree_le: heure(280) },
  { id: VENDEUR_2, nom: "Inès Laurent", email: "ines@exemple.fr", role: "vendeur", actif: true, doit_changer_mdp: false, commission_unitaire: 2, stock_lie_entrepot: false, cree_le: heure(250) },
  { id: VENDEUR_3, nom: "Hugo Petit", email: "hugo@exemple.fr", role: "vendeur", actif: false, doit_changer_mdp: false, commission_unitaire: 2, stock_lie_entrepot: false, cree_le: heure(200) },
];

const MODELES = [
  { id: uuid("c", 1), nom: "Brume 100 ml", prix: 20 },
  { id: uuid("c", 2), nom: "Bougie 180 g", prix: 24 },
  { id: uuid("c", 3), nom: "Diffuseur 200 ml", prix: 32 },
];
const PARFUMS = [
  ["Vanille", 0], ["Monoï", 0], ["Fleur d'oranger", 0],
  ["Ambre", 1], ["Cèdre", 1], ["Figue", 2],
].map(([nom, m], i) => ({ id: uuid("d", i + 1), nom, modele: MODELES[m] }));

const nomComplet = (p) => `${p.modele.nom.split(" ")[0]} ${p.nom}`;

const CLIENTS = ["Mme Roche", "M. Diallo", "Léa", "Client de passage", "100% coton", "=HYPERLINK(\"x\")", "Mme Nguyen", "Théo"];

// ---------- Ventes de Yanis : 57, soit trois pages de 20 ----------
const ventes = Array.from({ length: 57 }, (_, i) => {
  const unites = 1 + (i % 3);
  const sav = i === 1 ? 1 : 0;
  return {
    id: uuid("e", i + 1),
    date: ilYA(i),
    client: CLIENTS[i % CLIENTS.length],
    quantite_totale: unites,
    montant_total: unites * 20 + (i % 5) * 4,
    cree_le: heure(i, 9 + (i % 8)),
    // Fenêtre de correction : 48 h.
    corrigeable: i < 2,
    sav_unites: sav,
    sav_rembourse: 0,
    sav_en_attente: sav,
    annulee_le: i === 3 ? heure(2, 15) : null,
  };
});

// Deux lignes pour la dernière vente, dont une quantité supérieure au stock
// détenu : la reprise doit la borner et le dire.
const lignesVente = ventes.flatMap((v, i) =>
  (i === 0 ? [[0, 2], [4, 3]] : [[i % 2, v.quantite_totale]]).map(([p, quantite]) => ({
    vente_id: v.id, date: v.date, produit_id: PARFUMS[p].id, produit: nomComplet(PARFUMS[p]),
    quantite, prix_vente_unitaire: 20,
  })),
);

const versements = Array.from({ length: 14 }, (_, i) => ({
  id: uuid("f", i + 1),
  vendeur_id: VENDEUR,
  date: ilYA(4 + i * 9),
  montant: 80 + (i % 4) * 25,
  note: i % 3 === 0 ? "Remis en main propre" : null,
}));

const restocks = Array.from({ length: 26 }, (_, i) => {
  const unites = 40 + (i % 5) * 10;
  const base = unites * 7.5;
  const port = 12 + (i % 3) * 6;
  return {
    id: uuid("9", i + 1),
    date: ilYA(3 + i * 11),
    reference: i === 4 ? null : `CMD-${2026 - Math.floor(i / 20)}-${String(40 - i).padStart(3, "0")}`,
    quantite_totale: unites,
    prix_achat_base: base,
    frais_port: port,
    prix_achat_unitaire: Math.round(((base + port) / unites) * 10000) / 10000,
    cree_le: heure(3 + i * 11),
  };
});

// ---------- Chiffre d'affaires par jour, sur 120 jours ----------
const caParJour = [];
for (let k = 119; k >= 0; k--) {
  if (k % 6 === 5) continue; // des jours sans vente : la courbe doit retomber à zéro
  // Tendance à la hausse : la période récente bat la précédente.
  const base = 150 - k * 0.6 + 70 * Math.abs(Math.sin(k * 0.7)) + (k % 7 === 3 ? 110 : 0);
  caParJour.push({ jour: ilYA(k), ca: k === 9 ? -25 : Math.round(base * 100) / 100, nb_ventes: 1 + (k % 4) });
}
const dansPeriode = (jour, a) =>
  (!a.p_du || jour >= a.p_du) && (!a.p_au || jour <= a.p_au);

const revenus = [
  { vendeur_id: VENDEUR, nom: "Yanis Morel", role: "vendeur", actif: true, part: 0.43, sav_unites: 2 },
  { vendeur_id: VENDEUR_2, nom: "Inès Laurent", role: "vendeur", actif: true, part: 0.38, sav_unites: 0 },
  { vendeur_id: GERANT, nom: "Camille Durand", role: "gerant", actif: true, part: 0.19, sav_unites: 1 },
];
const partsProduits = [0.3, 0.22, 0.08, 0.2, 0.12, 0.08];
const stockEntrepot = [30, 4, 0, 41, 12, 60];
const stockVendeur = [12, 3, 0, 8, 1, 5];
const centime = (n) => Math.round(n * 100) / 100;

const creances = [
  { vendeur_id: VENDEUR, nom: "Yanis Morel", role: "vendeur", actif: true, ca: 2080, commissions: 208, verse: 1100, rembourse: 40, preleve: 0, reste_a_verser: 732, nb_ventes: 57 },
  { vendeur_id: VENDEUR_2, nom: "Inès Laurent", role: "vendeur", actif: true, ca: 1840, commissions: 184, verse: 1123, rembourse: 0, preleve: 0, reste_a_verser: 533, nb_ventes: 49 },
  { vendeur_id: VENDEUR_3, nom: "Hugo Petit", role: "vendeur", actif: false, ca: 300, commissions: 30, verse: 270, rembourse: 0, preleve: 0, reste_a_verser: 0, nb_ventes: 9 },
];

const journal = [
  ["vente", "Vente à Mme Roche · 863c6a12", "Yanis Morel", 2, 40],
  ["versement", "Versement reçu", "Yanis Morel", null, 300],
  ["achat", "Achat CMD-2026-040", null, 60, 480],
  ["sav", "SAV remboursement — Brume Monoï : flacon fêlé", "Inès Laurent", -1, 20],
  ["vente", "Vente à =HYPERLINK(\"x\") · 11aa22bb", "Inès Laurent", 1, 20],
  // Un libellé qui COMMENCE par « = » : l'export doit le neutraliser.
  ["versement", "=HYPERLINK(\"x\")", "Inès Laurent", null, 50],
].map(([type, libelle, vendeur, quantite, montant], i) => ({
  horodatage: heure(i, 10 + i), date_compta: ilYA(i), type, libelle, vendeur, quantite, montant,
  reference: ventes[i].id,
}));

const demandes = [
  { id: uuid("7", 1), vendeur_id: VENDEUR, statut: "approuvee", note: null, motif_refus: null, cree_le: heure(6), traitee_le: heure(6, 12), demande_lignes: [{ id: uuid("8", 1), quantite_demandee: 10, quantite_accordee: 10, produits: { nom: "Brume Monoï" } }] },
  { id: uuid("7", 2), vendeur_id: VENDEUR, statut: "partielle", note: null, motif_refus: null, cree_le: heure(20), traitee_le: heure(20, 12), demande_lignes: [{ id: uuid("8", 2), quantite_demandee: 12, quantite_accordee: 8, produits: { nom: "Brume Vanille" } }] },
  { id: uuid("7", 3), vendeur_id: VENDEUR, statut: "refusee", note: null, motif_refus: "Rupture fournisseur", cree_le: heure(40), traitee_le: heure(40, 12), demande_lignes: [{ id: uuid("8", 3), quantite_demandee: 4, quantite_accordee: 0, produits: { nom: "Diffuseur Figue" } }] },
];

/**
 * TABLES : lues par PostgREST avec filtres, tri et pagination, que le faux
 * serveur applique. `vues` : un rôle n'y voit pas forcément toutes les lignes.
 */
export const tables = {
  profils: () => profils,
  versements: () => versements,
  restocks: () => restocks,
  restock_lignes: () =>
    restocks.map((r, i) => ({ restock_id: r.id, produit_id: PARFUMS[i % 6].id, quantite: r.quantite_totale })),
  produits: () =>
    PARFUMS.map((p) => ({ id: p.id, modele_id: p.modele.id, nom: nomComplet(p), sku: null, actif: true, modeles: { nom: p.modele.nom, prix_vente_conseille: p.modele.prix, actif: true } })),
  modeles: () =>
    MODELES.map((m) => ({ id: m.id, nom: m.nom, prix_vente_conseille: m.prix, seuil_parfum: 5, seuil_modele: 10, actif: true })),
  demandes_restock: () => demandes,
  v_lignes_vente: () => lignesVente,
  invitations: () => [],
};

/**
 * FONCTIONS de lecture : `(arguments, identifiant de l'appelant) → résultat`.
 * Un tableau est ensuite filtré, trié et paginé comme une table ; une valeur
 * simple est renvoyée telle quelle. Une fonction absente d'ici est une
 * ÉCRITURE : le faux serveur l'accepte sans rien modifier.
 */
export const fonctions = {
  bilan_global: (a) => {
    const jours = caParJour.filter((p) => dansPeriode(p.jour, a));
    const ca = centime(jours.reduce((s, p) => s + p.ca, 0));
    const ventes = jours.reduce((s, p) => s + p.nb_ventes, 0);
    return [{
      ca, nb_ventes: ventes, qte_vendue: Math.round(ventes * 1.8),
      cout_marchandises: centime(ca * 0.4), commissions: centime(ca * 0.1),
      marge_nette: centime(ca * 0.5),
      // Des soldes : ils ne dépendent pas de la période.
      montant_a_recuperer: 1265, valeur_stock: 3120.4,
      achats_total: centime(restocks.filter((r) => dansPeriode(r.date, a)).reduce((s, r) => s + r.prix_achat_base + r.frais_port, 0)),
    }];
  },
  ca_par_jour: (a) => caParJour.filter((p) => dansPeriode(p.jour, a)),
  revenus_vendeurs: (a) => {
    const ca = fonctions.bilan_global(a)[0].ca;
    return revenus.map(({ part, ...r }) => ({
      ...r, nb_ventes: Math.round(part * 130), qte_vendue: Math.round(part * 240),
      ca: centime(ca * part), commissions: r.role === "vendeur" ? centime(ca * part * 0.1) : 0,
      marge_nette: centime(ca * part * 0.5),
    }));
  },
  ventes_par_produit: (a) => {
    const b = fonctions.bilan_global(a)[0];
    return PARFUMS.map((p, i) => ({
      produit_id: p.id, produit: p.nom, modele: p.modele.nom,
      unites: Math.round(b.qte_vendue * partsProduits[i]),
      ca: centime(b.ca * partsProduits[i]),
      // La marge ne suit pas les unités : c'est ce que le tableau doit montrer.
      marge: centime(b.ca * partsProduits[i] * (0.35 + i * 0.05)),
    })).filter((p) => p.unites > 0).sort((x, y) => y.unites - x.unites);
  },
  suggestions_reassort: (a) => {
    const jours = a.p_jours ?? 30;
    return PARFUMS.map((p, i) => {
      const vendues = Math.round((jours / 30) * [22, 16, 9, 6, 11, 2][i]);
      const total = stockEntrepot[i] + stockVendeur[i] * 2;
      return { produit_id: p.id, produit: p.nom, modele: p.modele.nom, stock_entrepot: stockEntrepot[i], stock_total: total, seuil_parfum: 5, vendues, a_commander: vendues + 5 - total };
    }).filter((l) => l.a_commander > 0).sort((x, y) => y.a_commander - x.a_commander);
  },
  creances: () => creances,
  ma_dette: () => [{ ca: 2080, commissions: 208, verse: 1100, rembourse: 40, preleve: 0, reste_a_verser: 732, nb_ventes: 57, qte_vendue: 104 }],
  stock_valorise: () =>
    PARFUMS.map((p, i) => ({ produit_id: p.id, produit: nomComplet(p), actif: i !== 5, modele_id: p.modele.id, modele: p.modele.nom, seuil_parfum: 5, seuil_modele: 10, stock_entrepot: stockEntrepot[i], stock_distribue: stockVendeur[i] * 2, stock_total: stockEntrepot[i] + stockVendeur[i] * 2, cout_unitaire: 8.2, valeur_totale: centime((stockEntrepot[i] + stockVendeur[i] * 2) * 8.2) })),
  stock_detenteurs: (a) =>
    PARFUMS.filter((_, i) => stockVendeur[i] > 0).map((p) => ({ detenteur_id: a.p_vendeur_id ?? VENDEUR, detenteur: "Yanis Morel", produit_id: p.id, produit: nomComplet(p), quantite: stockVendeur[PARFUMS.indexOf(p)], valeur: centime(stockVendeur[PARFUMS.indexOf(p)] * 8.2) })),
  totaux_stock: () => [{ entrepot: 147, distribue: 58, total: 205, valeur: 1681 }],
  stock_disponible: () =>
    PARFUMS.map((p, i) => ({ produit_id: p.id, produit: nomComplet(p), quantite: stockVendeur[i], modele_id: p.modele.id, modele: p.modele.nom, seuil_parfum: 3, seuil_modele: 10, prix_vente_conseille: p.modele.prix })),
  stock_entrepot: () =>
    PARFUMS.map((p, i) => ({ produit_id: p.id, produit: nomComplet(p), quantite: stockEntrepot[i], modele_id: p.modele.id, modele: p.modele.nom })),
  // Le plafond de la vraie fonction : `p_limite` nul = tout l'historique.
  mes_ventes: (a) => (a.p_limite == null ? ventes : ventes.slice(0, a.p_limite)),
  ventes_vendeur: (a) =>
    // Sans `corrigeable` : la fenêtre de 48 h ne concerne que le vendeur.
    (a.p_limite == null ? ventes : ventes.slice(0, a.p_limite)).map((v) => ({ ...v, corrigeable: undefined })),
  mon_journal: (a) =>
    ventes.slice(0, a.p_limite ?? 15).map((v) => ({ horodatage: v.cree_le, type: "vente", libelle: `Vente à ${v.client}`, quantite: v.quantite_totale, montant: v.montant_total })),
  journal_transactions: (a) => {
    const q = (a.p_recherche ?? "").toLowerCase();
    return journal
      .filter((l) => !q || `${l.libelle} ${l.vendeur ?? ""}`.toLowerCase().includes(q))
      .filter((l) => !a.p_type || l.type === a.p_type)
      .slice(a.p_offset ?? 0, (a.p_offset ?? 0) + (a.p_limite ?? 100));
  },
  prelevements_vendeur: () => [],
  mes_prelevements: () => [],
  tarifs_preleves: () => [],
  ventes_savables: () => [],
  dossiers_sav: () => [],
  comptes_encadrement: () => [],
  sav_non_vus: () => 0,
  sav_gestion_non_vus: () => 0,
};
