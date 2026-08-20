"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Bascule de thème : Clair / Sombre / Système.
 *
 * PAS D'ÉTAT `mounted` ICI. Le réflexe habituel — un `useState(false)` remis à
 * `true` dans un `useEffect` pour éviter la divergence d'hydratation — est
 * refusé par ESLint dans ce projet (setState dans un effet, renders en
 * cascade), et il ferait clignoter le bouton au chargement.
 *
 * À la place, les DEUX icônes sont rendues en permanence et c'est le CSS qui
 * décide laquelle se voit, via la classe `.dark` posée sur <html> par
 * next-themes. Le balisage est donc identique côté serveur et côté client :
 * aucune divergence possible, et l'icône est correcte dès le premier pixel
 * affiché — avant même que React ait hydraté.
 *
 * `useTheme()` n'est lu que dans le contenu du menu, qui ne se rend qu'à
 * l'ouverture, donc après hydratation.
 */
export function BoutonTheme() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Changer de thème">
            {/* Les deux icônes se superposent ; seule celle du thème actif est
                à l'échelle 1. Aucune logique JavaScript n'intervient. */}
            <SunIcon className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
            <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={setTheme}
        >
          <DropdownMenuRadioItem value="light">
            <SunIcon className="size-4" />
            Clair
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon className="size-4" />
            Sombre
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon className="size-4" />
            Système
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Variante posée en coin d'écran, pour les pages d'authentification qui n'ont
 * pas d'en-tête (connexion, mot de passe provisoire, compte en attente). Un
 * vendeur qui se connecte pour la première fois y passe avant d'atteindre son
 * espace : il doit pouvoir basculer dès là.
 */
export function BoutonThemeFlottant() {
  return (
    <div className="fixed top-3 right-3 z-20">
      <BoutonTheme />
    </div>
  );
}
