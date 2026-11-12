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
import { useState, useTransition } from "react";

import { basculerVersGestion, basculerVersVendeur } from "@/app/actions";
import { seDeconnecter } from "@/app/login/actions";
import { PiedFormulaire } from "@/components/pied-formulaire";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [enCours, transition] = useTransition();
  // LA DÉCONNEXION SE CONFIRME. Depuis qu'elle est dans ce menu, elle est à un
  // doigt du choix du thème : la toucher par erreur renvoyait à l'écran de
  // connexion, mot de passe à ressaisir, au milieu d'une vente.
  //
  // Le dialogue est rendu À CÔTÉ du menu et non dedans : le menu se referme en
  // ouvrant le dialogue, il n'y a jamais deux calques empilés (règle « pas de
  // dialogue imbriqué » de docs/interface.md).
  const [confirmation, setConfirmation] = useState(false);

  const initiales =
    nom
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((mot) => mot[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <>
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
            onClick={() => setConfirmation(true)}
          >
            <LogOutIcon />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmation} onOpenChange={setConfirmation}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Se déconnecter ?</DialogTitle>
            <DialogDescription>
              Il faudra ressaisir l&apos;adresse e-mail et le mot de passe pour
              revenir.
            </DialogDescription>
          </DialogHeader>
          <PiedFormulaire>
            <DialogClose
              render={<Button variant="outline">Rester connecté</Button>}
            />
            <Button
              variant="destructive"
              disabled={enCours}
              onClick={() =>
                transition(async () => {
                  await seDeconnecter();
                })
              }
            >
              {enCours ? "Déconnexion…" : "Se déconnecter"}
            </Button>
          </PiedFormulaire>
        </DialogContent>
      </Dialog>
    </>
  );
}
