import Link from "next/link";
import { redirect } from "next/navigation";

import { CadreAuth } from "@/components/cadre-auth";

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
    <CadreAuth
      titre="Choisir un mot de passe"
      description={
        profil.doit_changer_mdp
          ? "Ce compte utilise un mot de passe provisoire. Il faut le remplacer pour continuer."
          : "Modification du mot de passe du compte."
      }
      // Un changement volontaire (depuis le menu du compte) doit pouvoir
      // s'abandonner. Un changement IMPOSÉ, non : `/` y renverrait aussitôt.
      pied={
        !profil.doit_changer_mdp && (
          <Link
            href="/"
            className="text-primary underline-offset-4 hover:underline"
          >
            Annuler et revenir à l&apos;application
          </Link>
        )
      }
    >
      <FormulaireMotDePasse />
    </CadreAuth>
  );
}
