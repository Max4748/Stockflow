"use client";

import { useState } from "react";

import { euros } from "@/lib/format";
import { graduations, type Pas, type PointSerie } from "@/lib/serie";
import { cn } from "@/lib/utils";

/**
 * Courbe du chiffre d'affaires dans le temps.
 *
 * UNE série, donc une seule couleur (la primaire) et pas de légende : le titre
 * de la carte dit ce qui est tracé.
 *
 * LE TRACÉ EST EN SVG, TOUT LE TEXTE EST EN HTML. Le SVG est étiré à la taille
 * de la zone (`preserveAspectRatio="none"`, repère 0–100) : il suit la largeur
 * de l'écran sans mesure ni JavaScript. Un texte dans ce SVG serait étiré avec
 * lui ; graduations, dates, point final et infobulle sont donc des éléments
 * HTML placés en pourcentage sur la même zone. `vector-effect` garde au trait
 * ses 2 px quelle que soit la déformation.
 *
 * L'axe part de ZÉRO et descend dessous si un jour est négatif (un jour où
 * l'on a remboursé plus qu'on n'a vendu) : c'est rare, c'est juste, et un axe
 * tronqué le cacherait.
 *
 * Lecture au survol, au doigt et AU CLAVIER (flèches) : la zone est
 * focalisable. Le tableau replié sous la courbe donne les mêmes chiffres à qui
 * ne peut ni survoler ni voir la courbe.
 */

const FORMATS: Record<Pas, Intl.DateTimeFormat> = {
  // `timeZone: "UTC"` : ce sont des dates comptables sans heure. En heure
  // locale, le serveur et le navigateur pourraient ne pas tomber sur le même
  // jour, et l'hydratation divergerait.
  jour: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }),
  semaine: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }),
  mois: new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" }),
};

function libelleDate(debut: string, pas: Pas, long = false): string {
  const texte = FORMATS[pas].format(new Date(`${debut}T00:00:00Z`));
  return long && pas === "semaine" ? `semaine du ${texte}` : texte;
}

const compact = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function CourbeCa({ serie, pas }: { serie: PointSerie[]; pas: Pas }) {
  const [survol, setSurvol] = useState<number | null>(null);

  const valeurs = serie.map((p) => p.ca);
  const ticks = graduations(Math.min(...valeurs), Math.max(...valeurs));
  const bas = ticks[0];
  const haut = ticks[ticks.length - 1];

  // Repère 0–100 dans les deux sens. Un seul point se place au milieu.
  const x = (i: number) => (serie.length === 1 ? 50 : (i / (serie.length - 1)) * 100);
  const y = (v: number) => 100 - ((v - bas) / (haut - bas)) * 100;

  const trace = serie.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.ca)}`).join(" ");
  const aire = `${trace} L${x(serie.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;

  // Cinq dates au plus sous l'axe : au-delà elles se chevauchent sur téléphone.
  const nbDates = Math.min(serie.length, 5);
  const dates = Array.from({ length: nbDates }, (_, k) =>
    nbDates === 1 ? 0 : Math.round((k * (serie.length - 1)) / (nbDates - 1)),
  );

  const dernier = serie.length - 1;
  const actif = survol ?? dernier;
  const point = serie[actif];

  function viser(clientX: number, zone: HTMLElement) {
    const { left, width } = zone.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    setSurvol(Math.round(ratio * (serie.length - 1)));
  }

  return (
    <div>
      <div className="flex gap-2">
        {/* Graduations : valeurs rondes, en gris, hors de la zone de tracé. */}
        <div className="text-muted-foreground relative h-52 w-10 shrink-0 text-right text-[0.6875rem] tabular-nums">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${y(t)}%` }}
            >
              {compact.format(t)}
            </span>
          ))}
        </div>

        <div
          role="img"
          tabIndex={0}
          aria-label={`Chiffre d'affaires par ${pas}, ${serie.length} points. Flèches gauche et droite pour lire chaque valeur.`}
          className="focus-visible:ring-ring/50 relative h-52 min-w-0 flex-1 cursor-crosshair touch-pan-y rounded-sm outline-none focus-visible:ring-3"
          onPointerMove={(e) => viser(e.clientX, e.currentTarget)}
          onPointerDown={(e) => viser(e.clientX, e.currentTarget)}
          onPointerLeave={() => setSurvol(null)}
          onBlur={() => setSurvol(null)}
          onKeyDown={(e) => {
            const pasClavier =
              e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
            if (pasClavier === 0) return;
            e.preventDefault();
            setSurvol(
              Math.min(dernier, Math.max(0, (survol ?? dernier) + pasClavier)),
            );
          }}
        >
          {/* Lignes de repère : un filet plein, discret. Celle du zéro est un
              peu plus marquée, c'est la base de la courbe. */}
          {ticks.map((t) => (
            <span
              key={t}
              aria-hidden
              className={cn(
                "absolute inset-x-0 border-t",
                t === 0 ? "border-foreground/25" : "border-border",
              )}
              style={{ top: `${y(t)}%` }}
            />
          ))}

          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="text-primary absolute inset-0 size-full overflow-visible"
          >
            {serie.length > 1 && (
              <>
                <path d={aire} fill="currentColor" opacity={0.1} />
                <path
                  d={trace}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>

          {/* Repère vertical du point lu. */}
          {survol !== null && (
            <span
              aria-hidden
              className="border-foreground/30 absolute inset-y-0 border-l"
              style={{ left: `${x(actif)}%` }}
            />
          )}

          {/* Le point : le dernier au repos, celui qu'on lit sinon. L'anneau à
              la couleur de la carte le détache de la courbe qu'il recouvre. */}
          <span
            aria-hidden
            className="bg-primary ring-card absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
            style={{ left: `${x(actif)}%`, top: `${y(point.ca)}%` }}
          />

          {/* Infobulle. Ancrée à gauche ou à droite du point selon la moitié
              où il se trouve, pour ne jamais sortir de la carte. */}
          {survol !== null && (
            <div
              className={cn(
                "bg-popover text-popover-foreground ring-foreground/10 pointer-events-none absolute top-0 z-10 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md ring-1",
                x(actif) > 50 ? "-translate-x-full" : "",
              )}
              style={{
                left: `calc(${x(actif)}% + ${x(actif) > 50 ? -8 : 8}px)`,
              }}
            >
              <p className="text-muted-foreground">
                {libelleDate(point.debut, pas, true)}
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {euros(point.ca)}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {point.nb_ventes} vente{point.nb_ventes > 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Dates, sous la zone de tracé et alignées sur elle. */}
      <div className="text-muted-foreground relative mt-2 ml-12 h-4 text-[0.6875rem]">
        {dates.map((i, k) => (
          <span
            key={i}
            className={cn(
              "absolute whitespace-nowrap",
              // Première et dernière calées sur les bords, les autres centrées.
              nbDates === 1 || (k > 0 && k < nbDates - 1)
                ? "-translate-x-1/2"
                : k === nbDates - 1
                  ? "-translate-x-full"
                  : "",
            )}
            style={{ left: `${x(i)}%` }}
          >
            {libelleDate(serie[i].debut, pas)}
          </span>
        ))}
      </div>

      <details className="mt-3 text-xs">
        <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer py-1">
          Voir les chiffres
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto">
          <table className="w-full tabular-nums">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 font-medium">
                  {pas === "jour" ? "Jour" : pas === "semaine" ? "Semaine du" : "Mois"}
                </th>
                <th className="py-1 text-right font-medium">Ventes</th>
                <th className="py-1 text-right font-medium">Chiffre d&apos;affaires</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((p) => (
                <tr key={p.debut} className="border-t">
                  <td className="py-1">{libelleDate(p.debut, pas)}</td>
                  <td className="py-1 text-right">{p.nb_ventes}</td>
                  <td className="py-1 text-right">{euros(p.ca)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
