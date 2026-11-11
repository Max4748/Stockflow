import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * En-tête de page. UN SEUL pour toute l'application.
 *
 * Chaque écran écrivait le sien, et il en existait quatre variantes : le titre
 * et ses boutons n'étaient jamais alignés de la même façon, le sous-titre et le
 * lien de retour étaient refaits à la main. Résultat, d'un écran à l'autre le
 * bouton principal n'était pas au même endroit.
 *
 * La disposition est fixe et ne se règle pas par props :
 *
 *   • titre à gauche, avec son lien de retour au-dessus et sa description
 *     en dessous ;
 *   • ACTIONS À DROITE dès `sm`. L'action principale (variante `default`) se
 *     place en DERNIER, donc à l'extrême droite ; les secondaires (`outline`)
 *     la précèdent ;
 *   • sur téléphone, les actions passent SOUS le titre, en pleine largeur, et
 *     s'empilent à l'envers : la principale se retrouve en premier, sous le
 *     pouce ;
 *   • les filtres (période, compte) ne sont pas des actions : ils ont leur
 *     propre rangée sous le titre et ne disputent pas la place des boutons.
 */
export function EntetePage({
  titre,
  description,
  retour,
  badge,
  filtres,
  children,
}: {
  titre: ReactNode;
  description?: ReactNode;
  /** Lien vers l'écran parent, pour une page de détail. */
  retour?: { href: string; libelle: string };
  /** Pastille(s) d'état accolée(s) au titre. */
  badge?: ReactNode;
  filtres?: ReactNode;
  /** Les actions de la page. */
  children?: ReactNode;
}) {
  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {retour && (
            <Link
              href={retour.href}
              className="text-muted-foreground hover:text-primary -ml-1 mb-1 inline-flex min-h-6 items-center gap-0.5 text-sm transition-colors"
            >
              <ChevronLeftIcon className="size-4" />
              {retour.libelle}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{titre}</h1>
            {badge}
          </div>
          {description && (
            <p className="text-muted-foreground mt-1 text-sm text-pretty">
              {description}
            </p>
          )}
        </div>

        {children && (
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {children}
          </div>
        )}
      </div>

      {filtres}
    </header>
  );
}
