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

import { changerRole, changerStockLie, creerVendeur } from "../actions";
import { DialogueCompteCree } from "../vendeurs/formulaire";

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
    <>
    <DialogueAction
      libelle="Créer un compte gérant"
      variante="default"
      // Se ferme au succès : le résultat a son propre dialogue.
      jeton={etat.jeton}
      titre="Créer un compte gérant"
      description="Un lien d'accès part par e-mail. Il s'affiche ensuite pour le transmettre autrement si besoin."
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



        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Fermer</Button>} />
          <Button type="submit" disabled={enCours}>
            {enCours ? "Création…" : "Créer le compte gérant"}
          </Button>
        </div>
      </form>
    </DialogueAction>
      <DialogueCompteCree etat={etat} />
    </>
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

/**
 * Déclare que l'entrepôt est le stock de ce compte.
 *
 * Un bouton et non une case à cocher : une case suggère un enregistrement à
 * venir, alors que l'effet est immédiat. Le libellé dit ce qui va se passer,
 * pas l'état courant, celui-ci étant déjà porté par la pastille de la ligne.
 */
export function BoutonStockLie({
  compteId,
  nom,
  lie,
}: {
  compteId: string;
  nom: string;
  lie: boolean;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    changerStockLie,
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
          <Button variant="outline" size="sm" className="w-full md:w-auto">
            {lie ? "Délier de l'entrepôt" : "Lier à l'entrepôt"}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {lie
              ? `Délier ${nom} de l'entrepôt ?`
              : `L'entrepôt est-il chez ${nom} ?`}
          </DialogTitle>
          <DialogDescription>
            {lie
              ? "Il devra de nouveau recevoir du stock avant de pouvoir vendre, comme un vendeur sur le terrain."
              : "Ses ventes puiseront directement dans l'entrepôt, sans qu'il ait à se transférer du stock au préalable. Le transfert reste écrit dans le journal, il disparaît seulement de son écran. À n'activer que pour qui détient physiquement l'entrepôt."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <form action={action}>
            <input type="hidden" name="compte_id" value={compteId} />
            <input type="hidden" name="lie" value={lie ? "0" : "1"} />
            <Button type="submit" disabled={enCours}>
              {enCours ? "Modification…" : "Confirmer"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
