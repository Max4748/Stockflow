import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Carte d'indicateur. Même forme partout pour que le patron n'ait pas à
 * réapprendre à lire chaque écran.
 *
 * Trois réglages qui font toute la différence à l'œil :
 *
 *   • le rythme vertical est SYMÉTRIQUE. La version précédente ajoutait un
 *     `pt-6` par-dessus le `py-4` de la carte : le contenu était collé en haut
 *     et laissait un vide en bas, ce qui donnait des cartes molles ;
 *   • le libellé est en petites capitales espacées. C'est ce qui l'ancre comme
 *     une étiquette et laisse le chiffre dominer, au lieu de trois lignes de
 *     tailles voisines qui se disputent l'attention ;
 *   • `leading-none` sur le chiffre. Une police de 30 px traîne sinon un
 *     interligne qui creuse la carte sans rien y mettre.
 *
 * LA COULEUR PORTE UN SENS, jamais une décoration :
 *
 *   • `accent` : LE chiffre de l'écran, un seul par page. Aplat primaire plein.
 *     Un anneau gris plus marqué ne suffisait pas à le sortir d'une rangée ;
 *   • `ton` : colore la pastille de l'icône, et le chiffre lui-même pour
 *     `alerte` et `danger`, parce qu'un montant à réclamer ou une perte doit
 *     se lire sans lire le libellé. `succes` ne colore que la pastille : un
 *     chiffre vert partout ne dirait plus rien.
 *
 * `href` rend la carte ENTIÈRE cliquable : un indicateur mène à l'écran qui le
 * détaille (« À récupérer » → Vendeurs). Le chevron dit qu'elle l'est ; sans
 * lui, rien ne distingue une carte qui mène quelque part d'une carte inerte.
 */

const TONS = {
  neutre: { pastille: "bg-primary/10 text-primary", valeur: "" },
  succes: { pastille: "bg-succes/12 text-succes", valeur: "" },
  alerte: { pastille: "bg-alerte/12 text-alerte", valeur: "text-alerte" },
  danger: {
    pastille: "bg-destructive/12 text-destructive",
    valeur: "text-destructive",
  },
} as const;

export function Kpi({
  libelle,
  valeur,
  precision,
  accent,
  icone: Icone,
  ton = "neutre",
  className,
  href,
  children,
}: {
  libelle: string;
  valeur: ReactNode;
  precision?: ReactNode;
  /** Chiffre principal de l'écran : un seul par page. */
  accent?: boolean;
  icone?: LucideIcon;
  ton?: keyof typeof TONS;
  className?: string;
  /** Écran qui détaille ce chiffre. */
  href?: string;
  /** Détail libre sous le chiffre (décomposition, lien…). */
  children?: ReactNode;
}) {
  const carte = (
    <Card
      className={cn(
        href &&
          "group-hover/kpi:ring-primary/40 h-full transition-shadow group-hover/kpi:shadow-md",
        accent &&
          // En sombre, un aplat primaire plein serait la surface la plus
          // lumineuse de l'écran : on garde la teinte, diluée, et le texte
          // ordinaire. C'est le thème qu'on choisit pour reposer ses yeux.
          "bg-primary text-primary-foreground ring-primary dark:bg-primary/14 dark:text-foreground dark:ring-primary/45 shadow-md dark:shadow-none",
        !href && className,
      )}
    >
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              "text-xs font-medium tracking-wide uppercase",
              accent
                ? "text-primary-foreground/85 dark:text-muted-foreground"
                : "text-muted-foreground",
            )}
          >
            {libelle}
          </p>
          {Icone && (
            <span
              className={cn(
                "-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                accent
                  ? "bg-primary-foreground/15 dark:bg-primary/20 dark:text-primary"
                  : TONS[ton].pastille,
              )}
            >
              <Icone className="size-4" />
            </span>
          )}
        </div>
        <p
          className={cn(
            "mt-2 font-semibold leading-none tabular-nums",
            accent ? "text-3xl sm:text-4xl" : "text-2xl",
            !accent && TONS[ton].valeur,
          )}
        >
          {valeur}
        </p>
        {(precision || href) && (
          <p
            className={cn(
              "mt-2 flex items-end justify-between gap-2 text-xs leading-snug",
              accent
                ? "text-primary-foreground/85 dark:text-muted-foreground"
                : "text-muted-foreground",
            )}
          >
            <span>{precision}</span>
            {href && (
              <ChevronRightIcon className="size-4 shrink-0 transition-transform group-hover/kpi:translate-x-0.5" />
            )}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );

  if (!href) return carte;

  return (
    <Link
      href={href}
      className={cn(
        "group/kpi focus-visible:ring-ring/50 block rounded-xl outline-none focus-visible:ring-3",
        className,
      )}
    >
      {carte}
    </Link>
  );
}
