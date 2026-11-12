import { DownloadIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Lien de téléchargement d'un export CSV.
 *
 * Un `<a>` ordinaire et NON un `<Link>` : la cible est un fichier servi par un
 * Route Handler. `<Link>` la préchargerait au survol (un export complet lancé
 * pour rien) et tenterait une navigation dans l'application.
 *
 * Mêmes hauteurs que les autres boutons d'en-tête de page.
 */
export function BoutonExport({
  href,
  libelle = "Exporter en CSV",
}: {
  href: string;
  libelle?: string;
}) {
  return (
    <a
      href={href}
      download
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-11 w-full sm:h-10 sm:w-auto",
      )}
    >
      <DownloadIcon />
      {libelle}
    </a>
  );
}
