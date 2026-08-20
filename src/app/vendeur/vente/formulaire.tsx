"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChampSelect } from "@/components/champ-select";
import { Card, CardContent } from "@/components/ui/card";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aujourdHui, euros } from "@/lib/format";
import type { EtatAction } from "@/lib/types";

import { enregistrerVente } from "../actions";

type ProduitVendable = {
  produit_id: string;
  produit: string;
  quantite: number;
  prix_conseille: number;
};

type Ligne = {
  cle: number;
  produit_id: string;
  quantite: string;
  prix: string;
};

/**
 * Saisie d'une vente, dans un dialogue.
 *
 * La page ne montre plus que de l'information — les ventes récentes — et le
 * geste vit derrière un bouton, comme partout ailleurs (voir
 * docs/interface.md). Auparavant ce formulaire occupait le haut de l'écran en
 * permanence, y compris quand le vendeur venait seulement relire ses ventes.
 *
 * `tailleBouton="lg"` : c'est l'action principale de l'espace vendeur, saisie
 * debout sur un téléphone. Elle garde les 56 px du bouton qu'elle remplace.
 */
export function FormulaireVente({ produits }: { produits: ProduitVendable[] }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    enregistrerVente,
    {},
  );

  // Le toast est un effet légitime : il pousse vers un système externe (sonner).
  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Enregistrer une vente"
      variante="default"
      tailleBouton="lg"
      // `large` : la saisie tuile plusieurs cartes de produit, le gabarit
      // standard les serrerait sur une colonne.
      taille="large"
      titre="Enregistrer une vente"
      description="Le total affiché est indicatif : c'est la base qui recalcule le montant, le coût et la commission au moment de valider."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        {/* La `key` change à chaque succès : React remonte les champs, ce qui
            réinitialise leur état. Appeler setState dans un useEffect pour cela
            provoquerait des renders en cascade. */}
        <ChampsVente
          key={etat.jeton ?? "initial"}
          produits={produits}
          erreur={etat.erreur}
          enCours={enCours}
        />
      </form>
    </DialogueAction>
  );
}

function ChampsVente({
  produits,
  erreur,
  enCours,
}: {
  produits: ProduitVendable[];
  erreur?: string;
  enCours: boolean;
}) {
  const premier = produits[0];

  function ligneNeuve(): Ligne {
    return {
      cle: Date.now() + Math.random(),
      produit_id: premier?.produit_id ?? "",
      quantite: "1",
      prix: premier ? String(premier.prix_conseille) : "",
    };
  }

  const [lignes, setLignes] = useState<Ligne[]>(() => [ligneNeuve()]);

  function modifier(cle: number, champ: keyof Ligne, valeur: string) {
    setLignes((actuelles) =>
      actuelles.map((l) => {
        if (l.cle !== cle) return l;
        const suivante = { ...l, [champ]: valeur };
        // Changer de produit réaligne le prix sur le prix conseillé.
        if (champ === "produit_id") {
          const p = produits.find((x) => x.produit_id === valeur);
          if (p) suivante.prix = String(p.prix_conseille);
        }
        return suivante;
      }),
    );
  }

  function retirerLigne(cle: number) {
    setLignes((actuelles) =>
      actuelles.length === 1
        ? actuelles
        : actuelles.filter((l) => l.cle !== cle),
    );
  }

  // Total purement indicatif, pour que le vendeur relise sa saisie. Le montant
  // qui fait foi est recalculé en SQL par enregistrer_vente().
  const total = lignes.reduce((s, l) => {
    const q = Number(l.quantite);
    const p = Number(l.prix);
    return s + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);

  return (
    <>
      {/* UNE LIGNE PAR PRODUIT, pas une carte.
          Chaque produit occupait ~180 px : six lignes faisaient plus de
          1 000 px à faire défiler sur un téléphone. En ligne, c'est ~90 px sur
          mobile et ~44 px dès `sm`.

          Ce qui a été retiré n'était pas de l'information : « N disponible(s) »
          figure déjà dans l'option choisie (« Produit B — 10 en stock »), et le
          prix conseillé est la valeur PRÉ-REMPLIE du champ. Les libellés
          passent en `aria-label` plus un en-tête de colonnes affiché une fois. */}
      <div className="text-muted-foreground hidden gap-2 px-1 text-xs sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_7rem_2.25rem]">
        <span>Produit</span>
        <span className="text-center">Qté</span>
        <span className="text-right">Prix unitaire</span>
        <span />
      </div>

      <ul className="space-y-2">
        {lignes.map((ligne, index) => {
          const produit = produits.find(
            (p) => p.produit_id === ligne.produit_id,
          );

          return (
            <li
              key={ligne.cle}
              className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_2.25rem]"
            >
              {/* Pleine largeur sur mobile, première colonne dès `sm`. */}
              <ChampSelect
                aria-label={`Produit ${index + 1}`}
                name="produit_id"
                value={ligne.produit_id}
                onValueChange={(v) => modifier(ligne.cle, "produit_id", v)}
                className="col-span-2 h-10 sm:col-span-1"
                required
                options={produits.map((p) => ({
                  valeur: p.produit_id,
                  libelle: `${p.produit} — ${p.quantite} en stock`,
                }))}
              />

              {/* `sm:contents` : à partir de `sm` ce conteneur s'efface et ses
                  deux champs deviennent des cellules de la grille parente. */}
              <div className="flex gap-2 sm:contents">
                <Input
                  aria-label={`Quantité du produit ${index + 1}`}
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
                  className="h-10 w-16 text-center text-base sm:w-full"
                  required
                />
                <Input
                  aria-label={`Prix unitaire du produit ${index + 1}`}
                  name="prix_vente_unitaire"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={ligne.prix}
                  onChange={(e) => modifier(ligne.cle, "prix", e.target.value)}
                  className="h-10 w-24 text-right text-base sm:w-full"
                  required
                />
              </div>

              {/* Emplacement réservé même sur la première ligne : sans lui, les
                  colonnes se décaleraient dès qu'un produit est ajouté. */}
              {lignes.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Retirer le produit ${index + 1}`}
                  className="size-9 shrink-0 p-0 text-base"
                  onClick={() => retirerLigne(ligne.cle)}
                >
                  ×
                </Button>
              ) : (
                <span className="size-9" />
              )}
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        variant="outline"
        className="h-10 w-full sm:w-auto sm:px-8"
        onClick={() => setLignes((a) => [...a, ligneNeuve()])}
      >
        Ajouter un produit
      </Button>

      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="client">Client (facultatif)</Label>
            <Input
              id="client"
              name="client"
              placeholder="Anonyme"
              className="h-11 text-base"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              defaultValue={aujourdHui()}
              className="h-11 text-base"
            />
            <p className="text-muted-foreground text-xs">
              Antidater une vente lui applique tout de même le coût de revient
              du jour de la saisie.
            </p>
          </div>
        </CardContent>
      </Card>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      {/* Barre collante : le total et le bouton restent visibles même en
          faisant défiler cinq produits.
          Le conteneur de défilement est le dialogue lui-même (`p-4`,
          `rounded-xl`, fond `popover`), d'où les trois ajustements :
            • `bg-popover` et non `bg-background` — deux surfaces distinctes en
              thème sombre, la barre trahissait sa différence de teinte ;
            • marges négatives + padding pour couvrir toute la largeur, sinon le
              contenu défile visiblement dans les gouttières latérales ;
            • `rounded-b-xl` pour épouser l'arrondi du dialogue, dont les angles
              carrés de la barre dépassaient. */}
      <div className="bg-popover/95 sticky bottom-0 -mx-4 -mb-4 rounded-b-xl border-t px-4 py-3 backdrop-blur">
        {/* Sur mobile : total au-dessus, boutons en dessous sous le pouce.
            Dès `sm` : tout sur une ligne, regroupé à droite. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-6">
          <div className="flex items-center justify-between gap-3 text-sm sm:justify-end">
            <span className="text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums">
              {euros(total)}
            </span>
          </div>
          {/* Les deux boutons à la MÊME taille, comme dans tous les autres
              dialogues. La hauteur de 56 px appartient au déclencheur, sous le
              pouce sur une page ; ici elle écrasait « Annuler ». */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <DialogClose render={<Button variant="outline">Annuler</Button>} />
            <Button type="submit" disabled={enCours}>
              {enCours ? "Enregistrement…" : "Valider la vente"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
