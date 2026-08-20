const EUROS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const EUROS_PRECIS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const DATE_COURTE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATE_HEURE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_HEURE_SECONDE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Les montants arrivent de PostgREST en `number` (numeric sérialisé). */
export function euros(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return EUROS.format(typeof v === "string" ? Number(v) : v);
}

/**
 * Montant à 4 décimales — réservé au coût de revient unitaire, stocké ainsi
 * parce qu'une division par 250 unités ne tombe pas juste au centime.
 *
 * Passe par `Intl` comme tout le reste : un `toFixed(4)` produirait « 4.3000 »
 * avec un point décimal anglais, à côté de « 240,00 € » formaté en français.
 */
export function eurosPrecis(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return EUROS_PRECIS.format(typeof v === "string" ? Number(v) : v);
}

export function date(v: string | null | undefined): string {
  if (!v) return "—";
  return DATE_COURTE.format(new Date(v));
}

export function dateHeure(v: string | null | undefined): string {
  if (!v) return "—";
  return DATE_HEURE.format(new Date(v));
}

/**
 * À la seconde près. Réservé aux listes où l'utilisateur doit DISTINGUER deux
 * lignes : plusieurs ventes au même client, du même produit, saisies dans la
 * même minute sont autrement impossibles à départager. Partout ailleurs, la
 * seconde est du bruit — utiliser `dateHeure`.
 */
export function dateHeurePrecise(v: string | null | undefined): string {
  if (!v) return "—";
  return DATE_HEURE_SECONDE.format(new Date(v));
}

export function quantite(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v} u`;
}

/** Date du jour au format attendu par un <input type="date">. */
export function aujourdHui(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Niveau d'alerte d'un stock, relatif au seuil défini par produit.
 * Purement cosmétique : le contrôle qui compte est fait en SQL.
 */
export function niveauStock(
  quantite: number,
  seuil: number,
): "rupture" | "bas" | "ok" {
  if (quantite <= 0) return "rupture";
  if (quantite <= seuil) return "bas";
  return "ok";
}

export const LIBELLES_STATUT_SAV: Record<string, string> = {
  valide: "Validé",
  en_attente: "En attente",
  refuse: "Refusé",
  annule: "Retiré",
};

export const LIBELLES_STATUT: Record<string, string> = {
  en_attente: "En attente",
  approuvee: "Approuvée",
  partielle: "Partielle",
  refusee: "Refusée",
  annulee: "Annulée",
};
