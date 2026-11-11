"use client";

import {
  ArrowLeftRightIcon,
  KeyRoundIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useTransition } from "react";

import { basculerVersGestion, basculerVersVendeur } from "@/app/actions";
import { seDeconnecter } from "@/app/login/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Tout ce qui concerne LE COMPTE, derrière une seule pastille aux initiales.
 *
 * Les deux en-têtes alignaient trois contrôles (bascule d'espace, thème,
 * « Déconnexion » en toutes lettres) à côté du titre et, côté vendeur, de la
 * navigation : sur un téléphone ils se serraient, et la déconnexion, qu'on
 * n'utilise presque jamais, occupait la meilleure place. Un menu les range, et
 * donne au passage un chemin vers le changement de mot de passe, qui n'en
 * avait aucun.
 *
 * Les Server Actions sont appelées dans une transition : elles redirigent, et
 * la transition garde le menu utilisable pendant l'aller-retour.
 *
 * `useTheme()` n'est lu que dans le contenu du menu, rendu à l'ouverture, donc
 * après hydratation — même précaution que dans `bouton-theme.tsx`. Les
 * initiales, elles, viennent du serveur : aucune divergence possible.
 */
export function MenuCompte({
  nom,
  role,
  espace,
  encadrement,
}: {
  nom: string;
  /** Libellé déjà lisible : « gérant », « vendeur »… */
  role: string;
  /** L'espace où le menu est affiché. */
  espace: "gestion" | "vendeur";
  /** Seul l'encadrement a un autre espace et un écran Sécurité. */
  encadrement: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const [, transition] = useTransition();

  const initiales =
    nom
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((mot) => mot[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Menu du compte de ${nom}`}
        // 40 px : c'est une cible tactile de l'en-tête, comme le bouton du
        // tiroir de navigation.
        className="bg-primary/12 text-primary hover:bg-primary/20 focus-visible:ring-ring/50 aria-expanded:bg-primary/20 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold outline-none transition-colors focus-visible:ring-3"
      >
        {initiales}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{nom}</p>
          <p className="text-muted-foreground text-xs">{role}</p>
        </div>
        <DropdownMenuSeparator />

        {encadrement && (
          <>
            <DropdownMenuItem
              className="min-h-9"
              onClick={() =>
                transition(async () => {
                  await (espace === "gestion"
                    ? basculerVersVendeur()
                    : basculerVersGestion());
                })
              }
            >
              <ArrowLeftRightIcon />
              {espace === "gestion" ? "Espace vendeur" : "Espace gestion"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-9"
              render={<Link href="/gestion/securite" />}
            >
              <ShieldCheckIcon />
              Sécurité du compte
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem
          className="min-h-9"
          render={<Link href="/changer-mot-de-passe" />}
        >
          <KeyRoundIcon />
          Changer de mot de passe
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Thème</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme ?? "system"}
            onValueChange={setTheme}
          >
            <DropdownMenuRadioItem value="light" className="min-h-9">
              <SunIcon className="size-4" />
              Clair
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className="min-h-9">
              <MoonIcon className="size-4" />
              Sombre
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" className="min-h-9">
              <MonitorIcon className="size-4" />
              Système
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="min-h-9"
          variant="destructive"
          onClick={() =>
            transition(async () => {
              await seDeconnecter();
            })
          }
        >
          <LogOutIcon />
          Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
