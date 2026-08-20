"use client";

import { ThemeProvider as FournisseurNextThemes } from "next-themes";

/**
 * Fournisseur de thème.
 *
 * `attribute="class"` pose la classe `.dark` sur <html>, ce qui correspond au
 * déclencheur déjà présent dans globals.css :
 *   @custom-variant dark (&:is(.dark *))
 *
 * `defaultTheme="system"` : l'application suit le réglage du téléphone tant que
 * le vendeur n'a rien choisi — elle passe donc en sombre le soir sans geste de
 * sa part. Un choix manuel est mémorisé par appareil et prend le dessus.
 *
 * `disableTransitionOnChange` : sans lui, toutes les transitions CSS de la page
 * s'animent au moment de la bascule, ce qui donne un fondu général peu net.
 *
 * next-themes injecte un script BLOQUANT qui pose la classe avant le premier
 * rendu : c'est ce qui évite le flash de thème clair. Il fonctionne grâce au
 * `suppressHydrationWarning` posé sur <html> dans le layout racine — le seul
 * endroit du projet où cet attribut est légitime, puisque c'est le script
 * lui-même qui modifie le DOM avant React.
 */
export function FournisseurTheme({ children }: { children: React.ReactNode }) {
  return (
    <FournisseurNextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </FournisseurNextThemes>
  );
}
