"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Ouvre la boîte d'impression du navigateur, d'où l'on imprime ou enregistre
 * en PDF. Client uniquement pour cela : `window.print()` n'existe pas côté
 * serveur. Masqué à l'impression, comme toute la navigation.
 */
export function BoutonImprimer({
  libelle = "Imprimer ou enregistrer en PDF",
}: {
  libelle?: string;
}) {
  return (
    <Button
      onClick={() => window.print()}
      className="h-11 w-full sm:h-10 sm:w-auto print:hidden"
    >
      <PrinterIcon />
      {libelle}
    </Button>
  );
}
