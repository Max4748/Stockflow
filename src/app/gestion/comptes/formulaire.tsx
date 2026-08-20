"use client";

import { useActionState, useEffect } from "react";
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
import type { EtatAction, EtatActionSecret } from "@/lib/types";

import { changerRole, creerVendeur } from "../actions";
import { MotDePasseProvisoire } from "../vendeurs/formulaire";

/**
 * Création d'un compte gérant.
 *
 * Réutilise volontairement `creerVendeur` : le flux est identique (invitation
 * puis compte via la clé service_role), seul le rôle demandé change. C'est le
 * SQL qui arbitre — inviter_utilisateur refuse tout niveau supérieur ou égal à
 * celui de l'appelant, donc ce champ caché n'est pas une autorisation, juste
 * une demande.
 */
export function FormulaireCreationGerant() {
  const [etat, action, enCours] = useActionState<EtatActionSecret, FormData>(
    creerVendeur,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    // `jeton` volontairement absent : le refermer au succès emporterait le mot
    // de passe provisoire, affiché une seule fois. Même motif que la création
    // d'un vendeur — voir gestion/vendeurs/formulaire.tsx.
    <DialogueAction
      libelle="Créer un compte gérant"
      variante="default"
      titre="Créer un compte gérant"
      description="Le mot de passe provisoire s'affiche ici une seule fois : aucun e-mail n'est envoyé, il se transmet de la main à la main."
    >
      <form
        action={action}
        key={etat.jeton ?? "initial"}
        className="grid gap-4 sm:grid-cols-2"
      >
        <input type="hidden" name="role" value="gerant" />
        {/* Un gérant n'a pas de commission : il ne vend pas. */}
        <input type="hidden" name="commission_unitaire" value="0" />

        <div className="space-y-2">
          <Label htmlFor="g-nom">Nom</Label>
          <Input id="g-nom" name="nom" className="h-11 text-base" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="g-email">Adresse e-mail</Label>
          <Input
            id="g-email"
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            className="h-11 text-base"
            required
          />
        </div>

        {etat.erreur && (
          <Alert variant="destructive" className="sm:col-span-2">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

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
            {enCours ? "Création…" : "Créer le compte gérant"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

/** Promotion vendeur → gérant, ou rétrogradation gérant → vendeur. */
export function LigneRole({
  compteId,
  nom,
  versVendeur = false,
}: {
  compteId: string;
  nom: string;
  versVendeur?: boolean;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    changerRole,
    {},
  );

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
    if (etat.erreur) toast.error(etat.erreur);
  }, [etat.succes, etat.erreur, etat.jeton]);

  const cible = versVendeur ? "vendeur" : "gerant";

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="w-full md:w-auto">
            {versVendeur ? "Rétrograder" : "Promouvoir gérant"}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {versVendeur
              ? `Rétrograder ${nom} en vendeur ?`
              : `Promouvoir ${nom} gérant ?`}
          </DialogTitle>
          <DialogDescription>
            {versVendeur
              ? "Il perdra l'accès à la gestion et retrouvera l'espace vendeur. Son historique de ventes et sa dette sont conservés."
              : "Il accédera au bilan, aux marges, aux achats et aux créances de tous les vendeurs. Ses propres ventes passées restent dans l'historique, mais il n'apparaîtra plus dans les créances : un gérant n'est pas censé vendre."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <form action={action}>
            <input type="hidden" name="compte_id" value={compteId} />
            <input type="hidden" name="role" value={cible} />
            <Button type="submit" disabled={enCours}>
              {enCours ? "Modification…" : "Confirmer"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
