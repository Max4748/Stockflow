import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pied de liste paginée : précédente à gauche, suivante à droite, le repère
 * au milieu. Même place et même forme sous toutes les listes.
 *
 * Pilotée par l'URL, comme le tri et la recherche : les autres paramètres sont
 * reconduits tels quels, et `prefixe` distingue deux listes paginées d'un même
 * écran (`page`, `vpage`…).
 *
 * `total` connu (requête avec `count`) : on affiche « Page 2 sur 7 ». Inconnu
 * (le journal comptable, dont la fonction ne compte pas) : on sait seulement
 * qu'une page PLEINE a peut-être une suite, d'où `pleine`.
 *
 * Rien n'est rendu quand tout tient sur une page : un pied « Page 1 sur 1 »
 * sous cinq lignes n'est que du bruit.
 */
export function Pagination({
  params,
  chemin,
  prefixe = "",
  page,
  parPage,
  total,
  pleine,
}: {
  params: Record<string, string | undefined>;
  chemin: string;
  prefixe?: string;
  page: number;
  parPage: number;
  /** Nombre total de lignes, si la requête l'a compté. */
  total?: number | null;
  /** Sans `total` : la page affichée est-elle pleine ? */
  pleine?: boolean;
}) {
  const connu = typeof total === "number";
  const nbPages = connu ? Math.max(1, Math.ceil(total / parPage)) : null;
  const aSuivante = nbPages !== null ? page < nbPages : Boolean(pleine);
  if (page <= 1 && !aSuivante) return null;

  const lien = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== `${prefixe}page`) p.set(k, v);
    }
    if (n > 1) p.set(`${prefixe}page`, String(n));
    const q = p.toString();
    return q ? `${chemin}?${q}` : chemin;
  };
  const bouton = cn(buttonVariants({ variant: "outline" }), "h-10");

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between gap-3 border-t pt-4"
    >
      {page > 1 ? (
        <Link href={lien(page - 1)} scroll={false} className={bouton}>
          <ChevronLeftIcon />
          <span className="max-sm:sr-only">Page précédente</span>
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground text-center text-sm tabular-nums">
        Page {page}
        {nbPages !== null && ` sur ${nbPages}`}
        {connu && (
          <span className="max-sm:hidden"> · {total} ligne(s)</span>
        )}
      </span>
      {aSuivante ? (
        <Link href={lien(page + 1)} scroll={false} className={bouton}>
          <span className="max-sm:sr-only">Page suivante</span>
          <ChevronRightIcon />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
