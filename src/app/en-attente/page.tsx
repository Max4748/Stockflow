import { CadreAuth } from "@/components/cadre-auth";
import { Button } from "@/components/ui/button";

import { seDeconnecter } from "../login/actions";

export const metadata = { title: "Compte en attente — StockFlow" };

export default function PageEnAttente() {
  return (
    <CadreAuth
      titre="Compte non activé"
      description="Ce compte existe mais n'a pas encore été activé par l'administrateur. Aucune donnée n'est accessible tant que ce n'est pas fait."
    >
      <form action={seDeconnecter}>
        <Button type="submit" variant="outline" size="lg" className="w-full">
          Se déconnecter
        </Button>
      </form>
    </CadreAuth>
  );
}
