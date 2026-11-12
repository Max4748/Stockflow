import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EtatVide } from "@/components/etat-vide";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { lireTri, trier, type Tri } from "@/lib/tri";
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
 * LE TRI est arrivé quand les listes sont devenues longues (créances, ventes
 * d'un vendeur, stock). Il est piloté par l'URL (`?tri=…&ordre=…`) et appliqué
 * ici, côté serveur : les colonnes portent des fonctions, qui ne traversent
 * pas la frontière serveur → client, donc ce composant ne peut pas devenir un
 * composant client sans y entraîner chaque écran. Voir `lib/tri.ts`.
 *
 * Une colonne est triable dès qu'elle déclare `tri`, et le tableau dès qu'il
 * reçoit `tri`. Sans l'un ou l'autre, rien ne change.
 *
 * À NE PAS gonfler davantage : pas de sélection ici, et la pagination est un
 * composant à part (`pagination.tsx`) posé sous le tableau. La
 * recherche est un composant à part (`champ-recherche.tsx`), parce qu'elle
 * filtre les données AVANT le tableau. Un écran aux exigences très différentes
 * écrit son propre tableau plutôt que d'ajouter des options ici.
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
  /**
   * Valeur BRUTE à comparer pour trier : un nombre ou un texte, pas le rendu.
   * `valeur` renvoie du JSX (« 1 234,00 € », une pastille), qui ne se compare
   * pas. Absente, la colonne n'est pas triable.
   */
  tri?: (ligne: T) => string | number | null | undefined;
  /**
   * Colonne SQL à passer à `order` quand le tri est fait EN BASE (liste
   * paginée, voir `TriTableau.dejaTrie`). Rend la colonne triable au même
   * titre que `tri`.
   */
  colonneSql?: string;
};

/**
 * Ce qu'il faut pour fabriquer les liens de tri : les paramètres courants de
 * la page (ils sont tous conservés, sauf `page`) et son chemin. `prefixe`
 * distingue deux tableaux triables sur un même écran (`ctri`, `cordre`…).
 */
export type TriTableau = {
  params: Record<string, string | undefined>;
  chemin: string;
  prefixe?: string;
  /**
   * Les lignes arrivent déjà triées par la requête. C'est le cas des listes
   * PAGINÉES : trier ici ne trierait que la page affichée. Les en-têtes
   * restent des liens, mais ce composant ne touche plus à l'ordre.
   */
  dejaTrie?: boolean;
};

function lienTri(tri: TriTableau, cle: string, actif: Tri | null): string {
  const prefixe = tri.prefixe ?? "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(tri.params)) {
    // Changer de tri repart de la première page de CE tableau.
    if (v && k !== "page" && k !== `${prefixe}page`) p.set(k, v);
  }
  p.set(`${prefixe}tri`, cle);
  // Premier clic : croissant. Second clic sur la même colonne : décroissant.
  if (actif?.cle === cle && actif.ordre === "asc") p.set(`${prefixe}ordre`, "desc");
  else p.delete(`${prefixe}ordre`);
  return `${tri.chemin}?${p.toString()}`;
}

type Props<T> = {
  colonnes: Colonne<T>[];
  lignes: T[];
  cle: (ligne: T) => string;
  /** Message affiché quand il n'y a rien à montrer. */
  vide?: string;
  /** Action éventuelle rendue en pied de chaque carte / dernière cellule. */
  action?: (ligne: T) => ReactNode;
  /** Active le tri par l'URL sur les colonnes qui déclarent `tri`. */
  tri?: TriTableau;
};

export function Tableau<T>({
  colonnes,
  lignes: lignesRecues,
  cle,
  vide = "Aucune donnée.",
  action,
  tri,
}: Props<T>) {
  const triActif = tri ? lireTri(tri.params, tri.prefixe) : null;
  const triable = (c: Colonne<T>) =>
    Boolean(tri && (tri.dejaTrie ? c.colonneSql : c.tri));
  const colonneTriee = colonnes.find(
    (c) => c.cle === triActif?.cle && triable(c),
  );
  const lignes =
    colonneTriee && !tri?.dejaTrie
      ? trier(lignesRecues, colonneTriee.tri, triActif!.ordre)
      : lignesRecues;
  const triables = colonnes.filter(triable);

  if (lignes.length === 0) {
    return <EtatVide titre={vide} />;
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
                  className={cn(
                    // En-têtes en retrait : petites capitales grises, comme les
                    // libellés des indicateurs. Ce sont des étiquettes, les
                    // données doivent dominer.
                    "text-muted-foreground text-xs font-medium tracking-wide uppercase",
                    c.alignement === "droite" && "text-right",
                  )}
                  aria-sort={
                    colonneTriee === c
                      ? triActif!.ordre === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {tri && triable(c) ? (
                    <Link
                      href={lienTri(tri, c.cle, triActif)}
                      // `scroll={false}` : trier ne doit pas renvoyer en haut
                      // de page, on perdrait le tableau qu'on vient de trier.
                      scroll={false}
                      className={cn(
                        "hover:text-foreground -my-1 inline-flex items-center gap-1 rounded-sm py-1 transition-colors",
                        c.alignement === "droite" && "flex-row-reverse",
                        colonneTriee === c && "text-primary",
                      )}
                    >
                      {c.entete}
                      {colonneTriee !== c ? (
                        <ArrowUpDownIcon className="size-3 opacity-50" />
                      ) : triActif!.ordre === "asc" ? (
                        <ArrowUpIcon className="size-3" />
                      ) : (
                        <ArrowDownIcon className="size-3" />
                      )}
                    </Link>
                  ) : (
                    c.entete
                  )}
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
      {/* Les cartes n'ont pas d'en-têtes de colonnes : le tri y passe par une
          rangée de pastilles, qui défile si elle déborde. */}
      {triables.length > 0 && (
        <div className="-mx-1 mb-3 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 md:hidden">
          <span className="text-muted-foreground shrink-0 text-xs">Trier :</span>
          {triables.map((c) => (
            <Link
              key={c.cle}
              href={lienTri(tri!, c.cle, triActif)}
              scroll={false}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium",
                colonneTriee === c
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "text-muted-foreground",
              )}
            >
              {c.entete}
              {colonneTriee === c &&
                (triActif!.ordre === "asc" ? (
                  <ArrowUpIcon className="size-3" />
                ) : (
                  <ArrowDownIcon className="size-3" />
                ))}
            </Link>
          ))}
        </div>
      )}

      <ul className="space-y-3 md:hidden">
        {lignes.map((ligne) => (
          <li key={cle(ligne)}>
            <Card>
              <CardContent className="space-y-2.5">
                <p className="font-medium">{principale.valeur(ligne)}</p>
                <dl className="space-y-1.5 text-sm">
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
                {action && (
                  <div className="border-t pt-3">{action(ligne)}</div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
