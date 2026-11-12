import { euros } from "@/lib/format";

/**
 * Classement des vendeurs par chiffre d'affaires : des barres horizontales,
 * la plus longue en tête.
 *
 * Une seule mesure, donc UNE couleur : colorer chaque vendeur différemment
 * ferait chercher un sens à des teintes qui n'en ont pas. Le nom est à gauche
 * de sa barre et le montant à son bout, en texte ordinaire ; personne n'a à
 * faire correspondre une couleur à une légende.
 *
 * Barres fines (12 px), arrondies du côté de la valeur et droites du côté de
 * l'origine, toutes sur la même base : c'est ce qui rend les longueurs
 * comparables d'un coup d'œil.
 *
 * Au-delà de `MAX` vendeurs, le reste est regroupé en une ligne « Autres » :
 * vingt barres de quelques pixels n'apprennent rien, et le tableau placé sous
 * ce graphique donne le détail de chacun.
 */

const MAX = 7;

export type BarreVendeur = { id: string; nom: string; ca: number; nbVentes: number };

export function BarresVendeurs({ vendeurs }: { vendeurs: BarreVendeur[] }) {
  const tries = [...vendeurs].sort((a, b) => b.ca - a.ca);
  const tete = tries.slice(0, MAX);
  const reste = tries.slice(MAX);

  const lignes = [
    ...tete,
    ...(reste.length > 0
      ? [
          {
            id: "autres",
            nom: `Autres (${reste.length})`,
            ca: reste.reduce((s, v) => s + v.ca, 0),
            nbVentes: reste.reduce((s, v) => s + v.nbVentes, 0),
          },
        ]
      : []),
  ];
  const max = Math.max(...lignes.map((l) => l.ca), 0);

  return (
    <ul className="space-y-3">
      {lignes.map((l) => (
        <li key={l.id} title={`${l.nbVentes} vente(s)`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{l.nom}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {euros(l.ca)}
            </span>
          </div>
          <div className="bg-muted mt-1.5 h-3 rounded-r-sm">
            <div
              className="bg-primary h-full rounded-r-sm"
              // Un chiffre d'affaires négatif (plus de remboursements que de
              // ventes sur la période) ne dessine pas de barre : sa valeur
              // reste écrite au-dessus.
              style={{ width: `${max > 0 ? Math.max(0, (l.ca / max) * 100) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
