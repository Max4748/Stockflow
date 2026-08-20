import { Button } from "@/components/ui/button";

import { basculerVersGestion, basculerVersVendeur } from "@/app/actions";

/**
 * Bascule d'espace pour un compte d'encadrement — il pilote ET vend.
 *
 * Server Component : un `<form action={…}>` sur une Server Action, exactement
 * comme le bouton Déconnexion des deux layouts. Aucun JavaScript client n'est
 * nécessaire pour poser un cookie et rediriger.
 *
 * Le libellé se raccourcit sous `sm` : l'en-tête vendeur porte déjà le thème,
 * la déconnexion et, à partir de `md`, la navigation.
 */
export function BasculeEspace({ vers }: { vers: "gestion" | "vendeur" }) {
  const action = vers === "gestion" ? basculerVersGestion : basculerVersVendeur;
  const libelle = vers === "gestion" ? "Gestion" : "Vendeur";

  return (
    <form action={action}>
      {/* Pas d'espace insécable ici : le Button est un conteneur flex avec son
          propre `gap`, l'ajouter produisait un double blanc (« Espace  Gestion »). */}
      <Button type="submit" variant="outline" size="sm">
        <span className="hidden sm:inline">Espace</span>
        {libelle}
      </Button>
    </form>
  );
}
