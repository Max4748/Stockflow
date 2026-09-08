import { BoutonThemeFlottant } from "@/components/bouton-theme";
import { FormulaireConnexion } from "./formulaire";

export const metadata = { title: "Connexion — StockFlow" };

/**
 * `/auth/callback` renvoie ici avec `?erreur=lien-invalide` quand un lien de
 * réinitialisation est expiré, déjà consommé ou tronqué. Sans cette lecture,
 * l'utilisateur atterrissait sur une page de connexion muette et croyait à une
 * panne.
 */
const MESSAGES: Record<string, string> = {
  "lien-invalide":
    "Ce lien n'est plus valable. Les liens expirent au bout de 24 heures et ne servent qu'une fois. En demander un nouveau.",
};

export default async function PageLogin({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { erreur } = await searchParams;

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
        <FormulaireConnexion avertissement={erreur ? MESSAGES[erreur] : undefined} />
      </div>
    </main>
  );
}
