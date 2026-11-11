"use client";

import {
  ActivityIcon,
  BookOpenIcon,
  BoxesIcon,
  HistoryIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  type LucideIcon,
  MenuIcon,
  ShieldCheckIcon,
  TagsIcon,
  TruckIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Compteurs } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Navigation de l'espace admin : neuf entrées, contre cinq côté vendeur. D'où
 * la barre latérale plutôt qu'une barre en haut : les libellés restent
 * lisibles, et ajouter une entrée ne serre rien.
 *
 * Une seule définition des sections, deux rendus :
 *   - `lg` et au-delà : colonne fixe à gauche ;
 *   - en dessous : la même liste dans un tiroir.
 */

type Entree = { href: string; libelle: string; icone: LucideIcon };

/**
 * `niveauMinimum` : le groupe n'apparaît qu'au-delà. Le groupe Technique est à
 * 3 (dev) — la page Intégrité parle d'invariants d'agrégats et de verrous, elle
 * n'a rien à faire sous les yeux d'un gérant, et la gestion des comptes
 * d'encadrement ne le concerne pas.
 */
const GROUPES: { titre: string; niveauMinimum?: number; entrees: Entree[] }[] =
  [
    {
      titre: "Pilotage",
      entrees: [
        { href: "/gestion", libelle: "Bilan", icone: LayoutDashboardIcon },
        { href: "/gestion/demandes", libelle: "Demandes", icone: InboxIcon },
      ],
    },
    {
      titre: "Stock",
      entrees: [
        { href: "/gestion/stock", libelle: "État du stock", icone: BoxesIcon },
        { href: "/gestion/produits", libelle: "Produits", icone: TagsIcon },
        { href: "/gestion/achats", libelle: "Restock", icone: TruckIcon },
        { href: "/gestion/sav", libelle: "SAV", icone: LifeBuoyIcon },
      ],
    },
    {
      titre: "Comptabilité",
      entrees: [
        { href: "/gestion/vendeurs", libelle: "Vendeurs", icone: UsersIcon },
        { href: "/gestion/comptabilite", libelle: "Journal", icone: BookOpenIcon },
      ],
    },
    {
      titre: "Technique",
      niveauMinimum: 3,
      entrees: [
        { href: "/gestion/comptes", libelle: "Comptes gérants", icone: UserCogIcon },
        { href: "/gestion/journal-admin", libelle: "Journal admin", icone: HistoryIcon },
        { href: "/gestion/integrite", libelle: "Intégrité", icone: ActivityIcon },
      ],
    },
    // Sans `niveauMinimum` : la double authentification concerne le compte de
    // celui qui la lit, pas le métier. Un gérant en a autant besoin qu'un dev,
    // davantage même — c'est lui qui voit les marges au quotidien.
    {
      titre: "Compte",
      entrees: [{ href: "/gestion/securite", libelle: "Sécurité", icone: ShieldCheckIcon }],
    },
  ];

function estActif(chemin: string, href: string) {
  // "/gestion" ne doit pas s'allumer sur toutes ses sous-routes.
  return href === "/gestion" ? chemin === "/gestion" : chemin.startsWith(href);
}

function Liens({
  chemin,
  compteurs,
  niveau,
  onNavigate,
}: {
  chemin: string;
  compteurs: Compteurs;
  niveau: number;
  onNavigate?: () => void;
}) {
  // Masquer une entrée n'est PAS une mesure de sécurité : chaque page réservée
  // appelle exigerDev(), et chaque RPC vérifie le niveau en base. Ici on évite
  // seulement de montrer au gérant des écrans qui le laisseraient perplexe.
  const groupes = GROUPES.filter((g) => niveau >= (g.niveauMinimum ?? 0));

  return (
    <nav aria-label="Navigation de gestion" className="space-y-6">
      {groupes.map((groupe) => (
        <div key={groupe.titre}>
          {/* `pb-1.5` : le titre doit coller à SES entrées. C'est le rapport
              entre les trois espacements qui fait lire un groupe, pas leur
              valeur absolue — titre le plus serré, entrées entre elles au
              milieu, groupes le plus large. */}
          <p className="text-muted-foreground px-3 pb-1.5 text-xs font-medium tracking-wide uppercase">
            {groupe.titre}
          </p>
          <ul className="space-y-0.5">
            {groupe.entrees.map((entree) => {
              const actif = estActif(chemin, entree.href);
              // Ce qui attend une décision doit se voir sans naviguer : une
              // demande de réassort bloque un vendeur sur le terrain, un
              // remboursement en attente bloque sa dette.
              const compteur = compteurs[entree.href] ?? 0;

              return (
                <li key={entree.href}>
                  <Link
                    href={entree.href}
                    onClick={onNavigate}
                    aria-current={actif ? "page" : undefined}
                    className={cn(
                      // `min-h-11` (44 px) est une cible tactile, nécessaire
                      // dans le tiroir, qui n'existe qu'en dessous de `lg`.
                      // La barre latérale, elle, ne se voit qu'à partir de
                      // `lg` et se pilote à la souris : 44 px y écartaient
                      // tellement les entrées qu'un groupe ne se distinguait
                      // plus du groupe suivant.
                      "flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors lg:min-h-9",
                      // Même état actif que la navigation vendeur au bureau :
                      // aplat primaire dilué, texte et icône à la couleur
                      // primaire. Deux espaces, une seule façon de dire
                      // « vous êtes ici ».
                      actif
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    <entree.icone className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{entree.libelle}</span>
                    {compteur > 0 && (
                      <Badge variant="destructive">{compteur}</Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Colonne fixe, à partir de `lg`. */
export function BarreLaterale({
  compteurs,
  niveau,
}: {
  compteurs: Compteurs;
  niveau: number;
}) {
  const chemin = usePathname();

  return (
    <aside className="bg-sidebar hidden w-60 shrink-0 border-r lg:block">
      <div className="sticky top-0 max-h-dvh overflow-y-auto px-2 pb-4">
        {/* La marque vit ICI à partir de `lg`, et dans l'en-tête en dessous :
            elle est toujours dans le coin haut gauche de l'écran, là où l'œil
            la cherche. `h-16` : la même hauteur que l'en-tête voisin, pour que
            leurs deux filets du bas se prolongent. */}
        <Link
          href="/gestion"
          className="mb-3 flex h-16 items-center gap-2.5 px-3 font-semibold"
        >
          <Logo />
          StockFlow
        </Link>
        <Liens chemin={chemin} compteurs={compteurs} niveau={niveau} />
      </div>
    </aside>
  );
}

/** Bouton + tiroir, en dessous de `lg`. */
export function TiroirNavigation({
  compteurs,
  niveau,
}: {
  compteurs: Compteurs;
  niveau: number;
}) {
  const chemin = usePathname();
  const [ouvert, setOuvert] = useState(false);

  // Le tiroir masque la barre latérale : sans total sur son bouton, rien ne
  // signalerait une décision en attente sur un écran étroit.
  const total = Object.values(compteurs).reduce((s, n) => s + n, 0);

  return (
    <Sheet open={ouvert} onOpenChange={setOuvert}>
      {/* Icône seule, pas le mot « Menu » : le bouton vit dans un en-tête déjà
          chargé (titre, rôle, bascule d'espace, thème, déconnexion) et un
          libellé de plus y ajoutait de la largeur sans rien apprendre. Le
          `aria-label` porte l'information pour les lecteurs d'écran, qui la
          perdraient sinon.

          La pastille reste : sans elle, rien ne signalerait une décision en
          attente sur un écran où la barre latérale est masquée. Positionnée en
          absolu sur le coin, elle ne déforme plus le bouton. */}
      <SheetTrigger
        render={
          <Button
            // `ghost` et non `outline` : le bouton de thème voisin est en
            // ghost, et deux traitements différents dans le même en-tête se
            // voyaient. L'icône se suffit, le cadre n'ajoutait rien.
            variant="ghost"
            size="icon"
            aria-label={
              total > 0
                ? `Ouvrir le menu, ${total} en attente`
                : "Ouvrir le menu"
            }
            // `size-10` et non le `size-8` par défaut de la variante `icon` :
            // ce bouton est le SEUL point de navigation en dessous de `lg`, et
            // 32 px est sous le minimum tactile. Le bouton de thème voisin peut
            // rester petit, le manquer ne coûte qu'un second essai.
            className="relative size-10 lg:hidden"
          >
            <MenuIcon className="size-5" />
            {total > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1.5 -right-1.5 min-w-5 justify-center px-1 tabular-nums"
              >
                {total}
              </Badge>
            )}
          </Button>
        }
      />
      <SheetContent side="left" className="w-72 px-2 py-4">
        <SheetHeader className="px-3 pb-4">
          <SheetTitle className="flex items-center gap-2.5">
            <Logo />
            StockFlow
          </SheetTitle>
        </SheetHeader>
        {/* Refermer le tiroir après un clic : sans ça il masquerait la page
            vers laquelle on vient de naviguer. */}
        <Liens
          chemin={chemin}
          compteurs={compteurs}
          niveau={niveau}
          onNavigate={() => setOuvert(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
