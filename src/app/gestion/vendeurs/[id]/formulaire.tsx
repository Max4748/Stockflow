"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { aujourdHui, date, euros } from "@/lib/format";
import type { EtatAction, EtatActionSecret, Profil } from "@/lib/types";

import {
  basculerActivation,
  encaisserVersement,
  modifierVendeur,
  reinitialiserMotDePasse,
  retournerStock,
  supprimerVersement,
} from "../../actions";
import { MotDePasseProvisoire } from "../formulaire";

type Versement = {
  id: string;
  date: string;
  montant: number;
  note: string | null;
};

type LigneStockDetenu = {
  produit_id: string;
  produit: string;
  quantite: number;
};

/**
 * Barre d'actions de la fiche vendeur.
 *
 * Tout ce qui était auparavant en gros blocs sur la page est ici, derrière des
 * boutons. La page ne montre plus que de l'information.
 *
 * Les quatre dialogues sont FRÈRES, jamais imbriqués : un dialogue dans un
 * dialogue est une source d'ennuis (piège de focus, empilement de calques).
 * C'est pourquoi la désactivation a son propre bouton plutôt que d'être dans
 * les paramètres.
 */
export function BarreActions({
  profil,
  resteAVerser,
  stock,
}: {
  profil: Profil;
  resteAVerser: number;
  stock: LigneStockDetenu[];
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <DialogueVersement
        vendeurId={profil.id}
        nom={profil.nom}
        resteAVerser={resteAVerser}
      />
      {stock.length > 0 && (
        <DialogueRetourStock
          vendeurId={profil.id}
          nom={profil.nom}
          stock={stock}
        />
      )}
      <DialogueParametres profil={profil} />
      <BoutonActivation profil={profil} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Encaisser un versement
// ---------------------------------------------------------------------------

function DialogueVersement({
  vendeurId,
  nom,
  resteAVerser,
}: {
  vendeurId: string;
  nom: string;
  resteAVerser: number;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    encaisserVersement,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Encaisser un versement"
      variante="default"
      titre={`Encaisser un versement de ${nom}`}
      description={`${nom} doit ${euros(resteAVerser)}.`}
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="vendeur_id" value={vendeurId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="montant">Montant reçu</Label>
            <Input
              id="montant"
              name="montant"
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              // Pré-rempli au solde exact : c'est le cas courant.
              defaultValue={resteAVerser > 0 ? resteAVerser.toFixed(2) : ""}
              className="h-11 text-base"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date-versement">Date</Label>
            <Input
              id="date-versement"
              name="date"
              type="date"
              defaultValue={aujourdHui()}
              className="h-11 text-base"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="note-versement">Note (facultatif)</Label>
          <Input
            id="note-versement"
            name="note"
            placeholder="Espèces, remis en main propre"
            className="h-11 text-base"
          />
        </div>

        {/* Geste explicite, jamais coché par défaut : la borne SQL refuse un
            montant supérieur à la dette, et cette case est la seule
            échappatoire pour une avance légitime. */}
        <div className="flex items-start gap-2">
          <input
            id="excedent"
            type="checkbox"
            name="autoriser_excedent"
            value="1"
            className="mt-1 size-4"
          />
          <Label htmlFor="excedent" className="font-normal">
            Autoriser un montant supérieur à la dette (avance, arrondi de
            caisse)
          </Label>
        </div>

        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer le versement"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

// ---------------------------------------------------------------------------
// Paramètres du compte
// ---------------------------------------------------------------------------

function DialogueParametres({ profil }: { profil: Profil }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    modifierVendeur,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Paramètres du compte"
      titre={`Paramètres de ${profil.nom}`}
      jeton={etat.jeton}
    >
      <div className="space-y-5">
        <form action={action} className="space-y-4">
          <input type="hidden" name="vendeur_id" value={profil.id} />

          <div className="space-y-2">
            <Label htmlFor="p-nom">Nom</Label>
            <Input
              id="p-nom"
              name="nom"
              defaultValue={profil.nom}
              className="h-11 text-base"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-commission">Commission par unité</Label>
            <Input
              id="p-commission"
              name="commission_unitaire"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              defaultValue={profil.commission_unitaire}
              className="h-11 text-base"
              required
            />
            <p className="text-muted-foreground text-xs">
              Ne s&apos;applique qu&apos;aux ventes à venir : chaque vente
              passée a figé la sienne.
            </p>
          </div>

          {etat.erreur && (
            <Alert variant="destructive">
              <AlertDescription>{etat.erreur}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose render={<Button variant="outline">Fermer</Button>} />
            <Button type="submit" disabled={enCours}>
              {enCours ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </form>

        <BoutonReinitialiserMotDePasse vendeurId={profil.id} />
      </div>
    </DialogueAction>
  );
}

/** Formulaire simple, pas un dialogue : il vit DANS celui des paramètres. */
function BoutonReinitialiserMotDePasse({ vendeurId }: { vendeurId: string }) {
  const [etat, action, enCours] = useActionState<EtatActionSecret, FormData>(
    reinitialiserMotDePasse,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-muted-foreground text-xs">
        Aucun e-mail n&apos;est envoyé : le nouveau mot de passe s&apos;affiche
        ici, une seule fois.
      </p>
      <form action={action}>
        <input type="hidden" name="vendeur_id" value={vendeurId} />
        <Button
          type="submit"
          variant="outline"
          className="h-11 w-full"
          disabled={enCours}
        >
          {enCours ? "Réinitialisation…" : "Réinitialiser le mot de passe"}
        </Button>
      </form>

      {etat.motDePasse && <MotDePasseProvisoire motDePasse={etat.motDePasse} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activation — dialogue propre, jamais imbriqué dans les paramètres
// ---------------------------------------------------------------------------

function BoutonActivation({ profil }: { profil: Profil }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    basculerActivation,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  if (!profil.actif) {
    return (
      <form action={action}>
        <input type="hidden" name="vendeur_id" value={profil.id} />
        <input type="hidden" name="actif" value="1" />
        <Button
          type="submit"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          disabled={enCours}
        >
          {enCours ? "Réactivation…" : "Réactiver le compte"}
        </Button>
      </form>
    );
  }

  return (
    <Dialog key={etat.jeton ?? "initial"}>
      <DialogTrigger
        render={
          <Button variant="destructive" className="h-11 w-full sm:w-auto">
            Désactiver
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Désactiver {profil.nom} ?</DialogTitle>
          <DialogDescription>
            Il perdra immédiatement tout accès, y compris s&apos;il est
            connecté. Son historique, son stock détenu et sa dette sont
            conservés — la désactivation est réversible.
            <br />
            <br />
            La suppression d&apos;un compte n&apos;est pas proposée : elle
            échouerait dès qu&apos;un vendeur a un historique comptable, protégé
            en base.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <form action={action}>
            <input type="hidden" name="vendeur_id" value={profil.id} />
            <input type="hidden" name="actif" value="0" />
            <Button type="submit" variant="destructive" disabled={enCours}>
              {enCours ? "Désactivation…" : "Désactiver"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reprise de stock
// ---------------------------------------------------------------------------

function DialogueRetourStock({
  vendeurId,
  nom,
  stock,
}: {
  vendeurId: string;
  nom: string;
  stock: LigneStockDetenu[];
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    retournerStock,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Reprendre du stock"
      titre={`Reprendre du stock de ${nom}`}
      description="Les unités reprises repartent en entrepôt et redeviennent disponibles pour les réassorts."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="vendeur_id" value={vendeurId} />
        <ChampsRetour stock={stock} erreur={etat.erreur} enCours={enCours} />
      </form>
    </DialogueAction>
  );
}

function ChampsRetour({
  stock,
  erreur,
  enCours,
}: {
  stock: LigneStockDetenu[];
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
      <ul className="space-y-2">
        {stock.map((s) => {
          const saisi = Number(quantites[s.produit_id]) > 0;
          return (
            <li
              key={s.produit_id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={`ret-${s.produit_id}`}
                  className="truncate text-sm font-normal"
                >
                  {s.produit}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {s.quantite} détenue(s)
                </p>
              </div>
              <div className="shrink-0">
                {/* `name` posé seulement si une quantité est saisie : les deux
                    tableaux produit_id[]/quantite[] restent ainsi alignés. */}
                {saisi && (
                  <input type="hidden" name="produit_id" value={s.produit_id} />
                )}
                <Input
                  id={`ret-${s.produit_id}`}
                  {...(saisi ? { name: "quantite" } : {})}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={s.quantite}
                  step={1}
                  placeholder="0"
                  value={quantites[s.produit_id] ?? ""}
                  onChange={(e) =>
                    setQuantites((q) => ({
                      ...q,
                      [s.produit_id]: e.target.value,
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
        <Label htmlFor="motif-retour">Motif (facultatif)</Label>
        <Input
          id="motif-retour"
          name="motif"
          placeholder="Fin de mission, rééquilibrage"
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
            ? "Reprise…"
            : total === 0
              ? "Saisir une quantité"
              : `Reprendre ${total} u`}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Historique des versements — de l'INFORMATION, donc elle reste sur la page
// ---------------------------------------------------------------------------

export function ListeVersements({ versements }: { versements: Versement[] }) {
  if (versements.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        Aucun versement reçu.
      </p>
    );
  }

  return (
    <ul className="divide-y text-sm">
      {versements.map((v) => (
        <li key={v.id} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="tabular-nums">{euros(v.montant)}</p>
            <p className="text-muted-foreground text-xs">
              {date(v.date)}
              {v.note && ` · ${v.note}`}
            </p>
          </div>
          <BoutonSupprimerVersement versement={v} />
        </li>
      ))}
    </ul>
  );
}

function BoutonSupprimerVersement({ versement }: { versement: Versement }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    supprimerVersement,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  return (
    <Dialog key={etat.jeton ?? "initial"}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="shrink-0">
            Supprimer
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer ce versement ?</DialogTitle>
          <DialogDescription>
            {euros(versement.montant)} du {date(versement.date)}. La dette du
            vendeur remontera d&apos;autant.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <form action={action}>
            <input type="hidden" name="versement_id" value={versement.id} />
            <Button type="submit" variant="destructive" disabled={enCours}>
              {enCours ? "Suppression…" : "Supprimer"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
