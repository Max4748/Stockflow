import type { ReactNode } from "react";

import { BoutonThemeFlottant } from "@/components/bouton-theme";
import { Logo } from "@/components/logo";

/**
 * Cadre commun aux écrans hors espace : connexion, mot de passe oublié,
 * changement de mot de passe, vérification, compte en attente.
 *
 * Chacun posait son propre titre (trois tailles différentes), deux d'entre eux
 * le mettaient dans la carte et les autres au-dessus. Ici : la marque, le
 * titre, une phrase, puis le contenu, toujours dans cet ordre.
 *
 * `max-w-sm` est légitime ici : c'est un formulaire à lire, pas un écran de
 * données. La règle « aucun plafond de largeur » vise les pages des espaces.
 *
 * Le halo du fond est un dégradé radial à la couleur primaire, très dilué :
 * c'est la première chose qu'un vendeur voit de l'application.
 */
export function CadreAuth({
  titre,
  description,
  pied,
  children,
}: {
  titre: string;
  description?: ReactNode;
  /** Lien ou bouton de sortie, sous le contenu. */
  pied?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="from-primary/14 pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60dvh] bg-radial-[ellipse_at_top] to-transparent to-70%"
      />
      <BoutonThemeFlottant />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-4 size-12 rounded-xl" />
          <h1 className="text-2xl font-semibold tracking-tight">{titre}</h1>
          {description && (
            <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
              {description}
            </p>
          )}
        </div>
        {children}
        {pied && (
          <div className="text-muted-foreground mt-6 flex justify-center text-sm">
            {pied}
          </div>
        )}
      </div>
    </main>
  );
}
