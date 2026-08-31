"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { verifierCode, type EtatVerification } from "./actions";

function BoutonValider() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Vérification…" : "Valider"}
    </Button>
  );
}

export function FormulaireVerification() {
  const [etat, action] = useActionState<EtatVerification, FormData>(
    verifierCode,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      {etat.erreur && (
        <Alert variant="destructive">
          <AlertDescription>{etat.erreur}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="code">Code à 6 chiffres</Label>
        {/* `one-time-code` : c'est ce qui déclenche la proposition de
            remplissage automatique sur iOS et Android. */}
        <Input
          id="code"
          name="code"
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className="text-center text-lg tracking-[0.4em]"
        />
      </div>

      <BoutonValider />
    </form>
  );
}
