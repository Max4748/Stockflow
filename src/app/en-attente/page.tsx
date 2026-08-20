import { BoutonThemeFlottant } from "@/components/bouton-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { seDeconnecter } from "../login/actions";

export const metadata = { title: "Compte en attente — StockFlow" };

export default function PageEnAttente() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <BoutonThemeFlottant />
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 pt-6 text-center">
          <h1 className="text-lg font-semibold">Compte non activé</h1>
          <p className="text-muted-foreground text-sm">
            Ce compte existe mais n&apos;a pas encore été activé par
            l&apos;administrateur. Aucune donnée n&apos;est accessible tant que
            ce n&apos;est pas fait.
          </p>
          <form action={seDeconnecter}>
            <Button type="submit" variant="outline" className="w-full">
              Se déconnecter
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
