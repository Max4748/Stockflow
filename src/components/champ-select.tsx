"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type OptionSelect = {
  valeur: string;
  libelle: string;
  desactive?: boolean;
};

/**
 * Liste déroulante habillée, avec sa liste dessinée par l'application.
 *
 * POURQUOI CE N'EST PLUS UN `<select>` NATIF. La liste ouverte d'un `<select>`
 * appartient au système : ni arrondi, ni ombre, ni survol, ni thème. On ne
 * pouvait agir que sur le fond du champ — et ce fond, s'il est translucide,
 * rend les options illisibles. Deux défauts qui n'avaient pas de correctif CSS.
 *
 * CE QUE ÇA COÛTE, et qui contredit une règle de docs/interface.md :
 *   • sur un téléphone, plus de sélecteur système (la roue) — une liste
 *     déroulante ordinaire, avec des cibles de 44 px ;
 *   • il faut du JavaScript. Le reste des formulaires n'en demande pas.
 *
 * CE QUI EST PRÉSERVÉ : la soumission native. `Select.Root` rend un champ
 * caché portant `name`, donc `FormData` le récupère comme avant — aucune
 * Server Action n'a bougé.
 *
 * Les options sont passées en DONNÉES et non en enfants JSX : le composant peut
 * ainsi être appelé depuis un Server Component (écran Comptabilité) sans
 * transporter de JSX à travers la frontière.
 */
export function ChampSelect({
  options,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  required,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  options: OptionSelect[];
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (valeur: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v) => onValueChange?.(String(v ?? ""))}
      required={required}
      disabled={disabled}
      items={options.map((o) => ({ value: o.valeur, label: o.libelle }))}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn("h-11 w-full text-base", className)}
      >
        <SelectValue />
      </SelectTrigger>

      {/* `alignItemWithTrigger={false}` : la liste se déploie SOUS le champ au
          lieu de se superposer à lui. Dans un dialogue qui défile, la
          superposition sautait d'un bord à l'autre selon la place restante. */}
      <SelectContent alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem
            key={o.valeur}
            value={o.valeur}
            disabled={o.desactive}
            className="py-2 text-base"
          >
            {o.libelle}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
