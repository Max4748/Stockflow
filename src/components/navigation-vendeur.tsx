"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import type { Compteurs } from "@/components/navigation-admin";
import { cn } from "@/lib/utils";

const ONGLETS = [
  { href: "/vendeur", libelle: "Accueil" },
  { href: "/vendeur/vente", libelle: "Vendre" },
  { href: "/vendeur/stock", libelle: "Stock" },
  { href: "/vendeur/restock", libelle: "Réassort" },
  { href: "/vendeur/sav", libelle: "SAV" },
];

function estActif(chemin: string, href: string) {
  // "/vendeur" ne doit pas s'allumer sur toutes ses sous-routes.
  return href === "/vendeur" ? chemin === "/vendeur" : chemin.startsWith(href);
}

/**
 * Barre d'onglets fixée en bas — la zone atteignable au pouce. Masquée à
 * partir de `md` : sur un écran large, une barre collée en bas de fenêtre est
 * loin du contenu et n'a pas de sens à la souris.
 */
export function NavigationMobile({ compteurs }: { compteurs: Compteurs }) {
  const chemin = usePathname();

  return (
    // Pleine largeur : le conteneur de page n'a plus de plafond, une barre
    // centrée à 672 px serait décalée par rapport au contenu entre 672 et
    // 768 px de large.
    <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-10 flex w-full border-t backdrop-blur md:hidden">
      {ONGLETS.map((onglet) => {
        const actif = estActif(chemin, onglet.href);
        const compteur = compteurs[onglet.href] ?? 0;
        return (
          <Link
            key={onglet.href}
            href={onglet.href}
            aria-current={actif ? "page" : undefined}
            className={cn(
              // min-h-14 : cible tactile confortable, au-delà des 44 px minimum.
              // Cinq onglets tiennent : ~75 px chacun sur un écran de 375 px.
              "flex min-h-14 flex-1 items-center justify-center gap-1 text-sm font-medium transition-colors",
              actif
                ? "text-foreground border-foreground border-t-2"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {onglet.libelle}
            {compteur > 0 && <Badge variant="destructive">{compteur}</Badge>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Navigation en ligne dans l'en-tête, à partir de `md` seulement. */
export function NavigationBureau({ compteurs }: { compteurs: Compteurs }) {
  const chemin = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {ONGLETS.map((onglet) => {
        const actif = estActif(chemin, onglet.href);
        const compteur = compteurs[onglet.href] ?? 0;
        return (
          <Link
            key={onglet.href}
            href={onglet.href}
            aria-current={actif ? "page" : undefined}
            className={cn(
              "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              actif
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {onglet.libelle}
            {compteur > 0 && <Badge variant="destructive">{compteur}</Badge>}
          </Link>
        );
      })}
    </nav>
  );
}
