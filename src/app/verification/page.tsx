import { redirect } from "next/navigation";

import { BoutonTheme } from "@/components/bouton-theme";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { exigerAdminSansFacteur } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";

import { seDeconnecter } from "../login/actions";
import { FormulaireVerification } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vérification — StockFlow" };

export default async function PageVerification() {
  // Sans contrôle du facteur : `exigerAdmin()` redirigerait vers cette page.
  await exigerAdminSansFacteur();

  const supabase = await creerClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  // Déjà vérifié, ou aucun facteur enregistré : cette page n'a rien à demander.
  // Sans ce garde-fou elle resterait atteignable en tapant l'URL, et
  // afficherait un formulaire qui ne peut que refuser.
  if (data?.currentLevel === "aal2" || data?.nextLevel !== "aal2") {
    redirect("/gestion");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-end">
          <BoutonTheme />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Vérification</CardTitle>
            <CardDescription>
              Saisir le code affiché par l&apos;application
              d&apos;authentification.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormulaireVerification />
          </CardContent>
        </Card>

        {/* Seule sortie possible depuis cet écran : sans elle, un compte dont
            l'authentificateur est perdu resterait bloqué sur une page qu'il ne
            peut pas franchir, sans même pouvoir se déconnecter. */}
        <form action={seDeconnecter} className="flex justify-center">
          <Button type="submit" variant="ghost" size="sm">
            Déconnexion
          </Button>
        </form>
      </div>
    </main>
  );
}
