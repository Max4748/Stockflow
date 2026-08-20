"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { ChampSelect } from "@/components/champ-select";
import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ajusterStock, transfererStock } from "../actions";

/** Un compte pouvant détenir du stock. Pas seulement les vendeurs. */
export type Detenteur = {
  id: string;
  nom: string;
  role: string;
  actif: boolean;
  /**
   * Ce qu'il détient déjà. Distribuer sans le savoir revient à choisir à
   * l'aveugle : on renvoie du Produit A à quelqu'un qui en a 48.
   */
  detient: { produit: string; quantite: number }[];
};

/** Le rôle, quand il n'est pas déjà dans le nom. */
function libelleRole(d: Detenteur) {
  const role = d.role === "dev" ? "dev" : d.role === "gerant" ? "gérant" : null;
  if (!role) return null;
  // Certains comptes portent déjà la mention dans leur nom (« Max (dev) ») :
  // l'ajouter produisait « Max (dev) (dev) ».
  return d.nom.toLowerCase().includes(role.toLowerCase()) ? null : role;
}

function suffixeRole(d: Detenteur) {
  const role = libelleRole(d);
  return role ? ` (${role})` : "";
}

/**
 * Ajustement d'inventaire : perte, casse, écart de comptage.
 *
 * Sans contrepartie comptable, contrairement à un transfert : c'est pourquoi
 * le motif est obligatoire, à la fois ici et par un CHECK en base.
 */
export function FormulaireAjustement({
  produits,
  detenteurs,
}: {
  produits: { id: string; nom: string }[];
  detenteurs: Detenteur[];
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    ajusterStock,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  if (produits.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Créer au moins un produit avant d&apos;ajuster un stock.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <DialogueAction
      libelle="Ajuster le stock"
      titre="Ajustement d'inventaire"
      description="Perte, casse ou écart de comptage. Sans contrepartie comptable, contrairement à un transfert — c'est pourquoi le motif est obligatoire."
      jeton={etat.jeton}
    >
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="aj-produit">Produit</Label>
          <ChampSelect
            id="aj-produit"
            name="produit_id"
            required
            defaultValue={produits[0]?.id}
            options={produits.map((p) => ({ valeur: p.id, libelle: p.nom }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="aj-detenteur">Détenteur</Label>
          {/* Chaîne vide = entrepôt, traduite en detenteur_id NULL côté base. */}
          <ChampSelect
            id="aj-detenteur"
            name="detenteur_id"
            defaultValue=""
            options={[
              { valeur: "", libelle: "Entrepôt" },
              ...detenteurs.map((d) => ({
                valeur: d.id,
                libelle: `${d.nom}${suffixeRole(d)}${d.actif ? "" : " (inactif)"}`,
              })),
            ]}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="aj-delta">Écart</Label>
          <Input
            id="aj-delta"
            name="delta"
            type="number"
            inputMode="numeric"
            step={1}
            placeholder="-3"
            className="h-11 text-base"
            required
          />
          <p className="text-muted-foreground text-xs">
            Négatif pour une perte, positif pour un écart de comptage favorable.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="aj-motif">Motif</Label>
          <Input
            id="aj-motif"
            name="motif"
            placeholder="Casse au transport"
            className="h-11 text-base"
            required
          />
          <p className="text-muted-foreground text-xs">
            Obligatoire : un écart sans explication devient inexplicable plus
            tard.
          </p>
        </div>

        {etat.erreur && (
          <Alert variant="destructive" className="sm:col-span-2">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer l'ajustement"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

/**
 * Distribuer du stock de l'entrepôt vers un compte.
 *
 * Miroir exact de « Reprendre du stock » sur la fiche vendeur. Jusqu'ici la
 * seule façon de donner du stock était d'approuver une demande de réassort :
 * un gérant qui vend devait donc s'écrire une demande à lui-même.
 *
 * La liste des destinataires n'est PAS filtrée aux vendeurs — c'est ce qui
 * permet à un compte d'encadrement de détenir du stock, donc de vendre.
 */
export function FormulaireTransfert({
  produits,
  detenteurs,
}: {
  produits: { id: string; nom: string; stockEntrepot: number }[];
  detenteurs: Detenteur[];
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    transfererStock,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  const disponibles = produits.filter((p) => p.stockEntrepot > 0);

  if (detenteurs.length === 0 || disponibles.length === 0) return null;

  return (
    // `outline` : trois actions cohabitent dans cet en-tête, seul « Restock »
    // est plein — c'est le geste courant (voir docs/interface.md).
    <DialogueAction
      libelle="Distribuer le stock"
      titre="Distribuer du stock à un compte"
      description="Les unités quittent l'entrepôt pour le stock personnel du destinataire, qui peut alors les vendre. Sans passer par une demande de réassort."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <ChampsTransfert
          produits={disponibles}
          detenteurs={detenteurs}
          erreur={etat.erreur}
          enCours={enCours}
        />
      </form>
    </DialogueAction>
  );
}

function ChampsTransfert({
  produits,
  detenteurs,
  erreur,
  enCours,
}: {
  produits: { id: string; nom: string; stockEntrepot: number }[];
  detenteurs: Detenteur[];
  erreur?: string;
  enCours: boolean;
}) {
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const total = Object.values(quantites).reduce(
    (s, v) => s + (Number(v) || 0),
    0,
  );

  return (
    <>
      <div className="space-y-2">
        <Label>Destinataire</Label>

        {/* Cartes plutôt qu'une liste déroulante : chaque destinataire a besoin
            de DEUX lignes — qui il est, et ce qu'il détient déjà. C'est la
            question qu'on se pose en distribuant, et une option de <select> ne
            sait afficher qu'une ligne (voir docs/interface.md). */}
        <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {detenteurs.map((d, i) => {
            const total = d.detient.reduce((s, x) => s + x.quantite, 0);
            const role = libelleRole(d);
            return (
              <li key={d.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    "has-checked:border-foreground has-checked:bg-muted",
                    "hover:bg-muted/50 border-input",
                  )}
                >
                  <input
                    type="radio"
                    name="detenteur_id"
                    value={d.id}
                    defaultChecked={i === 0}
                    className="mt-1 size-4 shrink-0"
                    required
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium">
                        {d.nom}
                        {role && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            · {role}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {total > 0 ? `${total} u détenues` : "aucun stock"}
                      </span>
                    </span>
                    {d.detient.length > 0 && (
                      <span className="text-muted-foreground block truncate text-xs">
                        {d.detient
                          .map((x) => `${x.produit} ${x.quantite}`)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <ul className="space-y-2">
        {produits.map((p) => {
          const saisi = Number(quantites[p.id]) > 0;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={`tr-${p.id}`}
                  className="truncate text-sm font-normal"
                >
                  {p.nom}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {p.stockEntrepot} en entrepôt
                </p>
              </div>
              <div className="shrink-0">
                {/* `name` posé seulement si une quantité est saisie : les deux
                    tableaux produit_id[]/quantite[] restent ainsi alignés. */}
                {saisi && (
                  <input type="hidden" name="produit_id" value={p.id} />
                )}
                <Input
                  id={`tr-${p.id}`}
                  {...(saisi ? { name: "quantite" } : {})}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={p.stockEntrepot}
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

      <div className="space-y-2">
        <Label htmlFor="tr-motif">Motif (facultatif)</Label>
        <Input
          id="tr-motif"
          name="motif"
          placeholder="Dotation de départ, renfort week-end"
          className="h-11 text-base"
        />
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose render={<Button variant="outline">Annuler</Button>} />
        <Button type="submit" disabled={enCours || total === 0}>
          {enCours
            ? "Transfert…"
            : total === 0
              ? "Saisir une quantité"
              : `Distribuer ${total} u`}
        </Button>
      </div>
    </>
  );
}
