"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EtatAction, LigneStockEntrepot } from "@/lib/types";

import { annulerDemande, demanderRestock } from "../actions";

export function FormulaireRestock({
  produits,
  classeBouton,
}: {
  produits: LigneStockEntrepot[];
  /** Mise en page du déclencheur — voir DialogueAction. */
  classeBouton?: string;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    demanderRestock,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  if (produits.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Aucun produit au catalogue pour le moment.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <DialogueAction
      libelle="Demander un réassort"
      variante="default"
      classeBouton={classeBouton}
      // `large` : la grille des produits de l'entrepôt tient mal dans le
      // gabarit standard.
      taille="large"
      titre="Demander un réassort"
      description="Le stock affiché est celui de l'entrepôt à cet instant. Le gérant peut n'accorder qu'une partie de ce qui est demandé."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        {/* Remontage par `key` à chaque succès : réinitialise les quantités sans
            setState dans un effet. */}
        <ChampsRestock
          key={etat.jeton ?? "initial"}
          produits={produits}
          erreur={etat.erreur}
          enCours={enCours}
        />
      </form>
    </DialogueAction>
  );
}

function ChampsRestock({
  produits,
  erreur,
  enCours,
}: {
  produits: LigneStockEntrepot[];
  erreur?: string;
  enCours: boolean;
}) {
  // Une quantité par produit. Vide ou 0 = non demandé.
  const [quantites, setQuantites] = useState<Record<string, string>>({});

  const nbDemandes = Object.values(quantites).filter(
    (v) => Number(v) > 0,
  ).length;

  return (
    <>
      <Card>
        <CardContent className="space-y-4 pt-5">
          <p className="text-muted-foreground text-sm">
            Indiquer les quantités souhaitées. L&apos;administrateur peut
            accorder tout, une partie seulement, ou refuser.
          </p>

          {/* Tuiles : en pleine largeur, une liste mettrait le nom du produit
              à un bout et son champ de saisie à l'autre. */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {produits.map((p) => {
              const demande = Number(quantites[p.produit_id]) > 0;
              return (
                <li
                  key={p.produit_id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <Label
                      htmlFor={`qte-${p.produit_id}`}
                      className="truncate text-sm font-normal"
                    >
                      {p.produit}
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      {p.quantite} en entrepôt
                    </p>
                  </div>
                  <div className="shrink-0">
                    {/* Les champs ne portent un `name` que si une quantité est
                        saisie : les lignes vides ne sont donc pas soumises, et
                        les deux tableaux produit_id[]/quantite[] restent
                        alignés côté serveur. */}
                    {demande && (
                      <input
                        type="hidden"
                        name="produit_id"
                        value={p.produit_id}
                      />
                    )}
                    <Input
                      id={`qte-${p.produit_id}`}
                      {...(demande ? { name: "quantite" } : {})}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="0"
                      value={quantites[p.produit_id] ?? ""}
                      onChange={(e) =>
                        setQuantites((q) => ({
                          ...q,
                          [p.produit_id]: e.target.value,
                        }))
                      }
                      className="h-11 w-20 text-center text-base"
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="space-y-2 md:max-w-2xl">
            <Label htmlFor="note">Précision (facultatif)</Label>
            <Textarea
              id="note"
              name="note"
              rows={2}
              placeholder="Rupture prévue ce week-end…"
              className="text-base"
            />
          </div>
        </CardContent>
      </Card>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      {/* Même taille que « Annuler », comme dans tous les dialogues du projet :
          la hauteur de 56 px appartient au déclencheur, pas au pied de page. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose render={<Button variant="outline">Annuler</Button>} />
        <Button type="submit" disabled={enCours || nbDemandes === 0}>
          {enCours
            ? "Envoi…"
            : nbDemandes === 0
              ? "Saisir au moins une quantité"
              : `Envoyer la demande (${nbDemandes} produit${nbDemandes > 1 ? "s" : ""})`}
        </Button>
      </div>
    </>
  );
}

export function BoutonAnnuler({ demandeId }: { demandeId: string }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    annulerDemande,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  return (
    <form action={action}>
      <input type="hidden" name="demande_id" value={demandeId} />
      <Button
        type="submit"
        variant="outline"
        className="h-11 w-full"
        disabled={enCours}
      >
        {enCours ? "Annulation…" : "Annuler cette demande"}
      </Button>
    </form>
  );
}
