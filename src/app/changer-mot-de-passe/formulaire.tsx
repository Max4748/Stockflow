"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction } from "@/lib/types";

import { changerMotDePasse } from "./actions";

export function FormulaireMotDePasse() {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    changerMotDePasse,
    {},
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nouveau">Nouveau mot de passe</Label>
            <Input
              id="nouveau"
              name="nouveau"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              10 caractères minimum.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmation">Confirmation</Label>
            <Input
              id="confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>

          {etat.erreur && (
            <Alert variant="destructive">
              <AlertDescription>{etat.erreur}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
