"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtatAction } from "@/lib/types";

import { seConnecter } from "./actions";

export function FormulaireConnexion({
  avertissement,
}: {
  avertissement?: string;
}) {
  const [etat, action, enCours] = useActionState<EtatAction, FormData>(
    seConnecter,
    {},
  );

  return (
    <Card>
      <CardContent className="pt-6">
        {/* Hors du <form> : il survit à une soumission, alors qu'`etat.erreur`
            est remis à zéro à chaque tentative. */}
        {avertissement && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{avertissement}</AlertDescription>
          </Alert>
        )}

        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="motDePasse">Mot de passe</Label>
            <Input
              id="motDePasse"
              name="motDePasse"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {etat.erreur && (
            <Alert variant="destructive">
              <AlertDescription>{etat.erreur}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={enCours}>
            {enCours ? "Connexion…" : "Se connecter"}
          </Button>

          <p className="text-muted-foreground text-center text-xs">
            <Link
              href="/mot-de-passe-oublie"
              className="hover:text-foreground underline"
            >
              Mot de passe oublié ?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
