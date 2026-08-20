"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction, Produit } from "@/lib/types";

import { enregistrerProduit } from "../actions";

/**
 * Création ou modification d'un produit, dans un dialogue.
 *
 * `produit` fourni = édition. Une seule implémentation pour les deux cas : le
 * formulaire est identique, seuls le libellé du bouton et la présence d'un
 * champ `id` caché changent.
 *
 * Le dialogue se ferme après un succès grâce au `jeton` passé en `key` à
 * DialogueAction — pas de setState dans un effet.
 */
export function DialogueProduit({ produit }: { produit?: Produit }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    enregistrerProduit,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  const cle = produit?.id ?? "new";

  return (
    <DialogueAction
      libelle={produit ? "Modifier" : "Nouveau produit"}
      variante={produit ? "outline" : "default"}
      tailleBouton={produit ? "sm" : undefined}
      titre={produit ? `Modifier ${produit.nom}` : "Nouveau produit"}
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        {produit && <input type="hidden" name="id" value={produit.id} />}

        <div className="space-y-2">
          <Label htmlFor={`nom-${cle}`}>Nom</Label>
          <Input
            id={`nom-${cle}`}
            name="nom"
            defaultValue={produit?.nom ?? ""}
            className="h-11 text-base"
            required
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor={`sku-${cle}`}>SKU (facultatif)</Label>
            <Input
              id={`sku-${cle}`}
              name="sku"
              defaultValue={produit?.sku ?? ""}
              className="h-11 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`prix-${cle}`}>Prix conseillé</Label>
            <Input
              id={`prix-${cle}`}
              name="prix_vente_conseille"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              defaultValue={produit?.prix_vente_conseille ?? 0}
              className="h-11 text-base"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`seuil-${cle}`}>Seuil d&apos;alerte</Label>
            <Input
              id={`seuil-${cle}`}
              name="seuil_alerte"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={produit?.seuil_alerte ?? 3}
              className="h-11 text-base"
              required
            />
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          Le prix conseillé est indicatif : celui pratiqué est figé à chaque
          vente.
        </p>

        <div className="flex items-center gap-2">
          <input
            id={`actif-${cle}`}
            type="checkbox"
            name="actif"
            value="1"
            defaultChecked={produit?.actif ?? true}
            className="size-4"
          />
          <Label htmlFor={`actif-${cle}`} className="font-normal">
            Actif — proposé aux vendeurs à la vente et au réassort
          </Label>
        </div>

        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" disabled={enCours}>
            {enCours
              ? "Enregistrement…"
              : produit
                ? "Enregistrer"
                : "Créer le produit"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}
