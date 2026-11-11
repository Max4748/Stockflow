import Link from "next/link";

import { BasculeEspace } from "@/components/bascule-espace";
import { BarreLaterale, TiroirNavigation } from "@/components/navigation-admin";
import { Logo } from "@/components/logo";
import { MenuCompte } from "@/components/menu-compte";
import { exigerAdmin } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { NIVEAUX } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LayoutAdmin({
  children,
}: {
  children: React.ReactNode;
}) {
  // Garde en haut de l'arbre. Rappelée dans CHAQUE Server Action : ce contrôle
  // ne protège que le rendu des pages, pas les actions invoquées directement.
  const profil = await exigerAdmin();

  const supabase = await creerClient();
  // `head: true` : on ne veut que le compte, pas les lignes.
  const [rDemandes, rSav, rSavNonVus] = await Promise.all([
    supabase
      .from("demandes_restock")
      .select("id", { count: "exact", head: true })
      .eq("statut", "en_attente"),
    supabase
      .from("sav")
      .select("id", { count: "exact", head: true })
      .eq("statut", "en_attente"),
    // Les dossiers VALIDÉS qu'un autre a ouverts et que ce gérant n'a pas
    // encore regardés — l'échange déclaré par un vendeur prend effet d'emblée
    // et n'attend donc aucune décision : sans ce second compteur, il ne
    // produisait aucun signal. Voir `sav_gestion_non_vus`.
    supabase.rpc("sav_gestion_non_vus"),
  ]);

  const compteurs = {
    "/gestion/demandes": rDemandes.count ?? 0,
    // Somme licite : les deux ensembles sont disjoints par construction, l'un
    // ne compte que l'`en_attente`, l'autre que le `valide`.
    "/gestion/sav": (rSav.count ?? 0) + ((rSavNonVus.data as number) ?? 0),
  };
  const niveau = NIVEAUX[profil.role] ?? 0;

  return (
    // Aucun plafond de largeur (règle documentée dans le README) : c'est le
    // nombre de colonnes de chaque écran qui s'adapte, pas la page qui se bride.
    <div className="flex min-h-dvh w-full">
      <BarreLaterale compteurs={compteurs} niveau={niveau} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* `sticky`, comme la barre latérale qui l'est déjà : en dessous
            de `lg` c'est le bouton Menu de cet en-tête qui EST la
            navigation, et il défilait hors de vue sur une page longue. */}
        <header className="bg-background/95 sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <TiroirNavigation compteurs={compteurs} niveau={niveau} />
            {/* Sous `lg` la barre latérale est masquée : la marque passe ici.
                Au-delà, elle est en tête de barre latérale et l'en-tête ne la
                répète pas. */}
            <Link
              href="/gestion"
              className="flex min-w-0 items-center gap-2.5 font-semibold lg:hidden"
            >
              <Logo />
              <span className="truncate">StockFlow</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {/* Un gérant vend aussi : l'espace vendeur est à un clic, et le
                choix est mémorisé pour la prochaine connexion. Le bouton reste
                visible dès `sm` ; en dessous, la même bascule est dans le menu
                du compte. */}
            <div className="hidden sm:block">
              <BasculeEspace vers="vendeur" />
            </div>
            <MenuCompte
              nom={profil.nom}
              role={profil.role === "dev" ? "Développeur" : "Gérant"}
              espace="gestion"
              encadrement
            />
          </div>
        </header>

        {/* min-w-0 sur le parent : indispensable pour qu'un tableau large
            défile dans son propre conteneur au lieu d'élargir la page. */}
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
