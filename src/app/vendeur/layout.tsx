import Link from "next/link";

import { BasculeEspace } from "@/components/bascule-espace";
import { BoutonTheme } from "@/components/bouton-theme";
import { Button } from "@/components/ui/button";
import {
  NavigationBureau,
  NavigationMobile,
} from "@/components/navigation-vendeur";
import { exigerProfil } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { estEncadrement } from "@/lib/types";

import { seDeconnecter } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function LayoutVendeur({
  children,
}: {
  children: React.ReactNode;
}) {
  // Garde en haut de l'arbre. Rappelée dans chaque Server Action : ce contrôle
  // ne protège que le rendu des pages.
  const profil = await exigerProfil();

  // Ce qui a bougé sur ses SAV sans qu'il en soit l'auteur, depuis sa dernière
  // consultation. Un refus n'a aucun autre moyen de lui parvenir.
  const supabase = await creerClient();
  const { data } = await supabase.rpc("sav_non_vus");
  const compteurs = { "/vendeur/sav": (data as number | null) ?? 0 };

  return (
    // AUCUN plafond de largeur : l'interface occupe l'écran quelle qu'en soit
    // la taille. Ce qui évite les cartes étirées à l'absurde n'est pas une
    // largeur maximale mais le nombre de colonnes, qui augmente avec l'espace
    // disponible (voir les grilles de chaque page).
    <div className="flex min-h-dvh w-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6 lg:px-8">
        <div className="min-w-0">
          <Link href="/vendeur" className="block truncate font-semibold">
            StockFlow
          </Link>
          <p className="text-muted-foreground truncate text-xs">{profil.nom}</p>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <NavigationBureau compteurs={compteurs} />
          {/* Le chemin de retour n'existe que pour l'encadrement : un vendeur
              n'a pas d'autre espace, lui montrer le bouton serait une promesse
              qu'exigerAdmin() refuserait. */}
          {estEncadrement(profil.role) && <BasculeEspace vers="gestion" />}
          <BoutonTheme />
          <form action={seDeconnecter}>
            <Button type="submit" variant="ghost" size="sm">
              Déconnexion
            </Button>
          </form>
        </div>
      </header>

      {/* pb-24 laisse la place à la barre d'onglets fixe ; inutile dès `md`,
          où la navigation est passée dans l'en-tête. */}
      <main className="flex-1 px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8 lg:px-8">
        {children}
      </main>

      <NavigationMobile compteurs={compteurs} />
    </div>
  );
}
