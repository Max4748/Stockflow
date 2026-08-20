"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { date, euros } from "@/lib/format";
import type { DossierSav, EtatAction } from "@/lib/types";

import {
  arbitrerSav,
  annulerSav,
  marquerSavGestionVu,
  revoquerSav,
} from "../actions";

/**
 * Arbitrage d'un remboursement demandé par un vendeur.
 *
 * Seuls les remboursements passent par ici : un échange déclaré sur le terrain
 * est déjà validé, le vendeur ayant remis l'unité au client (migration 0015).
 * Le recours du gérant sur ces échanges est ailleurs, dans l'historique :
 * révoquer (0019), qui rend l'unité au stock SANS effacer le dossier.
 */
export function CarteArbitrage({ dossier }: { dossier: DossierSav }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    arbitrerSav,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {dossier.vendeur} · {dossier.produit} × {dossier.quantite}
          </p>
          <p className="text-muted-foreground text-xs">
            Vente à {dossier.client} du {date(dossier.date)} · déclaré par{" "}
            {dossier.declare_par}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {euros(dossier.montant_rembourse)} à valider
        </Badge>
      </div>

      <p className="text-sm">{dossier.motif}</p>

      {etat.erreur && (
        <Alert variant="destructive">
          <AlertDescription>{etat.erreur}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {/* Deux formulaires distincts plutôt qu'un champ à basculer : le refus
            demande un motif, la validation non. */}
        <DialogueRefus dossier={dossier} />
        <form action={action}>
          <input type="hidden" name="sav_id" value={dossier.id} />
          <input type="hidden" name="decision" value="valider" />
          <Button
            type="submit"
            disabled={enCours}
            className="h-11 w-full sm:w-auto"
          >
            {enCours
              ? "Validation…"
              : `Valider — ${euros(dossier.montant_rembourse)}`}
          </Button>
        </form>
      </div>
    </div>
  );
}

function DialogueRefus({ dossier }: { dossier: DossierSav }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    arbitrerSav,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Refuser"
      titre={`Refuser la demande de ${dossier.vendeur}`}
      description="Le dossier est conservé et le vendeur voit le motif. Sa dette reste inchangée."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="sav_id" value={dossier.id} />
        <input type="hidden" name="decision" value="refuser" />

        <div className="space-y-2">
          <Label htmlFor={`refus-${dossier.id}`}>Motif (facultatif)</Label>
          <Input
            id={`refus-${dossier.id}`}
            name="motif"
            placeholder="Usure normale, hors garantie"
            className="h-11 text-base"
          />
        </div>

        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" variant="destructive" disabled={enCours}>
            {enCours ? "Refus…" : "Refuser la demande"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

/**
 * Éteint la pastille de l'onglet SAV de la barre de gestion.
 *
 * Strictement le même motif que `MarquerSavVu` de l'espace vendeur : l'appel
 * part d'un effet de montage, jamais du rendu. La route est `force-dynamic` et
 * le projet n'a pas de `loading.tsx` — un préchargement de lien peut donc faire
 * rendre la page côté serveur sans que le gérant l'ait sous les yeux.
 *
 * `actif` à faux quand il n'y a rien à éteindre : aucun appel n'est émis, ce
 * qui écarte la boucle avec le `revalidatePath` de l'action.
 */
export function MarquerSavGestionVu({
  actif,
  borne,
}: {
  actif: boolean;
  borne: string | null;
}) {
  const dejaFait = useRef(false);

  useEffect(() => {
    if (!actif || dejaFait.current) return;
    dejaFait.current = true;
    void marquerSavGestionVu(borne);
  }, [actif, borne]);

  return null;
}

/**
 * Révoquer un dossier validé — le recours du gérant sur un échange déclaré par
 * un vendeur, et sur un remboursement qu'il a validé trop vite.
 *
 * À côté de `BoutonSupprimer`, et non à sa place : supprimer efface le dossier,
 * révoquer le conserve au statut « refusé », avec son motif. Le premier
 * convient à une erreur de saisie, le second à un désaccord — et seul le second
 * laisse une trace qui s'accumule si le vendeur recommence.
 */
export function BoutonRevoquer({ dossier }: { dossier: DossierSav }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    revoquerSav,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Révoquer"
      tailleBouton="sm"
      titre={`Révoquer le dossier de ${dossier.vendeur}`}
      description={
        dossier.resolution === "echange"
          ? "L'unité échangée revient au stock de son détenteur. Le dossier reste dans l'historique, marqué refusé, et le vendeur voit le motif."
          : "Le remboursement cesse de compter : le chiffre d'affaires et la dette du vendeur remontent du montant rendu. Le dossier reste visible."
      }
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="sav_id" value={dossier.id} />

        <div className="space-y-2">
          {/* Obligatoire, contrairement au refus d'une demande en attente : ici
              le vendeur comptait déjà sur ce dossier. */}
          <Label htmlFor={`revoc-${dossier.id}`}>Motif</Label>
          <Input
            id={`revoc-${dossier.id}`}
            name="motif"
            required
            placeholder="Aucune défaillance constatée sur l'unité rendue"
            className="h-11 text-base"
          />
        </div>

        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" variant="destructive" disabled={enCours}>
            {enCours ? "Révocation…" : "Révoquer le dossier"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

/**
 * Supprimer un dossier — le recours du gérant sur un échange déjà passé.
 *
 * Suppression et non refus : un échange validé a produit un mouvement de stock,
 * et c'est le `on delete cascade` qui rend l'unité à son détenteur.
 */
export function BoutonSupprimer({ dossier }: { dossier: DossierSav }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    annulerSav,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  return (
    <DialogueAction
      libelle="Supprimer"
      tailleBouton="sm"
      titre="Supprimer ce dossier de SAV"
      description={
        dossier.resolution === "echange"
          ? "L'unité échangée revient au stock de son détenteur, et la marge repart à son niveau d'avant."
          : "Le remboursement est effacé : la dette du vendeur remonte du montant rendu."
      }
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="sav_id" value={dossier.id} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" variant="destructive" disabled={enCours}>
            {enCours ? "Suppression…" : "Supprimer le dossier"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}
