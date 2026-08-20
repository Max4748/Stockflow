"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateHeure } from "@/lib/format";
import type { DemandeRestock, EtatAction } from "@/lib/types";

import { traiterDemande } from "../actions";

type LigneDispo = {
  ligne_id: string;
  produit_id: string;
  produit: string;
  demandee: number;
  disponible: number;
};

export function CarteDemande({
  demande,
  vendeur,
  dispoEntrepot,
}: {
  demande: DemandeRestock;
  vendeur: string;
  dispoEntrepot: LigneDispo[];
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    traiterDemande,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    // Une demande déjà traitée (deux onglets, double-clic) remonte ici : c'est
    // le comportement voulu de la RPC, idempotente par verrou de ligne.
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  const totalDemande = dispoEntrepot.reduce((s, l) => s + l.demandee, 0);
  const servableEnEntier = dispoEntrepot.every(
    (l) => l.disponible >= l.demandee,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{vendeur}</CardTitle>
          <Badge variant="secondary">{totalDemande} u demandées</Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          demandée le {dateHeure(demande.cree_le)}
        </p>
        {demande.note && <p className="text-sm italic">« {demande.note} »</p>}
      </CardHeader>

      <CardContent className="space-y-4">
        {!servableEnEntier && (
          <Alert>
            <AlertDescription className="text-xs">
              Le stock entrepôt ne couvre pas tout : accorder une quantité
              partielle plutôt que de refuser en bloc.
            </AlertDescription>
          </Alert>
        )}

        <form action={action} className="space-y-4">
          <input type="hidden" name="demande_id" value={demande.id} />

          <ChampsAccord
            key={etat.jeton ?? "initial"}
            lignes={dispoEntrepot}
            enCours={enCours}
          />
        </form>
      </CardContent>
    </Card>
  );
}

function ChampsAccord({
  lignes,
  enCours,
}: {
  lignes: LigneDispo[];
  enCours: boolean;
}) {
  // Pré-rempli au MINIMUM entre demandé et disponible : la valeur par défaut
  // est celle qui passera le contrôle de stock du SQL.
  const [accordees, setAccordees] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lignes.map((l) => [
        l.produit_id,
        String(Math.min(l.demandee, Math.max(l.disponible, 0))),
      ]),
    ),
  );

  const totalAccorde = lignes.reduce(
    (s, l) => s + (Number(accordees[l.produit_id]) || 0),
    0,
  );

  return (
    <>
      <ul className="space-y-2">
        {lignes.map((l) => {
          const valeur = accordees[l.produit_id] ?? "0";
          const trop = Number(valeur) > l.disponible;

          return (
            <li
              key={l.ligne_id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={`acc-${l.ligne_id}`}
                  className="truncate text-sm font-normal"
                >
                  {l.produit}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {l.demandee} demandée(s) · {l.disponible} en entrepôt
                </p>
              </div>
              <div className="shrink-0">
                <input type="hidden" name="produit_id" value={l.produit_id} />
                <Input
                  id={`acc-${l.ligne_id}`}
                  name="accordee"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={Math.min(l.demandee, l.disponible)}
                  step={1}
                  value={valeur}
                  aria-invalid={trop || undefined}
                  onChange={(e) =>
                    setAccordees((a) => ({
                      ...a,
                      [l.produit_id]: e.target.value,
                    }))
                  }
                  className="h-11 w-20 text-center text-base"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <Label htmlFor="motif">Message au vendeur (facultatif)</Label>
        <Textarea
          id="motif"
          name="motif"
          rows={2}
          placeholder="Produit B en rupture fournisseur…"
        />
      </div>

      {/* Trois issues explicites. « Tout accorder » passe p_lignes_accordees à
          null côté serveur, ce qui laisse le SQL accorder les quantités
          demandées — et échouer proprement si le stock ne suit pas. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="submit"
          name="decision"
          value="approuver"
          className="h-11 flex-1"
          disabled={enCours || totalAccorde === 0}
        >
          {enCours ? "Traitement…" : `Accorder ${totalAccorde} u`}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="refuser"
          variant="outline"
          className="h-11"
          disabled={enCours}
        >
          Refuser
        </Button>
      </div>
    </>
  );
}
