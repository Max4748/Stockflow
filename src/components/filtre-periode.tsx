"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PRESETS, type ClePeriode } from "@/lib/periode";
import { cn } from "@/lib/utils";

/**
 * Filtre de période. Les préréglages sont de simples liens : ils changent
 * l'URL, la page se rerend côté serveur avec les nouvelles bornes. Pas d'état
 * client, pas de rechargement de données à la main.
 */
export function FiltrePeriode({ actif }: { actif: ClePeriode }) {
  const chemin = usePathname();
  const params = useSearchParams();

  function lien(cle: ClePeriode) {
    const p = new URLSearchParams(params);
    p.set("periode", cle);
    // Les bornes libres n'ont pas de sens sur un préréglage : on les retire
    // pour ne pas laisser traîner des paramètres contradictoires dans l'URL.
    p.delete("du");
    p.delete("au");
    p.delete("page");
    return `${chemin}?${p.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      {/* Un sélecteur segmenté : les préréglages s'excluent, et un seul bloc
          le dit mieux que quatre boutons côte à côte. */}
      <div className="bg-muted flex flex-wrap gap-0.5 rounded-lg p-0.5">
        {PRESETS.map((p) => (
          <Link
            key={p.cle}
            href={lien(p.cle)}
            aria-current={actif === p.cle ? "true" : undefined}
            className={cn(
              "flex min-h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
              actif === p.cle
                ? "bg-card text-primary shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.libelle}
          </Link>
        ))}
      </div>

      {/* Bornes libres : un GET, donc toujours pas d'état client. */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="periode" value="libre" />
        <div>
          <label htmlFor="du" className="text-muted-foreground block text-xs">
            Du
          </label>
          <Input
            id="du"
            name="du"
            type="date"
            defaultValue={params.get("du") ?? ""}
            className="w-auto"
          />
        </div>
        <div>
          <label htmlFor="au" className="text-muted-foreground block text-xs">
            Au
          </label>
          <Input
            id="au"
            name="au"
            type="date"
            defaultValue={params.get("au") ?? ""}
            className="w-auto"
          />
        </div>
        <Button type="submit" variant="outline" className="h-10">
          Appliquer
        </Button>
      </form>
    </div>
  );
}
