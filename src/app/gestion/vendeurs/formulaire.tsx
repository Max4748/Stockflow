"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction, EtatActionSecret } from "@/lib/types";

import { annulerInvitation, creerVendeur } from "../actions";

/**
 * Création d'un compte vendeur.
 *
 * Opération en DEUX temps non atomiques : l'invitation, puis le compte. Si la
 * seconde échoue, l'action renvoie une erreur qui le dit explicitement — un
 * faux succès laisserait le patron croire que le vendeur peut se connecter.
 *
 * ⚠️ `jeton` n'est VOLONTAIREMENT pas passé à DialogueAction. Il y refermerait
 * le dialogue au succès (remontage par `key`), emportant avec lui le mot de
 * passe provisoire — affiché une seule fois et jamais stocké. Ici le dialogue
 * reste ouvert sur le secret, et c'est le gérant qui le ferme une fois copié.
 * Le `key` sur le <form> intérieur suffit à vider les champs.
 */
export function FormulaireCreationVendeur() {
  const [etat, action, enCours] = useActionState<EtatActionSecret, FormData>(
    creerVendeur,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Créer un compte vendeur"
      variante="default"
      titre="Créer un compte vendeur"
      description="Le mot de passe provisoire s'affiche ici une seule fois : aucun e-mail n'est envoyé, il se transmet de la main à la main."
    >
      <form
        action={action}
        key={etat.jeton ?? "initial"}
        className="grid gap-4 sm:grid-cols-2"
      >
        <div className="space-y-2">
          <Label htmlFor="v-nom">Nom</Label>
          <Input id="v-nom" name="nom" className="h-11 text-base" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="v-email">Adresse e-mail</Label>
          <Input
            id="v-email"
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            className="h-11 text-base"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="v-commission">Commission par unité</Label>
          <Input
            id="v-commission"
            name="commission_unitaire"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            defaultValue="0"
            className="h-11 text-base"
            required
          />
          <p className="text-muted-foreground text-xs">
            Figée à chaque vente : la modifier plus tard ne réécrit aucune dette
            passée.
          </p>
        </div>

        {etat.erreur && (
          <Alert variant="destructive" className="sm:col-span-2">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        {/* Plus de mot de passe à afficher ici : le compte est créé par
            invitation, et c'est le vendeur qui choisira le sien depuis le lien
            reçu. Il reste à confirmer À QUELLE adresse il est parti, seule
            information que le gérant doive vérifier avant de fermer. */}
        {etat.email && !etat.motDePasse && (
          <Alert className="sm:col-span-2">
            <AlertDescription>
              Lien d&apos;accès envoyé à <strong>{etat.email}</strong>. Il est
              valable une heure. Sans réception, la fiche du vendeur permet de
              lui attribuer un mot de passe provisoire.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Fermer</Button>} />
          <Button type="submit" disabled={enCours}>
            {enCours ? "Création…" : "Créer le compte"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

/**
 * Mot de passe provisoire, affiché UNE fois et jamais stocké.
 *
 * Ce n'est plus le chemin normal : la création d'un compte envoie désormais un
 * lien d'invitation, et le vendeur choisit lui-même son mot de passe. Ce
 * composant sert au SEUL cas restant, la réinitialisation depuis la fiche
 * quand le courriel n'arrive pas. C'est le filet, pas la route.
 */
export function MotDePasseProvisoire({
  email,
  motDePasse,
}: {
  email?: string;
  motDePasse: string;
}) {
  return (
    <Alert>
      <AlertDescription className="space-y-2">
        <p className="text-sm font-medium">
          Mot de passe provisoire{email ? ` pour ${email}` : ""} — affiché une
          seule fois
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-muted rounded px-2 py-1.5 font-mono text-base select-all">
            {motDePasse}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard
                .writeText(motDePasse)
                .then(() => toast.success("Copié."))
                .catch(() => toast.error("Copie impossible, le sélectionner."));
            }}
          >
            Copier
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Aucun e-mail n&apos;est envoyé : le transmettre de la main à la main.
          Le vendeur devra le remplacer à sa première connexion.
        </p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Retire une invitation restée sans compte.
 *
 * Un simple bouton dans l'avertissement, sans dialogue de confirmation : rien
 * n'est détruit qui ne se refasse en trois clics avec « Créer un compte
 * vendeur », et l'avertissement lui-même explique déjà ce qu'est cette
 * invitation. Un dialogue par-dessus n'ajouterait qu'une étape.
 */
export function BoutonAnnulerInvitation({ email }: { email: string }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    annulerInvitation,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="email" value={email} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="h-auto px-2 py-0.5 text-xs"
        disabled={enCours}
      >
        {enCours ? "Retrait…" : "Retirer"}
      </Button>
    </form>
  );
}
