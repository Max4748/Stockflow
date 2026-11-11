import { CadreAuth } from "@/components/cadre-auth";

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
    <CadreAuth titre="StockFlow" description="Gestion de stock et de ventes">
      <FormulaireConnexion avertissement={erreur ? MESSAGES[erreur] : undefined} />
    </CadreAuth>
  );
}
