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

const PHRASE = "REINITIALISER";

/**
 * Vider les données d'exploitation.
 *
 * DEUX CONFIRMATIONS, et la seconde n'est pas un second clic.
 *
 * Un second bouton se clique aussi vite que le premier : l'enchaînement
 * devient un réflexe, et le geste passe sans être lu. La saisie d'une phrase
 * exacte oblige à s'arrêter, à lire ce qui est écrit au-dessus, et rend
 * impossible le déclenchement par un clic mal placé ou un double-clic.
 *
 * Le bouton reste désactivé tant que la phrase n'est pas exacte, mais ce n'est
 * QUE du confort : c'est la base qui refuse, `reinitialiser_donnees` exigeant
 * la même phrase. Un contrôle côté client seul serait contournable par un
 * appel direct.
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

        <Alert>
          <AlertDescription className="text-xs">
            Une sauvegarde quotidienne existe (voir <code>exploitation.md</code>
            ), mais elle date au pire de la veille. Rien n&apos;est sauvegardé
            au moment du clic.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="confirmation">
            Saisir <code className="font-mono">{PHRASE}</code> pour confirmer
          </Label>
          <Input
            id="confirmation"
            name="confirmation"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={PHRASE}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button
            type="submit"
            variant="destructive"
            disabled={enCours || saisie !== PHRASE}
          >
            {enCours ? "Effacement…" : "Effacer les données"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}
