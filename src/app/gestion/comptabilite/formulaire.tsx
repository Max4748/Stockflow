"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { euros } from "@/lib/format";
import type { EtatAction } from "@/lib/types";

import { annulerVente } from "../actions";

export function BoutonAnnulerVente({
  venteId,
  libelle,
  montant,
}: {
  venteId: string;
  libelle: string;
  montant: number | null;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    annulerVente,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    // Le refus « des ventes postérieures ont figé un coût qui dépend de
    // celle-ci » est un comportement NORMAL du schéma, pas une panne : on
    // affiche le message tel quel, il oriente vers un ajustement motivé.
    if (etat.erreur) toast.error(etat.erreur, { duration: 10000 });
  }, [etat.succes, etat.erreur, etat.jeton]);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="w-full md:w-auto">
            Annuler
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annuler cette vente ?</DialogTitle>
          <DialogDescription>
            {libelle}
            {montant !== null && ` — ${euros(montant)}`}. Le stock sera restitué
            au vendeur et sa dette diminuera d&apos;autant.
            <br />
            <br />
            L&apos;annulation sera refusée si des ventes postérieures ont figé
            un coût de revient qui dépend de celle-ci — dans ce cas, passer par
            un ajustement de stock motivé.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Conserver</Button>} />
          <form action={action}>
            <input type="hidden" name="vente_id" value={venteId} />
            <Button type="submit" variant="destructive" disabled={enCours}>
              {enCours ? "Annulation…" : "Annuler la vente"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
