"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { demanderReinitialisation, type EtatOubli } from "./actions";

function BoutonEnvoyer() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Envoi…" : "Envoyer le lien"}
    </Button>
  );
}

export function FormulaireOubli() {
  const [etat, action] = useActionState<EtatOubli, FormData>(
    demanderReinitialisation,
    {},
  );

  if (etat.envoye) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Alert>
            <AlertDescription>
              Si un compte existe avec cette adresse, un lien vient d&apos;être
              envoyé. Il est valable 24 heures. Penser à regarder dans les
              indésirables.
            </AlertDescription>
          </Alert>
          {/* `buttonVariants` et non `asChild` : ce shadcn est monté sur
              base-ui, qui compose par `render` et n'a pas de `asChild`. */}
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Retour à la connexion
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="space-y-4">
          {etat.erreur && (
            <Alert variant="destructive">
              <AlertDescription>{etat.erreur}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              required
              autoFocus
            />
          </div>

          <BoutonEnvoyer />
        </form>
      </CardContent>
    </Card>
  );
}
