import { ArrowLeftRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { basculerVersGestion, basculerVersVendeur } from "@/app/actions";

/**
 * Bascule d'espace pour un compte d'encadrement — il pilote ET vend.
 *
 * Server Component : un `<form action={…}>` sur une Server Action, exactement
 * comme le bouton Déconnexion des deux layouts. Aucun JavaScript client n'est
 * nécessaire pour poser un cookie et rediriger.
 *
 * Les layouts ne le montrent qu'à partir de `sm`. En dessous, la même bascule
 * est une entrée du menu du compte (`menu-compte.tsx`) : l'en-tête d'un
 * téléphone n'a pas la place d'un bouton à libellé.
 */
export function BasculeEspace({ vers }: { vers: "gestion" | "vendeur" }) {
  const action = vers === "gestion" ? basculerVersGestion : basculerVersVendeur;
  const libelle = vers === "gestion" ? "Gestion" : "Vendeur";

  return (
    <form action={action}>
      <Button type="submit" variant="outline">
        <ArrowLeftRightIcon />
        Espace {libelle.toLowerCase()}
      </Button>
    </form>
  );
}
