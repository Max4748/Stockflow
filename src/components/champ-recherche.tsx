"use client";

import { SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";

/**
 * Champ de recherche piloté par l'URL (`?q=…`).
 *
 * Un formulaire GET, comme les bornes libres du filtre de période : pas d'état
 * client, la page se rerend côté serveur avec la recherche, et le résultat se
 * partage par lien. Les autres paramètres (période, tri, filtres) sont
 * reconduits en champs cachés ; `page` ne l'est pas, parce qu'une nouvelle
 * recherche repart de la première page.
 *
 * La recherche part à la validation (Entrée ou le bouton du clavier du
 * téléphone), pas à chaque frappe : chaque frappe serait un aller-retour
 * serveur, et le champ perdrait le focus à chaque rendu.
 *
 * `key={valeur}` : le champ est non contrôlé, et « Effacer » change l'URL sans
 * remonter ce composant. Sans la clé, le texte effacé resterait affiché.
 */
export function ChampRecherche({
  nom = "q",
  libelle,
  className,
}: {
  /** Nom du paramètre d'URL. */
  nom?: string;
  /** Ce qu'on cherche : sert d'indication et de nom accessible. */
  libelle: string;
  className?: string;
}) {
  const chemin = usePathname();
  const params = useSearchParams();
  const valeur = params.get(nom) ?? "";

  const autres = [...params.entries()].filter(
    ([k]) => k !== nom && k !== "page",
  );
  const sansRecherche = new URLSearchParams(autres).toString();

  return (
    <form method="get" role="search" className={className}>
      {autres.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          key={valeur}
          type="search"
          name={nom}
          defaultValue={valeur}
          placeholder={libelle}
          aria-label={libelle}
          enterKeyHint="search"
          // La croix native de `type=search` ne soumet pas le formulaire : elle
          // viderait le champ sans retirer le filtre. On la masque au profit
          // du lien ci-dessous, qui fait les deux.
          className="bg-card px-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {valeur && (
          <Link
            href={sansRecherche ? `${chemin}?${sansRecherche}` : chemin}
            scroll={false}
            aria-label="Effacer la recherche"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md"
          >
            <XIcon className="size-4" />
          </Link>
        )}
      </div>
    </form>
  );
}
