import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Rangée de boutons en bas d'un formulaire ou d'un dialogue. UNE SEULE
 * disposition pour toute l'application :
 *
 *   • dès `sm` : boutons groupés À DROITE, « Annuler » (ou le refus) d'abord,
 *     l'action principale EN DERNIER ;
 *   • sur téléphone : pleine largeur, empilés à l'envers, donc l'action
 *     principale au-dessus et l'annulation dessous.
 *
 * L'ordre d'écriture est donc toujours le même : secondaire, puis principal.
 *
 * Cinq variantes de ce bloc cohabitaient (sans alignement à droite, sans
 * empilement, principal à gauche…). Les boutons y changeaient de place d'un
 * dialogue à l'autre.
 *
 * Un `<form>` enfant (cas d'un dialogue de confirmation, où seul le bouton
 * principal soumet) est étiré comme un bouton : `[&>form>button]:w-full`.
 */
export function PiedFormulaire({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="pied-formulaire"
      className={cn(
        "flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end",
        "[&>form>button]:w-full sm:[&>form>button]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
