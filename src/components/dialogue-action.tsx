"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Bouton qui ouvre un formulaire d'action dans un dialogue.
 *
 * Motivation : une fiche empilait cinq gros blocs, dont trois n'étaient que des
 * actions ponctuelles. On garde l'information sur la page et on déplace les
 * gestes dans des dialogues — la page redevient lisible d'un coup d'œil.
 *
 * FERMETURE APRÈS SUCCÈS, sans setState dans un effet : le `jeton` renvoyé par
 * l'action change à chaque succès et sert de `key`. React remonte alors le
 * dialogue, qui repart fermé et avec des champs vierges. Passer par un
 * `useEffect` qui appellerait `setOuvert(false)` déclencherait des renders en
 * cascade — ESLint le refuse, et il a raison.
 */
export function DialogueAction({
  libelle,
  icone: Icone,
  titre,
  description,
  jeton,
  variante = "outline",
  taille = "normal",
  tailleBouton,
  classeBouton,
  children,
}: {
  libelle: ReactNode;
  /** Icône du déclencheur : elle fait reconnaître le geste avant de le lire. */
  icone?: LucideIcon;
  titre: string;
  description?: ReactNode;
  /** Change à chaque succès de l'action contenue. */
  jeton?: string;
  /**
   * `default` (plein) pour l'action PRINCIPALE d'une vue — c'est le cas d'un
   * bouton seul dans un en-tête de page. `outline` seulement quand plusieurs
   * actions cohabitent et qu'il faut les départager, comme sur la fiche
   * vendeur où « Encaisser » domine les trois autres.
   */
  variante?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  /** `large` pour un formulaire à plusieurs colonnes (saisie d'un achat). */
  taille?: "normal" | "large";
  /**
   * `sm` pour un déclencheur logé dans une ligne de tableau ; `lg` pour
   * l'action principale d'un espace, saisie debout sur un téléphone (la vente),
   * qui mérite les 56 px de haut de la barre d'onglets — sur téléphone
   * seulement ; à la souris elle reprend 44 px.
   *
   * La hauteur passe par `className` et non par `size` : les tailles du
   * registre shadcn sont petites (`lg` y vaut 36 px), et tout le projet règle
   * déjà ses hauteurs ainsi.
   */
  tailleBouton?: "sm" | "lg";
  /**
   * Ajustement de dernier recours sur le déclencheur — par exemple le forcer en
   * pleine largeur dans une colonne étroite, où le `sm:w-auto` par défaut le
   * rétrécirait. À n'utiliser que pour la mise en page : la taille et la
   * variante restent gouvernées par les props ci-dessus.
   */
  classeBouton?: string;
  children: ReactNode;
}) {
  return (
    <Dialog key={jeton ?? "initial"}>
      <DialogTrigger
        render={
          <Button
            variant={variante}
            size={tailleBouton === "sm" ? "sm" : undefined}
            className={cn(
              tailleBouton === "sm"
                ? "shrink-0"
                : tailleBouton === "lg"
                  ? "h-14 w-full gap-2 text-base sm:h-11 sm:w-auto sm:px-6"
                  : // 44 px au doigt, 40 px à la souris : la même paire sur
                    // TOUS les boutons d'en-tête de page.
                    "h-11 w-full sm:h-10 sm:w-auto",
              classeBouton,
            )}
          >
            {Icone && <Icone />}
            {libelle}
          </Button>
        }
      />
      {/* Hauteur bornée et défilement interne : un formulaire dans un dialogue
          sur un téléphone dépasse sinon l'écran, bouton de validation compris. */}
      <DialogContent
        className={
          taille === "large"
            ? "max-h-[85dvh] overflow-y-auto sm:max-w-3xl"
            : "max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        }
      >
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
