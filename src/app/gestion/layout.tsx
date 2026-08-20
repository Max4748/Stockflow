import Link from "next/link";

import { BasculeEspace } from "@/components/bascule-espace";
import { BarreLaterale, TiroirNavigation } from "@/components/navigation-admin";
import { BoutonTheme } from "@/components/bouton-theme";
import { Button } from "@/components/ui/button";
import { exigerAdmin } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { NIVEAUX } from "@/lib/types";

import { seDeconnecter } from "../login/actions";

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
    // produisait aucun signal. Voir la migration 0019.
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
        <header className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <TiroirNavigation compteurs={compteurs} niveau={niveau} />
            <div className="min-w-0">
              <Link href="/gestion" className="block truncate font-semibold">
                StockFlow
              </Link>
              <p className="text-muted-foreground truncate text-xs">
                {profil.nom} ·{" "}
                {profil.role === "dev" ? "développeur" : "gérant"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Un gérant vend aussi : l'espace vendeur est à un clic, et le
                choix est mémorisé pour la prochaine connexion. */}
            <BasculeEspace vers="vendeur" />
            <BoutonTheme />
            <form action={seDeconnecter}>
              <Button type="submit" variant="ghost" size="sm">
                Déconnexion
              </Button>
            </form>
          </div>
        </header>

        {/* min-w-0 sur le parent : indispensable pour qu'un tableau large
            défile dans son propre conteneur au lieu d'élargir la page. */}
        <main className="min-w-0 flex-1 px-4 py-4 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
