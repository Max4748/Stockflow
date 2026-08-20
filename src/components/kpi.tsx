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
 */
export function Kpi({
  libelle,
  valeur,
  precision,
  accent,
  className,
}: {
  libelle: string;
  valeur: ReactNode;
  precision?: ReactNode;
  /**
   * Chiffre principal de l'écran. Se distingue par sa taille ET par un anneau
   * plus marqué : la taille seule ne se voyait pas dans une rangée de quatre.
   */
  accent?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn(accent && "ring-foreground/25 bg-card/80", className)}>
      <CardContent>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {libelle}
        </p>
        <p
          className={cn(
            "mt-2 font-semibold leading-none tabular-nums",
            accent ? "text-3xl" : "text-2xl",
          )}
        >
          {valeur}
        </p>
        {precision && (
          <p className="text-muted-foreground mt-2 text-xs leading-snug">
            {precision}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
