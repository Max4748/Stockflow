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
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <Link
            key={p.cle}
            href={lien(p.cle)}
            aria-current={actif === p.cle ? "true" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              actif === p.cle
                ? "bg-muted text-foreground border-foreground/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
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
            className="h-9 w-auto"
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
            className="h-9 w-auto"
          />
        </div>
        <Button type="submit" variant="outline" className="h-9">
          Appliquer
        </Button>
      </form>
    </div>
  );
}
