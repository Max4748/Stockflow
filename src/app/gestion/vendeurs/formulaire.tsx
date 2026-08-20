"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatActionSecret } from "@/lib/types";

import { creerVendeur } from "../actions";

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

        {/* Le secret reste DANS le dialogue, au-dessus des boutons : le fermer
            est le geste qui le fait disparaître, et c'est délibéré. */}
        {etat.motDePasse && (
          <div className="sm:col-span-2">
            <MotDePasseProvisoire
              email={etat.email}
              motDePasse={etat.motDePasse}
            />
          </div>
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
 * Le mot de passe provisoire n'est ni envoyé (aucun SMTP sur la machine) ni
 * stocké : il est affiché UNE fois. Perdu = réinitialisé depuis la fiche.
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
