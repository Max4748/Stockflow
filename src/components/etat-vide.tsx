import { InboxIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Ce qu'on montre quand une liste n'a rien à montrer.
 *
 * Une ligne de texte gris au milieu d'une carte se lisait comme un chargement
 * raté. Une icône et un message disent que le vide est NORMAL, et `children`
 * accueille le geste qui le remplit quand il y en a un.
 */
export function EtatVide({
  icone: Icone = InboxIcon,
  titre,
  description,
  className,
  children,
}: {
  icone?: LucideIcon;
  titre: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-8 text-center",
        className,
      )}
    >
      <span className="bg-primary/10 text-primary mb-1 inline-flex size-11 items-center justify-center rounded-full">
        <Icone className="size-5" />
      </span>
      <p className="text-sm font-medium">{titre}</p>
      {description && (
        <p className="text-muted-foreground max-w-sm text-sm text-pretty">
          {description}
        </p>
      )}
      {children && <div className="pt-2">{children}</div>}
    </div>
  );
}
