"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateHeure, euros } from "@/lib/format";
import type { EtatAction, LignePrelevement, TarifPreleve } from "@/lib/types";

import { definirPrixPreleve, supprimerPrelevement } from "../../actions";

/**
 * Ce que le vendeur a repris pour lui, et le bouton pour l'annuler.
 *
 * L'annulation est ici et pas côté vendeur : la prise pèse sur sa dette, et
 * laisser un débiteur effacer sa propre dette n'a pas de sens.
 */
export function ListePrelevements({
  prelevements,
}: {
  prelevements: LignePrelevement[];
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    supprimerPrelevement,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  if (prelevements.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Aucun prélèvement.</p>
    );
  }

  const total = prelevements.reduce((s, p) => s + p.montant, 0);

  return (
    <div className="space-y-3">
      <ul className="divide-border divide-y">
        {prelevements.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {p.quantite} × {p.produit}
              </p>
              <p className="text-muted-foreground text-xs">
                {dateHeure(p.cree_le)} · {euros(p.prix_unitaire)} l&apos;unité
              </p>
            </div>
            <span className="tabular-nums">{euros(p.montant)}</span>
            <form action={action}>
              <input type="hidden" name="prelevement_id" value={p.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={enCours}
              >
                Annuler
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <p className="text-right text-sm font-medium tabular-nums">
        {euros(total)} ajoutés à sa dette
      </p>
    </div>
  );
}

/**
 * Le tarif de prélèvement, MODÈLE par modèle.
 *
 * Un modèle, un tarif : cinq lignes à régler par vendeur plutôt que quarante.
 *
 * Le champ vide n'est pas « zéro » mais « suivre le défaut » : le placeholder
 * affiche donc le repli calculé en base plutôt qu'un 0 trompeur. Un tarif
 * personnalisé se distingue à sa valeur saisie et au bouton de remise à zéro.
 */
export function TarifsPrelevement({
  vendeurId,
  tarifs,
}: {
  vendeurId: string;
  tarifs: TarifPreleve[];
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    definirPrixPreleve,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  if (tarifs.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun modèle actif.</p>;
  }

  return (
    <div className="space-y-3">
      {etat.erreur && (
        <Alert variant="destructive">
          <AlertDescription>{etat.erreur}</AlertDescription>
        </Alert>
      )}

      <ul className="divide-border divide-y">
        {tarifs.map((t) => (
          <li key={t.modele_id} className="py-2">
            <form
              action={action}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <input type="hidden" name="vendeur_id" value={vendeurId} />
              <input type="hidden" name="modele_id" value={t.modele_id} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {t.modele}
                <span className="text-muted-foreground ml-1 font-normal">
                  · {t.nb_parfums} parfum(s)
                </span>
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                conseillé {euros(t.prix_vente_conseille)}
              </span>
              <Input
                name="prix"
                type="number"
                step="0.01"
                min={0}
                defaultValue={t.personnalise ? t.prix_effectif : ""}
                placeholder={String(t.prix_effectif)}
                className="w-28 tabular-nums"
                aria-label={`Tarif de prélèvement pour ${t.modele}`}
              />
              <Button type="submit" size="sm" variant="outline" disabled={enCours}>
                {t.personnalise ? "Modifier" : "Fixer"}
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        Un tarif par modèle : tous ses parfums se prélèvent au même prix. Champ
        vide, le tarif suit le prix conseillé moins sa commission. Une prise
        déjà faite garde le tarif du jour où elle a été faite.
      </p>
    </div>
  );
}
