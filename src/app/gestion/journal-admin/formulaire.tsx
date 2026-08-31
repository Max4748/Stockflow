"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction } from "@/lib/types";

import { bloquerIpDefinitivement, leverBlocageIp } from "./actions";

/** Rend l'accès immédiatement, sans confirmation : le geste est réversible. */
export function BoutonLeverBlocage({ ip }: { ip: string }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    leverBlocageIp,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="ip" value={ip} />
      <Button type="submit" variant="ghost" size="sm" disabled={enCours}>
        {enCours ? "Levée…" : "Lever"}
      </Button>
    </form>
  );
}

/**
 * Le seul chemin vers un blocage sans échéance.
 *
 * Sous dialogue, avec motif obligatoire, contrairement à la levée : les
 * blocages automatiques expirent tous, et retirer cette échéance est la seule
 * décision de cet écran qui ne se défait pas toute seule.
 */
export function BoutonBloquerDefinitivement({ ip }: { ip: string }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    bloquerIpDefinitivement,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Bloquer sans échéance"
      tailleBouton="sm"
      titre={`Bloquer ${ip} définitivement ?`}
      description="Les blocages automatiques expirent, et c'est voulu : une adresse IP change de main. Retirer l'échéance n'a de sens que si tu sais à qui elle appartient."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="ip" value={ip} />
        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor={`motif-${ip}`}>Motif</Label>
          <Input
            id={`motif-${ip}`}
            name="motif"
            required
            autoFocus
            placeholder="Ce qui rendra cette ligne compréhensible dans six mois"
          />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" variant="destructive" disabled={enCours}>
            {enCours ? "Blocage…" : "Bloquer"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}
