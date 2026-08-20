"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateHeurePrecise, euros } from "@/lib/format";
import type { EtatAction, VenteSavable } from "@/lib/types";
import { cn } from "@/lib/utils";

import { declarerSav } from "@/app/gestion/actions";
import { signalerSav } from "@/app/vendeur/actions";

/**
 * Déclarer une défaillance sur un article vendu.
 *
 * Le SAV part TOUJOURS d'une vente : c'est ce qui permet de répondre plus tard
 * à « cette vente a-t-elle posé problème ? ». Un ajustement de stock motivé
 * ferait baisser le stock tout aussi bien, mais ne se rattacherait à rien.
 *
 * Les deux dénouements ne coûtent pas la même chose à la maison, et le
 * formulaire le dit avant de valider — c'est la seule façon de choisir en
 * connaissance de cause :
 *   échange       → une unité neuve sort du stock, le client garde son argent ;
 *   remboursement → l'argent repart, la dette du vendeur baisse d'autant.
 *
 * UN SEUL composant pour les deux espaces, avec deux Server Actions distinctes.
 * Ce n'est pas un détail de forme : le contexte ne décide de RIEN côté base —
 * `declarer_sav()` déduit le régime de qui appelle. Ce que le contexte change
 * ici est seulement ce qui a du sens à afficher : un vendeur n'a pas accès à
 * l'entrepôt, et il demande un remboursement au lieu de l'accorder.
 */
export function FormulaireSav({
  lignes,
  contexte,
  libelle,
}: {
  lignes: VenteSavable[];
  contexte: "gestion" | "vendeur";
  /**
   * Le libellé par défaut (« SAV ») se comprend sur l'écran Stock, parmi trois
   * autres boutons. Seul en en-tête de la page Service après-vente, il ne dit
   * rien — d'où cette échappatoire.
   */
  libelle?: string;
}) {
  const vendeur = contexte === "vendeur";
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    vendeur ? signalerSav : declarerSav,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  if (lignes.length === 0) return null;

  return (
    <DialogueAction
      libelle={libelle ?? (vendeur ? "Signaler un SAV" : "SAV")}
      tailleBouton={vendeur ? "sm" : undefined}
      titre={vendeur ? "Signaler une défaillance" : "Déclarer un SAV"}
      description={
        vendeur
          ? "Un article que vous avez vendu est défaillant. Un échange prend effet tout de suite ; un remboursement est soumis au gérant. Votre vente n'est pas modifiée."
          : "Un article vendu s'est révélé défaillant. La vente d'origine n'est pas modifiée : le SAV est un événement postérieur, et c'est ce qui permet de le retrouver sur la vente."
      }
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <ChampsSav
          lignes={lignes}
          vendeur={vendeur}
          erreur={etat.erreur}
          enCours={enCours}
        />
      </form>
    </DialogueAction>
  );
}

function ChampsSav({
  lignes,
  vendeur,
  erreur,
  enCours,
}: {
  lignes: VenteSavable[];
  vendeur: boolean;
  erreur?: string;
  enCours: boolean;
}) {
  // Un seul choix pour le gérant — « la vente à un client du 3, un Produit A »
  // — au lieu de deux listes à garder cohérentes. L'action redécoupe la valeur.
  const [ligne, setLigne] = useState(
    `${lignes[0].vente_id}|${lignes[0].produit_id}`,
  );
  const [quantite, setQuantite] = useState("1");
  const [resolution, setResolution] = useState<"echange" | "remboursement">(
    "echange",
  );

  const choisie =
    lignes.find((l) => `${l.vente_id}|${l.produit_id}` === ligne) ?? lignes[0];
  const qte = Math.max(1, Math.min(Number(quantite) || 1, choisie.restant));

  // Montant SUGGÉRÉ, pas imposé : un geste partiel reste possible. Le plafond
  // qui fait foi est celui que vérifie declarer_sav().
  const maximum = qte * Number(choisie.prix_unitaire);

  return (
    <>
      <div className="space-y-2">
        <Label>Vente concernée</Label>

        {/* Liste de cartes plutôt qu'un <select>.
            Ce n'est pas une entorse à la règle « select natif » de
            docs/interface.md : un bouton radio EST un contrôle natif, il se
            soumet avec le formulaire et n'a besoin d'aucun JavaScript. Ce qui
            change est la mise en page — une option de <select> est une seule
            ligne de texte, et sept ventes du même jour au même client pour le
            même produit y devenaient sept lignes identiques. Sur deux lignes,
            l'heure de saisie et le montant les séparent enfin.

            Hauteur bornée + défilement : la liste grandit avec les ventes. */}
        <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {lignes.map((l) => {
            const valeur = `${l.vente_id}|${l.produit_id}`;
            const actif = valeur === ligne;
            return (
              <li key={valeur}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    actif
                      ? "border-foreground bg-muted"
                      : "hover:bg-muted/50 border-input",
                  )}
                >
                  <input
                    type="radio"
                    name="ligne"
                    value={valeur}
                    checked={actif}
                    onChange={() => {
                      setLigne(valeur);
                      setQuantite("1");
                    }}
                    className="mt-1 size-4 shrink-0"
                    required
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium">
                        {l.produit} · {l.restant} sur {l.quantite}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {euros(l.prix_unitaire)} l&apos;unité
                      </span>
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {/* À la seconde : plusieurs ventes du même produit au
                          même client peuvent tomber dans la même minute. */}
                      {l.client} · {dateHeurePrecise(l.cree_le)}
                      {!vendeur && ` · ${l.vendeur}`}
                      {l.deja_en_sav > 0 && ` · ${l.deja_en_sav} déjà en SAV`}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sav-quantite">Unités défaillantes</Label>
          <Input
            id="sav-quantite"
            name="quantite"
            type="number"
            inputMode="numeric"
            min={1}
            max={choisie.restant}
            step={1}
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
            className="h-11 text-base"
            required
          />
          <p className="text-muted-foreground text-xs">
            {choisie.restant} encore couvrable(s) à{" "}
            {euros(choisie.prix_unitaire)} l&apos;unité.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Dénouement</Label>
          {/* Deux cartes plutôt qu'une liste déroulante : le choix n'a que deux
              termes, et ils n'ont pas les mêmes conséquences comptables. Les
              montrer côte à côte vaut mieux que d'en cacher un. */}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["echange", "Échange", "du neuf"],
                [
                  "remboursement",
                  "Remboursement",
                  vendeur ? "à valider" : "l'argent repart",
                ],
              ] as const
            ).map(([valeur, titre, precision]) => (
              <label
                key={valeur}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col justify-center rounded-lg border px-3 py-2 transition-colors",
                  resolution === valeur
                    ? "border-foreground bg-muted"
                    : "hover:bg-muted/50 border-input",
                )}
              >
                <input
                  type="radio"
                  name="resolution"
                  value={valeur}
                  checked={resolution === valeur}
                  onChange={() => setResolution(valeur)}
                  className="sr-only"
                />
                <span className="text-sm font-medium">{titre}</span>
                <span className="text-muted-foreground text-xs">
                  {precision}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {resolution === "echange" ? (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {vendeur
              ? `${qte} unité(s) sortent de votre stock, tout de suite : vous avez déjà remis la marchandise au client. Votre dette ne change pas.`
              : `${qte} unité(s) sortent du stock sans contrepartie : la maison offre la marchandise. Le chiffre d'affaires ne bouge pas, la marge baisse du coût de ces unités.`}
          </p>
          {/* L'entrepôt n'est proposé qu'au gérant : un vendeur n'y a pas
              accès, et declarer_sav() ignore le paramètre venant de lui. */}
          {!vendeur && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="depuis_entrepot"
                className="size-4 shrink-0"
              />
              Prendre l&apos;unité dans l&apos;entrepôt plutôt que chez{" "}
              {choisie.vendeur}
            </label>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="sav-montant">Montant remboursé</Label>
          <Input
            id="sav-montant"
            name="montant"
            type="number"
            inputMode="decimal"
            min={0.01}
            max={maximum}
            step="0.01"
            defaultValue={maximum.toFixed(2)}
            className="h-11 text-base"
            required
          />
          <p className="text-muted-foreground text-xs">
            {euros(maximum)} maximum — ce que le client a payé pour ces unités.
            {vendeur
              ? " Votre dette baissera d'autant, une fois le gérant d'accord."
              : ` La dette de ${choisie.vendeur} baisse du montant rendu : c'est lui qui a sorti l'argent.`}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="sav-motif">Défaillance constatée</Label>
        <Input
          id="sav-motif"
          name="motif"
          placeholder="Résistance grillée à la première utilisation"
          className="h-11 text-base"
          required
        />
        <p className="text-muted-foreground text-xs">
          Obligatoire, en base comme ici : « SAV » seul n&apos;explique rien six
          mois plus tard.
        </p>
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose render={<Button variant="outline">Annuler</Button>} />
        <Button type="submit" disabled={enCours}>
          {enCours
            ? "Enregistrement…"
            : vendeur && resolution === "remboursement"
              ? "Envoyer au gérant"
              : "Enregistrer le SAV"}
        </Button>
      </div>
    </>
  );
}
