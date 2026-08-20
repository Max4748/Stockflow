import { BoutonThemeFlottant } from "@/components/bouton-theme";
import { redirect } from "next/navigation";

import { profilCourant } from "@/lib/auth";

import { FormulaireMotDePasse } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau mot de passe — StockFlow" };

export default async function PageChangerMotDePasse() {
  // On n'utilise pas exigerProfil() ici : elle redirigerait vers cette page
  // même, ce qui créerait une boucle.
  const profil = await profilCourant();
  if (!profil) redirect("/login");
  if (!profil.actif) redirect("/en-attente");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <BoutonThemeFlottant />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Choisir un mot de passe
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {profil.doit_changer_mdp
              ? "Ce compte utilise un mot de passe provisoire. Il faut le remplacer pour continuer."
              : "Modification du mot de passe du compte."}
          </p>
        </div>
        <FormulaireMotDePasse />
      </div>
    </main>
  );
}
