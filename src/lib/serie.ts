/**
 * Mise en forme de la série « chiffre d'affaires par jour » pour la courbe.
 *
 * La base ne renvoie que les jours qui ont bougé (`ca_par_jour`). Deux choses
 * restent à faire, et ce sont de la présentation :
 *
 *   • COMBLER LES TROUS. Une courbe tracée entre les seuls jours de vente
 *     relie le lundi au vendredi par une pente, comme si mardi, mercredi et
 *     jeudi avaient vendu quelque chose. Un jour sans vente vaut zéro et doit
 *     se voir ;
 *   • REGROUPER quand la période est longue. Trois cent soixante-cinq points
 *     sur six cents pixels font un peigne illisible : au-delà de deux mois on
 *     passe à la semaine, au-delà de treize mois au mois.
 *
 * Les dates sont manipulées en UTC de bout en bout : ce sont des dates
 * comptables sans heure, et `new Date("2026-03-29")` relu en heure locale
 * recule d'un jour à l'ouest de Greenwich.
 */

export type PointJour = { jour: string; ca: number; nb_ventes: number };
export type Pas = "jour" | "semaine" | "mois";
export type PointSerie = {
  /** Premier jour de l'intervalle, `AAAA-MM-JJ`. */
  debut: string;
  ca: number;
  nb_ventes: number;
};

const JOUR_MS = 86_400_000;

function versUtc(iso: string): number {
  const [a, m, j] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, j);
}

function versIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function choisirPas(nbJours: number): Pas {
  if (nbJours <= 62) return "jour";
  if (nbJours <= 400) return "semaine";
  return "mois";
}

/** Premier jour de l'intervalle qui contient `ms`. Les semaines commencent le lundi. */
function debutIntervalle(ms: number, pas: Pas): number {
  const d = new Date(ms);
  if (pas === "mois") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (pas === "semaine") return ms - ((d.getUTCDay() + 6) % 7) * JOUR_MS;
  return ms;
}

function suivant(ms: number, pas: Pas): number {
  if (pas === "mois") {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return ms + (pas === "semaine" ? 7 : 1) * JOUR_MS;
}

/**
 * `du` / `au` : bornes de la période affichée. Absentes (période « Tout »),
 * la série s'étend du premier au dernier jour qui a bougé.
 */
export function construireSerie(
  points: PointJour[],
  du?: string | null,
  au?: string | null,
): { pas: Pas; serie: PointSerie[] } {
  if (points.length === 0) return { pas: "jour", serie: [] };

  const jours = points.map((p) => versUtc(p.jour));
  const debut = du ? versUtc(du) : Math.min(...jours);
  const fin = Math.max(au ? versUtc(au) : Math.max(...jours), debut);
  const pas = choisirPas(Math.round((fin - debut) / JOUR_MS) + 1);

  const cumul = new Map<number, { ca: number; nb_ventes: number }>();
  for (const p of points) {
    const cle = debutIntervalle(versUtc(p.jour), pas);
    const c = cumul.get(cle) ?? { ca: 0, nb_ventes: 0 };
    c.ca += Number(p.ca);
    c.nb_ventes += Number(p.nb_ventes);
    cumul.set(cle, c);
  }

  const serie: PointSerie[] = [];
  for (
    let t = debutIntervalle(debut, pas);
    t <= fin;
    t = suivant(t, pas)
  ) {
    const c = cumul.get(t);
    serie.push({
      debut: versIso(t),
      // Arrondi au centime : une somme de flottants traîne des 1e-13.
      ca: Math.round((c?.ca ?? 0) * 100) / 100,
      nb_ventes: c?.nb_ventes ?? 0,
    });
  }
  return { pas, serie };
}

/**
 * Graduations « rondes » d'un axe : 0 / 500 / 1 000 plutôt que 0 / 437 / 874.
 * Renvoie des valeurs régulières couvrant [min, max], zéro compris.
 */
export function graduations(min: number, max: number, cible = 4): number[] {
  const bas = Math.min(0, min);
  const haut = Math.max(0, max);
  if (haut === bas) return [0, 1];

  const brut = (haut - bas) / cible;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas =
    [1, 2, 2.5, 5, 10].find((m) => m * puissance >= brut)! * puissance;

  const valeurs: number[] = [];
  for (let v = Math.floor(bas / pas) * pas; v < haut + pas; v += pas) {
    valeurs.push(Math.round(v * 100) / 100);
    if (v >= haut) break;
  }
  return valeurs;
}
