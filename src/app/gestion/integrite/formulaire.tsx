"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction } from "@/lib/types";

import { reinitialiserDonnees } from "./actions";

/**
 * Vider les données d'exploitation.
 *
 * LA CONFIRMATION EST LE NOMBRE DE LIGNES à effacer, pas une phrase fixe.
 *
 * Une phrase littérale s'apprend par cœur et vaut sur toutes les instances :
 * on la tape en croyant être sur la base d'essai. Le total, lui, diffère d'une
 * instance à l'autre ET change dans le temps sur la même. Il ne se mémorise
 * pas, et l'obtenir oblige à lire l'inventaire juste au-dessus, c'est-à-dire à
 * regarder ce qu'on s'apprête à détruire.
 *
 * L'ORDRE DES VERROUS. `est_dev()`, en base, est le seul verrou
 * d'autorisation. Cette confirmation n'en est pas un : sa valeur est affichée
 * à l'écran. C'est un garde-fou contre l'erreur de contexte, et le présenter
 * autrement donnerait une fausse assurance.
 *
 * Le bouton désactivé tant que la saisie ne correspond pas n'est QUE du
 * confort : `reinitialiser_donnees` recompte le total elle-même et refuse
 * indépendamment de ce que l'écran a affiché.
 */
export function BoutonReinitialiser({
  inventaire,
}: {
  inventaire: { libelle: string; lignes: number }[];
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    reinitialiserDonnees,
    {},
  );
  const [saisie, setSaisie] = useState("");

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  const total = inventaire.reduce((s, l) => s + l.lignes, 0);

  return (
    <DialogueAction
      libelle="Réinitialiser les données"
      variante="destructive"
      titre="Vider les données d'exploitation ?"
      description="Les comptes, les invitations et les blocages d'adresses ne sont pas touchés. Tout le reste est effacé et ne se récupère que par une sauvegarde."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        {/* Le décompte réel, pas une formule vague : « 12 mouvements » arrête
            quelqu'un que « toutes les données » laisserait passer. */}
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">
            Ce qui sera effacé ({total} ligne{total > 1 ? "s" : ""})
          </p>
          <ul className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
            {inventaire.map((l) => (
              <li key={l.libelle} className="flex justify-between gap-2">
                <span>{l.libelle}</span>
                <span className="tabular-nums">{l.lignes}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">Ce qui est conservé</p>
          <ul className="text-muted-foreground list-inside list-disc text-xs">
            <li>les comptes et leurs mots de passe</li>
            <li>les invitations en attente</li>
            <li>les adresses IP bloquées, pour ne pas rouvrir un accès fermé</li>
            <li>
              le journal d&apos;administration, où cette remise à zéro sera
              inscrite avec ses décomptes
            </li>
          </ul>
        </div>

        {total === 0 && (
          <Alert>
            <AlertDescription>
              Rien à effacer : cette base ne contient aucune donnée
              d&apos;activité.
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertDescription className="text-xs">
            Une sauvegarde quotidienne existe (voir <code>exploitation.md</code>
            ), mais elle date au pire de la veille. Rien n&apos;est sauvegardé
            au moment du clic.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="confirmation">
            Saisir <code className="font-mono">{total}</code>, le nombre de
            lignes que cette base va perdre
          </Label>
          <Input
            id="confirmation"
            name="confirmation"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder={String(total)}
          />
          <p className="text-muted-foreground text-xs">
            Ce nombre est propre à cette base et change à chaque écriture. Il
            ne vaut pas sur une autre instance.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button
            type="submit"
            variant="destructive"
            disabled={enCours || total === 0 || saisie.trim() !== String(total)}
          >
            {enCours ? "Effacement…" : "Effacer les données"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}
