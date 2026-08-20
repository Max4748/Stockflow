import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Tableau de données : un vrai <table> sur grand écran, des cartes sur
 * téléphone.
 *
 * Pourquoi un composant partagé plutôt que le motif recopié par écran : sans
 * lui, chaque écran rendrait ses données DEUX fois (une version tableau, une
 * version carte) et les deux divergeraient à la première modification. Ici la
 * définition des colonnes est unique, seule la présentation change.
 *
 * À NE PAS gonfler : pas de tri, de filtres ni de sélection tant qu'un écran
 * n'en a pas réellement besoin. Un écran aux exigences très différentes écrit
 * son propre tableau plutôt que d'ajouter des options ici.
 */

export type Colonne<T> = {
  cle: string;
  entete: string;
  valeur: (ligne: T) => ReactNode;
  /** `droite` pour les nombres — ajoute aussi tabular-nums. */
  alignement?: "gauche" | "droite";
  /** Sert de titre à la carte sur mobile. Une seule colonne devrait la porter. */
  principale?: boolean;
  /** Colonne utile en tableau mais superflue dans la carte (redondante, technique…). */
  masquerEnCarte?: boolean;
};

type Props<T> = {
  colonnes: Colonne<T>[];
  lignes: T[];
  cle: (ligne: T) => string;
  /** Message affiché quand il n'y a rien à montrer. */
  vide?: string;
  /** Action éventuelle rendue en pied de chaque carte / dernière cellule. */
  action?: (ligne: T) => ReactNode;
};

export function Tableau<T>({
  colonnes,
  lignes,
  cle,
  vide = "Aucune donnée.",
  action,
}: Props<T>) {
  if (lignes.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">{vide}</p>
    );
  }

  const principale = colonnes.find((c) => c.principale) ?? colonnes[0];
  const secondaires = colonnes.filter(
    (c) => c !== principale && !c.masquerEnCarte,
  );

  return (
    <>
      {/* Grand écran : tableau. overflow-x-auto en garde-fou si le contenu
          d'une cellule est plus large que prévu — la page elle-même ne doit
          jamais défiler horizontalement. */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {colonnes.map((c) => (
                <TableHead
                  key={c.cle}
                  className={cn(c.alignement === "droite" && "text-right")}
                >
                  {c.entete}
                </TableHead>
              ))}
              {action && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lignes.map((ligne) => (
              <TableRow key={cle(ligne)}>
                {colonnes.map((c) => (
                  <TableCell
                    key={c.cle}
                    className={cn(
                      c.alignement === "droite" && "text-right tabular-nums",
                      c === principale && "font-medium",
                    )}
                  >
                    {c.valeur(ligne)}
                  </TableCell>
                ))}
                {action && (
                  <TableCell className="text-right">{action(ligne)}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Téléphone : une carte par ligne, chaque colonne devenant un couple
          libellé / valeur. Un tableau qui défile horizontalement au pouce est
          inutilisable. */}
      <ul className="space-y-3 md:hidden">
        {lignes.map((ligne) => (
          <li key={cle(ligne)}>
            <Card>
              <CardContent className="space-y-2 pt-5">
                <p className="font-medium">{principale.valeur(ligne)}</p>
                <dl className="space-y-1 text-sm">
                  {secondaires.map((c) => (
                    <div key={c.cle} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{c.entete}</dt>
                      <dd
                        className={cn(
                          "text-right",
                          c.alignement === "droite" && "tabular-nums",
                        )}
                      >
                        {c.valeur(ligne)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {action && <div className="pt-1">{action(ligne)}</div>}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
