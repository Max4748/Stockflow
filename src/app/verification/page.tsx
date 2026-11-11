import { redirect } from "next/navigation";

import { CadreAuth } from "@/components/cadre-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <CadreAuth
      titre="Vérification"
      description="Saisir le code affiché par l'application d'authentification."
      // Seule sortie possible depuis cet écran : sans elle, un compte dont
      // l'authentificateur est perdu resterait bloqué sur une page qu'il ne
      // peut pas franchir, sans même pouvoir se déconnecter.
      pied={
        <form action={seDeconnecter}>
          <Button type="submit" variant="ghost">
            Déconnexion
          </Button>
        </form>
      }
    >
      <Card>
        <CardContent>
          <FormulaireVerification />
        </CardContent>
      </Card>
    </CadreAuth>
  );
}
