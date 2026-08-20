/**
 * Bornes de période, dérivées des searchParams.
 *
 * Pilotée par l'URL et non par un état client : la page reste un Server
 * Component (les RPC sont appelées côté serveur), le filtre survit au
 * rechargement et l'URL est partageable.
 */

export type ClePeriode = "mois" | "30j" | "annee" | "tout" | "libre";

export type Periode = {
  cle: ClePeriode;
  /** null = pas de borne (« tout l'historique »). */
  du: string | null;
  au: string | null;
};

export const PRESETS: { cle: ClePeriode; libelle: string }[] = [
  { cle: "mois", libelle: "Mois en cours" },
  { cle: "30j", libelle: "30 derniers jours" },
  { cle: "annee", libelle: "Année en cours" },
  { cle: "tout", libelle: "Tout" },
];

function iso(d: Date): string {
  // Découpage sur la date locale : toISOString() basculerait d'un jour pour
  // les fuseaux à l'est de UTC en fin de soirée.
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mois}-${jour}`;
}

/**
 * `tout` est le défaut : sur une base jeune, un filtre « mois en cours » par
 * défaut afficherait un tableau de bord vide et laisserait croire à une panne.
 */
export function lirePeriode(
  params: Record<string, string | undefined>,
): Periode {
  const cle = (params.periode ?? "tout") as ClePeriode;
  const maintenant = new Date();

  switch (cle) {
    case "mois": {
      const debut = new Date(
        maintenant.getFullYear(),
        maintenant.getMonth(),
        1,
      );
      return { cle, du: iso(debut), au: iso(maintenant) };
    }
    case "30j": {
      const debut = new Date(maintenant);
      debut.setDate(debut.getDate() - 30);
      return { cle, du: iso(debut), au: iso(maintenant) };
    }
    case "annee": {
      const debut = new Date(maintenant.getFullYear(), 0, 1);
      return { cle, du: iso(debut), au: iso(maintenant) };
    }
    case "libre":
      return {
        cle,
        du: params.du || null,
        au: params.au || null,
      };
    default:
      return { cle: "tout", du: null, au: null };
  }
}

/** Arguments de période à passer aux RPC, en omettant les bornes nulles. */
export function argsPeriode(p: Periode): { p_du?: string; p_au?: string } {
  return {
    ...(p.du ? { p_du: p.du } : {}),
    ...(p.au ? { p_au: p.au } : {}),
  };
}
