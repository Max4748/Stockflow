/**
 * Habitudes de vente d'un vendeur, pour accélérer la saisie sur téléphone :
 * ses produits les plus vendus en tête de liste, et la reprise de sa dernière
 * vente.
 *
 * C'est de la PRÉSENTATION, pas une règle métier : l'ordre d'une liste
 * déroulante et le pré-remplissage d'un formulaire. Rien ici ne décide d'un
 * montant ni d'un stock ; `enregistrer_vente()` recontrôle tout à la
 * validation. D'où sa place en TypeScript, et son test (`habitudes-vente.test.ts`).
 */

export type LigneVendue = {
  vente_id: string;
  produit_id: string;
  quantite: number;
  prix_vente_unitaire: number;
};

/**
 * Les produits les plus vendus d'abord. Le tri est stable : à ventes égales
 * (et pour ceux jamais vendus), l'ordre reçu est conservé.
 */
export function ordonnerParFrequence<T extends { produit_id: string }>(
  produits: T[],
  lignes: LigneVendue[],
): T[] {
  const vendues = new Map<string, number>();
  for (const l of lignes) {
    vendues.set(l.produit_id, (vendues.get(l.produit_id) ?? 0) + Number(l.quantite));
  }
  return produits
    .map((produit, index) => ({ produit, index }))
    .sort(
      (a, b) =>
        (vendues.get(b.produit.produit_id) ?? 0) -
          (vendues.get(a.produit.produit_id) ?? 0) || a.index - b.index,
    )
    .map((x) => x.produit);
}

export type LigneReprise = { produit_id: string; quantite: number; prix: number };

/**
 * Ce qu'on peut reprendre d'une vente passée avec le stock d'aujourd'hui.
 *
 * Un produit que le vendeur ne détient plus est écarté, une quantité
 * supérieure au stock est ramenée à ce qu'il reste. Les deux cas sont
 * rapportés dans `ajustements` : pré-remplir en silence une vente différente
 * de celle qu'on a annoncé reprendre serait le meilleur moyen de la valider
 * sans la relire.
 */
export function reprendreVente(
  lignes: (LigneVendue & { produit?: string })[],
  disponibles: { produit_id: string; produit: string; quantite: number }[],
): { lignes: LigneReprise[]; ajustements: string[] } {
  const stock = new Map(disponibles.map((p) => [p.produit_id, p]));
  const reprises: LigneReprise[] = [];
  const ajustements: string[] = [];

  for (const l of lignes) {
    const detenu = stock.get(l.produit_id);
    if (!detenu || detenu.quantite <= 0) {
      ajustements.push(`${l.produit ?? "Un produit"} : plus en stock, retiré`);
      continue;
    }
    const quantite = Math.min(Number(l.quantite), detenu.quantite);
    if (quantite < Number(l.quantite)) {
      ajustements.push(
        `${detenu.produit} : ${quantite} au lieu de ${l.quantite}, faute de stock`,
      );
    }
    reprises.push({
      produit_id: l.produit_id,
      quantite,
      prix: Number(l.prix_vente_unitaire),
    });
  }
  return { lignes: reprises, ajustements };
}
