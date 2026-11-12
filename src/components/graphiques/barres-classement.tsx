/**
 * Classement en barres horizontales, la plus longue en tête : les vendeurs par
 * chiffre d'affaires, les produits par unités vendues.
 *
 * Une seule mesure, donc UNE couleur : colorer chaque ligne différemment
 * ferait chercher un sens à des teintes qui n'en ont pas. Le nom est à gauche
 * de sa barre et la valeur à son bout, en texte ordinaire ; personne n'a à
 * faire correspondre une couleur à une légende.
 *
 * Barres fines (12 px), arrondies du côté de la valeur et droites du côté de
 * l'origine, toutes sur la même base : c'est ce qui rend les longueurs
 * comparables d'un coup d'œil.
 *
 * Au-delà de `max` lignes, le reste est regroupé en une ligne « Autres » :
 * vingt barres de quelques pixels n'apprennent rien, et un tableau placé à
 * côté de ce graphique donne le détail de chacune.
 *
 * Les lignes sont attendues DÉJÀ classées : c'est la requête qui décide de
 * l'ordre, ce composant ne fait que le dessiner.
 */

export type LigneClassement = {
  id: string;
  nom: string;
  valeur: number;
  /** Précision au survol (« 12 ventes »). */
  detail?: string;
};

export function BarresClassement({
  lignes: recues,
  format,
  max = 7,
}: {
  lignes: LigneClassement[];
  /** Écriture de la valeur au bout de la barre (« 1 234,00 € », « 42 u »). */
  format: (valeur: number) => string;
  max?: number;
}) {
  const tete = recues.slice(0, max);
  const reste = recues.slice(max);

  const lignes: LigneClassement[] = [
    ...tete,
    ...(reste.length > 0
      ? [
          {
            id: "autres",
            nom: `Autres (${reste.length})`,
            valeur: reste.reduce((s, l) => s + l.valeur, 0),
          },
        ]
      : []),
  ];
  const sommet = Math.max(...lignes.map((l) => l.valeur), 0);

  return (
    <ul className="space-y-3">
      {lignes.map((l) => (
        <li key={l.id} title={l.detail}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{l.nom}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {format(l.valeur)}
            </span>
          </div>
          <div className="bg-muted mt-1.5 h-3 rounded-r-sm">
            <div
              className="bg-primary h-full rounded-r-sm"
              // Une valeur négative (plus de remboursements que de ventes sur
              // la période) ne dessine pas de barre : elle reste écrite
              // au-dessus.
              style={{
                width: `${sommet > 0 ? Math.max(0, (l.valeur / sommet) * 100) : 0}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
