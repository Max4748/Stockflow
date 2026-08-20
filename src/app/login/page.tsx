import { BoutonThemeFlottant } from "@/components/bouton-theme";
import { FormulaireConnexion } from "./formulaire";

export const metadata = { title: "Connexion — StockFlow" };

export default function PageLogin() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <BoutonThemeFlottant />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">StockFlow</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Gestion de stock et de ventes
          </p>
        </div>
        <FormulaireConnexion />
      </div>
    </main>
  );
}
