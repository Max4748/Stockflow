import Link from "next/link";

import { CadreAuth } from "@/components/cadre-auth";

import { FormulaireOubli } from "./formulaire";

export const metadata = { title: "Mot de passe oublié — StockFlow" };

export default function PageMotDePasseOublie() {
  return (
    <CadreAuth
      titre="Mot de passe oublié"
      description="Saisir l'adresse du compte pour recevoir un lien."
      pied={
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline"
        >
          Retour à la connexion
        </Link>
      }
    >
      <FormulaireOubli />
    </CadreAuth>
  );
}
