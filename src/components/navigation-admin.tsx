"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Navigation de l'espace admin : 8 sections, contre 4 côté vendeur. D'où la
 * barre latérale plutôt qu'une barre en haut — les libellés restent lisibles,
 * et ajouter une section ne serre rien.
 *
 * Une seule définition des sections, deux rendus :
 *   - `lg` et au-delà : colonne fixe à gauche ;
 *   - en dessous : la même liste dans un tiroir.
 */

type Entree = { href: string; libelle: string };

/**
 * Compteurs affichés en pastille, par chemin.
 *
 * Un dictionnaire plutôt qu'une prop par compteur : chaque nouvelle file
 * d'attente ajouterait sinon une prop à traverser trois composants.
 */
export type Compteurs = Record<string, number>;

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
        { href: "/gestion", libelle: "Bilan" },
        { href: "/gestion/demandes", libelle: "Demandes" },
      ],
    },
    {
      titre: "Stock",
      entrees: [
        { href: "/gestion/stock", libelle: "État du stock" },
        { href: "/gestion/produits", libelle: "Produits" },
        { href: "/gestion/achats", libelle: "Restock" },
        { href: "/gestion/sav", libelle: "SAV" },
      ],
    },
    {
      titre: "Comptabilité",
      entrees: [
        { href: "/gestion/vendeurs", libelle: "Vendeurs" },
        { href: "/gestion/comptabilite", libelle: "Journal" },
      ],
    },
    {
      titre: "Technique",
      niveauMinimum: 3,
      entrees: [
        { href: "/gestion/comptes", libelle: "Comptes gérants" },
        { href: "/gestion/integrite", libelle: "Intégrité" },
      ],
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
    <nav className="space-y-6">
      {groupes.map((groupe) => (
        <div key={groupe.titre}>
          <p className="text-muted-foreground px-3 pb-1 text-xs font-medium tracking-wide uppercase">
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
                      // min-h-11 : cible tactile confortable dans le tiroir.
                      "flex min-h-11 items-center justify-between gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                      actif
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                  >
                    <span>{entree.libelle}</span>
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
    <aside className="bg-muted/20 hidden w-60 shrink-0 border-r lg:block">
      <div className="sticky top-0 max-h-dvh overflow-y-auto px-2 py-4">
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
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="lg:hidden">
            Menu
            {total > 0 && (
              <Badge variant="destructive" className="ml-1">
                {total}
              </Badge>
            )}
          </Button>
        }
      />
      <SheetContent side="left" className="w-72 px-2 py-4">
        <SheetHeader className="px-3 pb-2">
          <SheetTitle>Gestion</SheetTitle>
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
