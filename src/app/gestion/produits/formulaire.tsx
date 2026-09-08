"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { DialogueAction } from "@/components/dialogue-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction, Modele, Produit } from "@/lib/types";

import {
  creerModeleAvecParfums,
  enregistrerModele,
  enregistrerParfum,
  retirerModele,
  retirerProduit,
} from "../actions";

/**
 * Les champs communs à tout formulaire de modèle : prix et les deux seuils.
 *
 * Extraits parce que la création groupée et l'édition les partagent mot pour
 * mot — deux copies auraient divergé au premier ajustement de libellé.
 */
function ChampsModele({
  cle,
  modele,
}: {
  cle: string;
  modele?: Pick<Modele, "prix_vente_conseille" | "seuil_parfum" | "seuil_modele">;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`prix-${cle}`}>Prix conseillé</Label>
          <Input
            id={`prix-${cle}`}
            name="prix_vente_conseille"
            type="number"
            step="0.01"
            min={0}
            defaultValue={modele?.prix_vente_conseille ?? 0}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`sp-${cle}`}>Seuil par parfum</Label>
          <Input
            id={`sp-${cle}`}
            name="seuil_parfum"
            type="number"
            min={0}
            defaultValue={modele?.seuil_parfum ?? 3}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`sm-${cle}`}>Seuil du modèle</Label>
          <Input
            id={`sm-${cle}`}
            name="seuil_modele"
            type="number"
            min={0}
            defaultValue={modele?.seuil_modele ?? 0}
            required
          />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Le prix est partagé par tous les parfums du modèle ; celui pratiqué est
        figé à chaque vente. Les deux seuils répondent à deux questions : le
        premier dit quel parfum manque, le second si le modèle s&apos;éteint.
        Seuil du modèle à <strong>0</strong> = alerte désactivée.
      </p>
    </>
  );
}

/**
 * Créer un modèle ET ses premiers parfums d'un coup.
 *
 * Le prix étant partagé, saisir huit parfums un par un voudrait dire ressaisir
 * le modèle huit fois. Les parfums restent ajoutables plus tard depuis la fiche
 * du modèle : ce dialogue est le raccourci du premier jour, pas le seul chemin.
 */
export function DialogueNouveauModele() {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    creerModeleAvecParfums,
    {},
  );
  const [parfums, setParfums] = useState<string[]>(["", "", ""]);

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  return (
    <DialogueAction
      libelle="Nouveau modèle"
      variante="default"
      taille="large"
      titre="Nouveau modèle"
      description="Le modèle porte le prix et les seuils. Ses parfums sont les unités de stock."
      jeton={etat.jeton}
    >
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nm-nom">Nom du modèle</Label>
          <Input
            id="nm-nom"
            name="nom"
            placeholder="JNR Falcon X 18K"
            required
          />
        </div>

        <ChampsModele cle="nouveau" />

        <div className="space-y-2 border-t pt-4">
          <Label>Parfums</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {parfums.map((v, i) => (
              <Input
                key={i}
                name="parfum"
                value={v}
                placeholder={`Parfum ${i + 1}`}
                onChange={(e) =>
                  setParfums((p) =>
                    p.map((x, j) => (j === i ? e.target.value : x)),
                  )
                }
              />
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setParfums((p) => [...p, ""])}
          >
            Ajouter une ligne
          </Button>
          <p className="text-muted-foreground text-xs">
            Les lignes vides sont ignorées. On peut n&apos;en saisir aucune et
            les ajouter plus tard.
          </p>
        </div>

        {etat.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline">Annuler</Button>} />
          <Button type="submit" disabled={enCours}>
            {enCours ? "Création…" : "Créer le modèle"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

/** Modifier un modèle, et le retirer depuis le pied du même dialogue. */
export function DialogueModele({ modele }: { modele: Modele }) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    enregistrerModele,
    {},
  );
  const [etatRetrait, actionRetrait, retraitEnCours] = useActionState<
    EtatAction,
    FormData
  >(retirerModele, {});

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  useEffect(() => {
    if (etatRetrait.succes) toast.success(etatRetrait.succes);
    if (etatRetrait.erreur) toast.error(etatRetrait.erreur);
  }, [etatRetrait.succes, etatRetrait.erreur, etatRetrait.jeton]);

  return (
    <DialogueAction
      libelle="Modifier"
      variante="outline"
      tailleBouton="sm"
      titre={`Modifier ${modele.nom}`}
      // Les deux jetons concaténés : `??` garderait celui de l'édition une fois
      // posé, et un retrait réussi ensuite ne fermerait plus le dialogue.
      jeton={`${etat.jeton ?? ""}-${etatRetrait.jeton ?? ""}`}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="id" value={modele.id} />

        <div className="space-y-2">
          <Label htmlFor={`nom-${modele.id}`}>Nom du modèle</Label>
          <Input
            id={`nom-${modele.id}`}
            name="nom"
            defaultValue={modele.nom}
            required
          />
        </div>

        <ChampsModele cle={modele.id} modele={modele} />

        <div className="flex items-center gap-2">
          <input
            id={`actif-${modele.id}`}
            type="checkbox"
            name="actif"
            value="1"
            defaultChecked={modele.actif}
            className="size-4"
          />
          <Label htmlFor={`actif-${modele.id}`} className="font-normal">
            Actif — ses parfums sont proposés à la vente et au réassort
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
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>

      {/* Hors du <form> ci-dessus : deux formulaires ne s'imbriquent pas en
          HTML. Désactiver un modèle désactive ses parfums, puisque le prix vit
          sur lui et qu'un parfum sans prix n'est pas vendable. */}
      <form action={actionRetrait} className="mt-2 border-t pt-4">
        <input type="hidden" name="modele_id" value={modele.id} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs">
            Retirer du catalogue : supprimé s&apos;il n&apos;a aucun parfum,
            passé inactif sinon — et ses parfums avec lui.
          </p>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={retraitEnCours}
          >
            {retraitEnCours ? "Retrait…" : "Retirer"}
          </Button>
        </div>
      </form>
    </DialogueAction>
  );
}

/**
 * Ajouter ou modifier un parfum.
 *
 * Ni prix ni seuil ici : ils vivent sur le modèle. Un parfum n'a qu'un nom, un
 * SKU facultatif, et un état.
 */
export function DialogueParfum({
  modele,
  parfum,
}: {
  modele: Modele;
  parfum?: Produit;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    enregistrerParfum,
    {},
  );
  const [etatRetrait, actionRetrait, retraitEnCours] = useActionState<
    EtatAction,
    FormData
  >(retirerProduit, {});

  useEffect(() => {
    if (etat.succes) toast.success(etat.succes);
  }, [etat.succes, etat.jeton]);

  useEffect(() => {
    if (etatRetrait.succes) toast.success(etatRetrait.succes);
    if (etatRetrait.erreur) toast.error(etatRetrait.erreur);
  }, [etatRetrait.succes, etatRetrait.erreur, etatRetrait.jeton]);

  const cle = parfum?.id ?? `new-${modele.id}`;

  return (
    <DialogueAction
      libelle={parfum ? "Modifier" : "Ajouter un parfum"}
      variante="outline"
      tailleBouton="sm"
      titre={parfum ? `Modifier ${parfum.nom}` : `Nouveau parfum · ${modele.nom}`}
      jeton={`${etat.jeton ?? ""}-${etatRetrait.jeton ?? ""}`}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="modele_id" value={modele.id} />
        {parfum && <input type="hidden" name="id" value={parfum.id} />}

        <div className="space-y-2">
          <Label htmlFor={`pnom-${cle}`}>Parfum</Label>
          <Input
            id={`pnom-${cle}`}
            name="nom"
            defaultValue={parfum?.nom ?? ""}
            placeholder="Mangue"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`psku-${cle}`}>SKU (facultatif)</Label>
          <Input
            id={`psku-${cle}`}
            name="sku"
            defaultValue={parfum?.sku ?? ""}
          />
          <p className="text-muted-foreground text-xs">
            Unique dans tout le catalogue, contrairement au nom du parfum qui ne
            l&apos;est que dans son modèle.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            id={`pactif-${cle}`}
            type="checkbox"
            name="actif"
            value="1"
            defaultChecked={parfum?.actif ?? true}
            className="size-4"
          />
          <Label htmlFor={`pactif-${cle}`} className="font-normal">
            Actif
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
            {enCours ? "Enregistrement…" : parfum ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </form>

      {parfum && (
        <form action={actionRetrait} className="mt-2 border-t pt-4">
          <input type="hidden" name="id" value={parfum.id} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              Retirer : supprimé s&apos;il n&apos;a jamais servi, passé inactif
              s&apos;il a un historique.
            </p>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={retraitEnCours}
            >
              {retraitEnCours ? "Retrait…" : "Retirer"}
            </Button>
          </div>
        </form>
      )}
    </DialogueAction>
  );
}
