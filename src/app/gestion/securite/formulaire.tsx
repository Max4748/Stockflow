"use client";

import { useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  confirmerEnrolement,
  demarrerEnrolement,
  retirerFacteur,
  type EtatMfa,
} from "./actions";

type Enrolement = { factorId: string; qr: string; secret: string };

/**
 * Enrôlement et retrait d'un authentificateur TOTP.
 *
 * Trois états, jamais deux à l'écran en même temps : protégé, enrôlement en
 * cours, pas encore activé. Le QR code n'existe que le temps de l'enrôlement
 * et n'est jamais rendu par le serveur — il vient d'un appel explicite, pour
 * qu'un secret ne traîne pas dans le HTML d'une page simplement ouverte.
 */
export function GestionFacteur({
  facteurVerifie,
}: {
  facteurVerifie: string | null;
}) {
  const [etatConfirmation, actionConfirmer, confirmationEnCours] =
    useActionState<EtatMfa, FormData>(confirmerEnrolement, {});
  const [etatRetrait, actionRetirer, retraitEnCours] = useActionState<
    EtatMfa,
    FormData
  >(retirerFacteur, {});

  const [enrolement, setEnrolement] = useState<Enrolement | null>(null);
  const [erreurDemarrage, setErreurDemarrage] = useState<string | null>(null);
  const [demarrageEnCours, setDemarrageEnCours] = useState(false);

  async function demarrer() {
    setDemarrageEnCours(true);
    setErreurDemarrage(null);
    const res = await demarrerEnrolement();
    setDemarrageEnCours(false);

    if (res.erreur || !res.factorId || !res.qr || !res.secret) {
      setErreurDemarrage(res.erreur ?? "Impossible de démarrer l'enrôlement.");
      return;
    }
    setEnrolement({ factorId: res.factorId, qr: res.qr, secret: res.secret });
  }

  if (facteurVerifie) {
    return (
      <div className="space-y-4">
        {etatRetrait.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etatRetrait.erreur}</AlertDescription>
          </Alert>
        )}
        <Alert>
          <AlertDescription>
            Ce compte est protégé par un second facteur. Un code à 6 chiffres
            est demandé à chaque connexion.
          </AlertDescription>
        </Alert>

        <form action={actionRetirer}>
          <input type="hidden" name="factorId" value={facteurVerifie} />
          <Button type="submit" variant="outline" disabled={retraitEnCours}>
            {retraitEnCours ? "Désactivation…" : "Désactiver"}
          </Button>
        </form>
      </div>
    );
  }

  if (enrolement) {
    return (
      <div className="space-y-4">
        {etatConfirmation.erreur && (
          <Alert variant="destructive">
            <AlertDescription>{etatConfirmation.erreur}</AlertDescription>
          </Alert>
        )}

        {/* DEUX ÉTAPES, PAS TROIS. Le QR et la clé sont deux moyens de faire
            la MÊME chose : ajouter le compte à l'application. Les numéroter à
            la suite faisait lire « scanner, PUIS saisir la clé », et donnait
            l'impression qu'un enrôlement réussi demandait les deux. */}
        <ol className="text-muted-foreground space-y-5 text-sm">
          <li>
            <span className="text-foreground font-medium">1.</span> Ajouter
            StockFlow à une application d&apos;authentification (Google
            Authenticator, Aegis, Bitwarden…), par l&apos;un ou l&apos;autre de
            ces moyens.
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-4">
              {/* Fond blanc imposé : un QR code sombre sur sombre ne se scanne
                  pas, et le SVG de Supabase n'a pas de fond propre. */}
              <div className="shrink-0 rounded-lg bg-white p-3">
                {/* `qr_code` est une data URI (`data:image/svg+xml;utf-8,<svg…`),
                    pas du SVG nu. L'injecter en innerHTML affichait le préfixe
                    en texte au-dessus du code. Un `img` la consomme telle
                    quelle, et supprime au passage le dangerouslySetInnerHTML. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrolement.qr}
                  alt="QR code d'enrôlement de la double authentification"
                  className="size-40"
                />
              </div>
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                ou
              </span>
              <div className="min-w-50 flex-1">
                Pas de caméra ? Saisir cette clé à la main :
                <code className="bg-muted mt-2 block rounded-md px-3 py-2 font-mono text-xs break-all">
                  {enrolement.secret}
                </code>
              </div>
            </div>
          </li>
          <li>
            <span className="text-foreground font-medium">2.</span> Saisir le
            code affiché par l&apos;application pour confirmer.
          </li>
        </ol>

        <form action={actionConfirmer} className="space-y-3">
          <input type="hidden" name="factorId" value={enrolement.factorId} />
          <div className="max-w-xs space-y-2">
            <Label htmlFor="code">Code à 6 chiffres</Label>
            <Input
              id="code"
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="text-center text-lg tracking-[0.4em]"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={confirmationEnCours}>
              {confirmationEnCours ? "Vérification…" : "Confirmer"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEnrolement(null)}
            >
              Annuler
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {erreurDemarrage && (
        <Alert variant="destructive">
          <AlertDescription>{erreurDemarrage}</AlertDescription>
        </Alert>
      )}
      {etatConfirmation.succes && (
        <Alert>
          <AlertDescription>{etatConfirmation.succes}</AlertDescription>
        </Alert>
      )}

      <p className="text-muted-foreground text-sm">
        Ce compte voit les coûts d&apos;achat, les marges et l&apos;argent dû
        par chaque vendeur. Un second facteur ajoute un code à 6 chiffres au mot
        de passe, pour ce compte seulement : les autres ne sont pas affectés.
      </p>

      <Button type="button" onClick={demarrer} disabled={demarrageEnCours}>
        {demarrageEnCours ? "Préparation…" : "Activer"}
      </Button>
    </div>
  );
}
