"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { euros } from "@/lib/format";
import type { EtatAction, LigneStock, TarifPreleve } from "@/lib/types";

import { enregistrerPrelevement } from "../actions";

/**
 * Prendre de la marchandise pour soi, depuis l'écran où le vendeur voit ce
 * qu'il détient.
 *
 * LE MONTANT EST ANNONCÉ AVANT LA VALIDATION. Un prélèvement crée une dette :
 * la faire découvrir après coup sur l'écran des comptes serait la pire des
 * surprises. Le tarif vient de la base (`tarifs_preleves`), jamais d'un calcul
 * refait ici — le client ne décide pas de ce qu'il doit.
 */
export function FormulairePrelevement({
  stock,
  tarifs,
  classeBouton,
}: {
  stock: LigneStock[];
  tarifs: TarifPreleve[];
  classeBouton?: string;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    enregistrerPrelevement,
    {},
  );
  const [produitId, setProduitId] = useState("");
  const [quantite, setQuantite] = useState("1");

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  const disponibles = stock.filter((l) => l.quantite > 0);
  const tarif = tarifs.find((t) => t.produit_id === produitId);
  const q = Number(quantite);
  const total =
    tarif && Number.isInteger(q) && q > 0 ? tarif.prix_effectif * q : null;
  const choisi = disponibles.find((l) => l.produit_id === produitId);
  const trop = choisi && Number.isInteger(q) && q > choisi.quantite;

  if (disponibles.length === 0) return null;

  return (
    <DialogueAction
      libelle="Prélever pour moi"
      variante="outline"
      classeBouton={classeBouton}
      titre="Prélever pour moi"
      description="La marchandise sort de ton stock et le montant s'ajoute à ce que tu dois. Le tarif est fixé par la gestion."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="produit_id">Produit</Label>
          <select
            id="produit_id"
            name="produit_id"
            required
            value={produitId}
            onChange={(e) => setProduitId(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Choisir…</option>
            {disponibles.map((l) => (
              <option key={l.produit_id} value={l.produit_id}>
                {l.produit} — {l.quantite} en stock
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantite">Quantité</Label>
          <Input
            id="quantite"
            name="quantite"
            type="number"
            min={1}
            max={choisi?.quantite}
            required
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
          />
          {trop && (
            <p className="text-destructive text-xs">
              Tu n&apos;en détiens que {choisi?.quantite}.
            </p>
          )}
        </div>

        {tarif && (
          <div className="bg-muted rounded-md px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tarif unitaire</span>
              <span className="tabular-nums">{euros(tarif.prix_effectif)}</span>
            </div>
            {total !== null && (
              <div className="mt-1 flex justify-between font-medium">
                <span>S&apos;ajoute à ta dette</span>
                <span className="tabular-nums">{euros(total)}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" disabled={enCours || !produitId || trop}>
            {enCours ? "Enregistrement…" : "Prélever"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}
