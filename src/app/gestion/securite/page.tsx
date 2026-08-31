import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { exigerAdminSansFacteur } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";

import { GestionFacteur } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sécurité — StockFlow" };

export default async function PageSecurite() {
  // `exigerAdminSansFacteur` et non `exigerAdmin` : activer la 2FA se fait
  // depuis une session en `aal1`, qu'`exigerAdmin` renverrait vers
  // `/verification` — laquelle ne peut rien demander tant qu'aucun facteur
  // n'est vérifié. L'écran serait inatteignable.
  await exigerAdminSansFacteur();

  const supabase = await creerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const facteurVerifie =
    data?.totp?.find((f) => f.status === "verified")?.id ?? null;

  return (
    <div className="w-full space-y-6">
      <h1 className="text-xl font-semibold">Sécurité du compte</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Double authentification</CardTitle>
        </CardHeader>
        <CardContent>
          <GestionFacteur facteurVerifie={facteurVerifie} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            En cas de perte de l&apos;authentificateur
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Sans l&apos;application d&apos;authentification, ce compte ne peut
            plus atteindre l&apos;espace de gestion : l&apos;écran de
            vérification ne propose que la déconnexion. L&apos;accès se
            rétablit en supprimant le facteur en base, depuis Studio ou en SSH.
          </p>
          <code className="bg-muted block rounded-md px-3 py-2 font-mono text-xs break-all">
            delete from auth.mfa_factors where user_id = (select id from
            auth.users where email = &apos;adresse@exemple.fr&apos;);
          </code>
          <p className="text-muted-foreground text-xs">
            Éprouver cette procédure une fois avant d&apos;en dépendre. Elle
            demande un accès au serveur : un gérant qui n&apos;en a pas dépend
            du dev pour être débloqué.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
