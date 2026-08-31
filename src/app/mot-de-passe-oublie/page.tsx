import Link from "next/link";

import { BoutonThemeFlottant } from "@/components/bouton-theme";

import { FormulaireOubli } from "./formulaire";

export const metadata = { title: "Mot de passe oublié — StockFlow" };

export default function PageMotDePasseOublie() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <BoutonThemeFlottant />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Mot de passe oublié
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Saisir l&apos;adresse du compte pour recevoir un lien.
          </p>
        </div>

        <FormulaireOubli />

        <p className="text-muted-foreground mt-6 text-center text-xs">
          <Link href="/login" className="hover:text-foreground underline">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </main>
  );
}
