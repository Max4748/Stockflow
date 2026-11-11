import Link from "next/link";

import { BasculeEspace } from "@/components/bascule-espace";
import { Logo } from "@/components/logo";
import { MenuCompte } from "@/components/menu-compte";
import {
  NavigationBureau,
  NavigationMobile,
} from "@/components/navigation-vendeur";
import { exigerProfil } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { estEncadrement } from "@/lib/types";

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
  const encadrement = estEncadrement(profil.role);

  return (
    // AUCUN plafond de largeur : l'interface occupe l'écran quelle qu'en soit
    // la taille. Ce qui évite les cartes étirées à l'absurde n'est pas une
    // largeur maximale mais le nombre de colonnes, qui augmente avec l'espace
    // disponible (voir les grilles de chaque page).
    <div className="flex min-h-dvh w-full flex-col">
      {/* `sticky` : sur une page longue (le stock, les ventes récentes),
          un en-tête qui défile oblige à remonter pour naviguer. La barre
          d'onglets du bas, elle, est `fixed` et reste toujours là : sans
          ceci, la navigation n'était atteignable en permanence que sur
          téléphone, et pas au bureau. */}
      <header className="bg-background/95 sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur md:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/vendeur"
            className="flex min-w-0 items-center gap-2.5 font-semibold"
          >
            <Logo />
            <span className="truncate">StockFlow</span>
          </Link>
          {/* La navigation suit la marque, à GAUCHE : comme la barre latérale
              de la gestion, et à l'opposé du menu du compte. Elle était
              rangée à droite, mêlée au thème et à la déconnexion. */}
          <NavigationBureau compteurs={compteurs} stockLie={profil.stock_lie_entrepot} />
        </div>

        <div className="flex items-center gap-2">
          {/* Le chemin de retour n'existe que pour l'encadrement : un vendeur
              n'a pas d'autre espace, lui montrer le bouton serait une promesse
              qu'exigerAdmin() refuserait. */}
          {encadrement && (
            <div className="hidden sm:block">
              <BasculeEspace vers="gestion" />
            </div>
          )}
          <MenuCompte
            nom={profil.nom}
            role={
              profil.role === "dev"
                ? "Développeur"
                : encadrement
                  ? "Gérant"
                  : "Vendeur"
            }
            espace="vendeur"
            encadrement={encadrement}
          />
        </div>
      </header>

      {/* pb-24 laisse la place à la barre d'onglets fixe ; inutile dès `md`,
          où la navigation est passée dans l'en-tête. */}
      <main className="flex-1 px-4 py-5 pb-28 md:px-6 md:py-8 lg:px-8">
        {children}
      </main>

      <NavigationMobile compteurs={compteurs} stockLie={profil.stock_lie_entrepot} />
    </div>
  );
}
