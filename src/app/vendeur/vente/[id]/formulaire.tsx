"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { ChampSelect } from "@/components/champ-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { euros } from "@/lib/format";
import type { EtatAction } from "@/lib/types";

import { annulerMaVente, modifierVente } from "../../actions";

type ProduitVendable = {
  produit_id: string;
  produit: string;
  quantite: number;
  prix_conseille: number;
};

type LigneInitiale = {
  produit_id: string;
  quantite: number;
  prix_vente_unitaire: number;
  produit: string;
};

type Ligne = {
  cle: number;
  produit_id: string;
  quantite: string;
  prix: string;
};

export function FormulaireCorrection({
  venteId,
  client,
  date,
  produits,
  lignesInitiales,
}: {
  venteId: string;
  client: string;
  date: string;
  produits: ProduitVendable[];
  lignesInitiales: LigneInitiale[];
}) {
  const router = useRouter();
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    modifierVente,
    {},
  );

  useEffect(() => {
    if (etat.succes) {
      toast.success(etat.succes);
      // On quitte l'écran après une correction réussie : y rester donnerait
      // l'impression qu'il reste quelque chose à faire.
      router.push("/vendeur/vente");
    }
  }, [etat.succes, etat.jeton, router]);

  const [lignes, setLignes] = useState<Ligne[]>(() =>
    lignesInitiales.map((l, i) => ({
      cle: i,
      produit_id: l.produit_id,
      quantite: String(l.quantite),
      prix: String(l.prix_vente_unitaire),
    })),
  );

  function modifier(cle: number, champ: keyof Ligne, valeur: string) {
    setLignes((actuelles) =>
      actuelles.map((l) => {
        if (l.cle !== cle) return l;
        const suivante = { ...l, [champ]: valeur };
        if (champ === "produit_id") {
          const p = produits.find((x) => x.produit_id === valeur);
          if (p) suivante.prix = String(p.prix_conseille);
        }
        return suivante;
      }),
    );
  }

  const total = lignes.reduce((s, l) => {
    const q = Number(l.quantite);
    const p = Number(l.prix);
    return s + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription className="text-xs">
          La correction remplace la vente : le stock est d&apos;abord restitué,
          puis redéduit selon les nouvelles quantités. Votre commission reste
          celle d&apos;origine — corriger une vente ne la renégocie pas.
        </AlertDescription>
      </Alert>

      <form action={action} className="space-y-4">
        <input type="hidden" name="vente_id" value={venteId} />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {lignes.map((ligne, index) => {
            const produit = produits.find(
              (p) => p.produit_id === ligne.produit_id,
            );

            return (
              <Card key={ligne.cle}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium">
                      Produit {index + 1}
                    </span>
                    {lignes.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLignes((a) => a.filter((l) => l.cle !== ligne.cle))
                        }
                      >
                        Retirer
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`p-${ligne.cle}`}>Produit</Label>
                    <ChampSelect
                      id={`p-${ligne.cle}`}
                      name="produit_id"
                      value={ligne.produit_id}
                      onValueChange={(v) =>
                        modifier(ligne.cle, "produit_id", v)
                      }
                      required
                      options={produits.map((p) => ({
                        valeur: p.produit_id,
                        libelle: `${p.produit} — ${p.quantite} disponible(s)`,
                      }))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`q-${ligne.cle}`}>Quantité</Label>
                      <Input
                        id={`q-${ligne.cle}`}
                        name="quantite"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={produit?.quantite}
                        step={1}
                        value={ligne.quantite}
                        onChange={(e) =>
                          modifier(ligne.cle, "quantite", e.target.value)
                        }
                        className="h-11 text-base"
                        required
                      />
                      {produit && (
                        <p className="text-muted-foreground text-xs">
                          {produit.quantite} disponible(s) après restitution
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`x-${ligne.cle}`}>Prix unitaire</Label>
                      <Input
                        id={`x-${ligne.cle}`}
                        name="prix_vente_unitaire"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={ligne.prix}
                        onChange={(e) =>
                          modifier(ligne.cle, "prix", e.target.value)
                        }
                        className="h-11 text-base"
                        required
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-11 w-full md:w-auto md:px-8"
          onClick={() =>
            setLignes((a) => [
              ...a,
              {
                cle: Date.now() + Math.random(),
                produit_id: produits[0]?.produit_id ?? "",
                quantite: "1",
                prix: String(produits[0]?.prix_conseille ?? ""),
              },
            ])
          }
        >
          Ajouter un produit
        </Button>

        <Card>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client">Client</Label>
              <Input
                id="client"
                name="client"
                defaultValue={client}
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={date}
                className="h-11 text-base"
              />
            </div>
          </CardContent>
        </Card>

        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="bg-background/95 sticky bottom-20 -mx-4 border-t px-4 py-3 backdrop-blur md:bottom-4 md:mx-0 md:rounded-lg md:border md:shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3 text-sm sm:justify-start">
              <span className="text-muted-foreground">Nouveau total</span>
              <span className="text-lg font-semibold tabular-nums">
                {euros(total)}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <BoutonAnnuler venteId={venteId} />
              <Button
                type="submit"
                className="h-14 text-base sm:h-12 sm:px-10"
                disabled={enCours}
              >
                {enCours ? "Correction…" : "Enregistrer la correction"}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * Annulation, placée DANS l'écran de correction : c'est le même geste mental
 * (« cette vente est fausse »), avec deux issues.
 *
 * Le formulaire est hors du <form> parent : deux formulaires imbriqués sont du
 * HTML invalide, et le dialogue le sort de l'arbre de toute façon.
 */
function BoutonAnnuler({ venteId }: { venteId: string }) {
  const router = useRouter();
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    annulerMaVente,
    {},
  );

  useEffect(() => {
    if (etat.succes) {
      toast.success(etat.succes);
      router.push("/vendeur/vente");
    }
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton, router]);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" className="h-14 sm:h-12">
            Annuler cette vente
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annuler cette vente ?</DialogTitle>
          <DialogDescription>
            Elle disparaîtra de votre historique, le stock reviendra dans le
            vôtre et votre dette diminuera d&apos;autant. Si la vente a bien eu
            lieu mais que les chiffres sont faux, préférer la correction.
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
