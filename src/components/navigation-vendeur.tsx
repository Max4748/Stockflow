"use client";

import {
  BoxesIcon,
  HomeIcon,
  LifeBuoyIcon,
  type LucideIcon,
  ShoppingCartIcon,
  TruckIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import type { Compteurs } from "@/lib/types";
import { cn } from "@/lib/utils";

const ONGLETS: { href: string; libelle: string; icone: LucideIcon }[] = [
  { href: "/vendeur", libelle: "Accueil", icone: HomeIcon },
  { href: "/vendeur/vente", libelle: "Vendre", icone: ShoppingCartIcon },
  { href: "/vendeur/stock", libelle: "Stock", icone: BoxesIcon },
  { href: "/vendeur/restock", libelle: "Réassort", icone: TruckIcon },
  { href: "/vendeur/sav", libelle: "SAV", icone: LifeBuoyIcon },
];

/**
 * Un compte lié à l'entrepôt ne demande pas de réassort : il se l'accorderait
 * à lui-même. L'entrée disparaît de sa navigation.
 *
 * Ce n'est PAS une mesure de sécurité, comme le filtrage par niveau côté
 * gestion : la page reste joignable en tapant l'URL, et c'est très bien.
 * `creer_demande_restock` n'a aucune raison de la refuser, une demande sans
 * objet ne casse rien. On évite seulement de proposer un geste qui n'a pas de
 * sens.
 */
function onglets(stockLie: boolean) {
  return stockLie
    ? ONGLETS.filter((o) => o.href !== "/vendeur/restock")
    : ONGLETS;
}

function estActif(chemin: string, href: string) {
  // "/vendeur" ne doit pas s'allumer sur toutes ses sous-routes.
  return href === "/vendeur" ? chemin === "/vendeur" : chemin.startsWith(href);
}

/**
 * Barre d'onglets fixée en bas — la zone atteignable au pouce. Masquée à
 * partir de `md` : sur un écran large, une barre collée en bas de fenêtre est
 * loin du contenu et n'a pas de sens à la souris.
 *
 * Icône AU-DESSUS du libellé : c'est la forme qu'un téléphone a apprise à tout
 * le monde, et elle laisse le libellé entier à 75 px de large. L'icône se
 * reconnaît du coin de l'œil, le libellé lève le doute.
 */
export function NavigationMobile({
  compteurs,
  stockLie = false,
}: {
  compteurs: Compteurs;
  stockLie?: boolean;
}) {
  const chemin = usePathname();
  const liste = onglets(stockLie);

  return (
    // Pleine largeur : le conteneur de page n'a plus de plafond, une barre
    // centrée à 672 px serait décalée par rapport au contenu entre 672 et
    // 768 px de large.
    // `pb-[env(safe-area-inset-bottom)]` : installée, l'application n'a plus
    // de barre système sous elle, et la barre de geste d'iOS recouvrait le bas
    // des onglets.
    <nav
      aria-label="Navigation principale"
      className="bg-background/95 fixed inset-x-0 bottom-0 z-10 flex w-full border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {liste.map((onglet) => {
        const actif = estActif(chemin, onglet.href);
        const compteur = compteurs[onglet.href] ?? 0;
        const Icone = onglet.icone;
        return (
          <Link
            key={onglet.href}
            href={onglet.href}
            aria-current={actif ? "page" : undefined}
            className={cn(
              // min-h-14 : cible tactile confortable, au-delà des 44 px minimum.
              // Cinq onglets tiennent : ~75 px chacun sur un écran de 375 px.
              // La bordure haute est TOUJOURS là (transparente au repos) : sans
              // elle, l'onglet actif descendait de 2 px par rapport aux autres.
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 text-xs font-medium transition-colors",
              actif
                ? "text-primary border-primary"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            <span className="relative">
              <Icone className="size-5" strokeWidth={actif ? 2.25 : 1.75} />
              {compteur > 0 && (
                <Badge
                  variant="destructive"
                  className="bg-destructive absolute -top-1.5 -right-3 h-4 min-w-4 justify-center px-1 text-[0.625rem] text-white tabular-nums"
                >
                  {compteur}
                </Badge>
              )}
            </span>
            {onglet.libelle}
          </Link>
        );
      })}
    </nav>
  );
}

/** Navigation en ligne dans l'en-tête, à partir de `md` seulement. */
export function NavigationBureau({
  compteurs,
  stockLie = false,
}: {
  compteurs: Compteurs;
  stockLie?: boolean;
}) {
  const chemin = usePathname();
  const liste = onglets(stockLie);

  return (
    <nav
      aria-label="Navigation principale"
      className="hidden items-center gap-1 md:flex"
    >
      {liste.map((onglet) => {
        const actif = estActif(chemin, onglet.href);
        const compteur = compteurs[onglet.href] ?? 0;
        const Icone = onglet.icone;
        return (
          <Link
            key={onglet.href}
            href={onglet.href}
            aria-current={actif ? "page" : undefined}
            className={cn(
              // `min-h-9` : même hauteur que les entrées de la barre latérale
              // de gestion. Ce sont deux cibles à la souris, dans deux espaces
              // de la même application ; rien ne justifiait deux valeurs.
              "flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
              actif
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Icone className="size-4" />
            {onglet.libelle}
            {compteur > 0 && <Badge variant="destructive">{compteur}</Badge>}
          </Link>
        );
      })}
    </nav>
  );
}
