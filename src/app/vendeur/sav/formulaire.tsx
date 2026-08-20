"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { date, euros } from "@/lib/format";
import type { DossierSav, EtatAction } from "@/lib/types";

import { marquerSavVu, retirerSav } from "../actions";

/**
 * Éteint la pastille de l'onglet SAV, une fois la page réellement affichée.
 *
 * `actif` vaut faux quand il n'y a rien à éteindre : aucun appel n'est alors
 * émis, ce qui écarte toute boucle avec le `revalidatePath` que l'action
 * déclenche pour rafraîchir le compteur du layout. Le garde-fou `dejaFait`
 * couvre le cas où React remonterait le composant.
 *
 * Appeler une Server Action dans un effet est le même motif que le
 * `toast.success` utilisé partout ailleurs : un système externe, pas un
 * `setState` — ce que la configuration ESLint refuse.
 */
export function MarquerSavVu({
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
    void marquerSavVu(borne);
  }, [actif, borne]);

  return null;
}

/**
 * Une demande de remboursement que le gérant n'a pas encore tranchée.
 *
 * Elle n'a produit aucun effet : ni la dette du vendeur ni le chiffre
 * d'affaires n'ont bougé. Le dire ici évite qu'il compte deux fois sur un
 * remboursement qui n'est pas acquis.
 */
export function DemandeSavEnAttente({ dossier }: { dossier: DossierSav }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    retirerSav,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {dossier.produit} × {dossier.quantite} ·{" "}
            {euros(dossier.montant_rembourse)}
          </p>
          <p className="text-muted-foreground text-xs">
            Vente à {dossier.client} du {date(dossier.date)} · {dossier.motif}
          </p>
        </div>
        <form action={action} className="shrink-0">
          <input type="hidden" name="sav_id" value={dossier.id} />
          <Button type="submit" variant="outline" size="sm" disabled={enCours}>
            {enCours ? "Retrait…" : "Retirer"}
          </Button>
        </form>
      </div>

      {etat.erreur && (
        <Alert variant="destructive">
          <AlertDescription>{etat.erreur}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
