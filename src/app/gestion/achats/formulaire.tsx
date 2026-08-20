"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aujourdHui, euros, eurosPrecis } from "@/lib/format";
import type { EtatAction, Produit } from "@/lib/types";

import { enregistrerAchat } from "../actions";

/**
 * Saisie d'un achat fournisseur — les unités entrent en entrepôt.
 *
 * Ce dialogue est monté à DEUX endroits : l'écran Achats (avec son historique)
 * et l'écran État du stock, où le geste « je viens de recevoir une commande »
 * est le plus naturel. Un seul composant : deux copies divergeraient, et c'est
 * le formulaire qui fixe le coût de revient de toute la marchandise à venir.
 *
 * Le prix n'est pas un champ de confort. `prix_achat_unitaire =
 * (marchandise + port) / unités` alimente le coût moyen pondéré : des unités
 * entrées sans prix le diluent et gonflent durablement toutes les marges. C'est
 * exactement ce que fait un ajustement positif, réservé pour cette raison aux
 * écarts de comptage.
 */
export function FormulaireAchat({ produits }: { produits: Produit[] }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    enregistrerAchat,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  if (produits.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Aucun produit actif. En créer un dans l&apos;écran Produits avant de
          saisir un achat.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <DialogueAction
      libelle="Nouveau Restock"
      variante="default"
      // `large` : la saisie d'un achat comporte une grille de produits et
      // quatre champs de montants — le gabarit standard serait à l'étroit.
      taille="large"
      titre="Nouveau restock"
      description="Les unités entrent en entrepôt. Les frais de port sont répartis sur les unités : le coût de revient inclut l'acheminement."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <ChampsAchat
          produits={produits}
          erreur={etat.erreur}
          enCours={enCours}
        />
      </form>
    </DialogueAction>
  );
}

function ChampsAchat({
  produits,
  erreur,
  enCours,
}: {
  produits: Produit[];
  erreur?: string;
  enCours: boolean;
}) {
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [prixBase, setPrixBase] = useState("");
  const [fraisPort, setFraisPort] = useState("0");

  const unites = Object.values(quantites).reduce(
    (s, v) => s + (Number(v) || 0),
    0,
  );

  // Aperçu du coût de revient réel, celui qui sera figé par la base :
  // (marchandise + port) / unités. Le patron doit le voir AVANT de valider,
  // c'est lui qui déterminera toutes les marges à venir.
  const total = (Number(prixBase) || 0) + (Number(fraisPort) || 0);
  const coutUnitaire = unites > 0 ? total / unites : 0;

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {produits.map((p) => {
          const saisi = Number(quantites[p.id]) > 0;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={`ach-${p.id}`}
                  className="truncate text-sm font-normal"
                >
                  {p.nom}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {euros(p.prix_vente_conseille)} conseillé
                </p>
              </div>
              <div className="shrink-0">
                {/* `name` posé seulement si une quantité est saisie : les deux
                    tableaux produit_id[]/quantite[] restent ainsi alignés. */}
                {saisi && (
                  <input type="hidden" name="produit_id" value={p.id} />
                )}
                <Input
                  id={`ach-${p.id}`}
                  {...(saisi ? { name: "quantite" } : {})}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={quantites[p.id] ?? ""}
                  onChange={(e) =>
                    setQuantites((q) => ({ ...q, [p.id]: e.target.value }))
                  }
                  className="h-11 w-20 text-center text-base"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="prix_base">Montant marchandise</Label>
          <Input
            id="prix_base"
            name="prix_base"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={prixBase}
            onChange={(e) => setPrixBase(e.target.value)}
            className="h-11 text-base"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="frais_port">Frais de port</Label>
          <Input
            id="frais_port"
            name="frais_port"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={fraisPort}
            onChange={(e) => setFraisPort(e.target.value)}
            className="h-11 text-base"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reference">Référence (facultatif)</Label>
          <Input
            id="reference"
            name="reference"
            placeholder="CMD-2026-014"
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
            Antidater un achat lui applique tout de même le coût de revient
            calculé aujourd&apos;hui.
          </p>
        </div>
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Unités</dt>
            <dd className="font-medium tabular-nums">{unites}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-medium tabular-nums">{euros(total)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Coût unitaire</dt>
            <dd className="font-semibold tabular-nums">
              {unites > 0 ? eurosPrecis(coutUnitaire) : "—"}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" disabled={enCours || unites === 0}>
            {enCours
              ? "Enregistrement…"
              : unites === 0
                ? "Saisir une quantité"
                : "Enregistrer l'achat"}
          </Button>
        </div>
      </div>
    </>
  );
}
