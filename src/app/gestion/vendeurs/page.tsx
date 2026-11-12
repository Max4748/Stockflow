import Link from "next/link";

import { ChampRecherche } from "@/components/champ-recherche";
import { BoutonExport } from "@/components/bouton-export";
import { EntetePage } from "@/components/entete-page";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { filtrer } from "@/lib/tri";
import { exigerAdmin } from "@/lib/auth";
import { euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Creance, Invitation } from "@/lib/types";

import {
  BoutonAnnulerInvitation,
  FormulaireCreationVendeur,
} from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendeurs — StockFlow" };

const COLONNES: Colonne<Creance>[] = [
  {
    cle: "nom",
    tri: (l) => l.nom,
    entete: "Vendeur",
    principale: true,
    valeur: (l) => (
      <span className="flex items-center gap-2">
        <Link
          href={`/gestion/vendeurs/${l.vendeur_id}`}
          className="underline-offset-4 hover:underline"
        >
          {l.nom}
        </Link>
        {/* Un compte d'encadrement n'apparaît ici que s'il a vendu. Le dire
            évite de le prendre pour un vendeur qui ne reverse jamais rien. */}
        {l.role !== "vendeur" && (
          <Badge variant="info">
            {l.role === "dev" ? "dev" : "gérant"}
          </Badge>
        )}
        {!l.actif && <Badge variant="outline">inactif</Badge>}
      </span>
    ),
  },
  {
    cle: "nb",
    tri: (l) => l.nb_ventes,
    entete: "Ventes",
    alignement: "droite",
    valeur: (l) => l.nb_ventes,
  },
  {
    cle: "ca",
    tri: (l) => Number(l.ca),
    entete: "Encaissé",
    alignement: "droite",
    valeur: (l) => euros(l.ca),
  },
  {
    cle: "com",
    tri: (l) => Number(l.commissions),
    entete: "Sa commission",
    alignement: "droite",
    valeur: (l) => euros(l.commissions),
  },
  {
    cle: "verse",
    tri: (l) => Number(l.verse),
    entete: "Reversé",
    alignement: "droite",
    valeur: (l) => euros(l.verse),
  },
  {
    cle: "rembourse",
    tri: (l) => Number(l.rembourse),
    entete: "Remboursé (SAV)",
    alignement: "droite",
    // Sans cette colonne, un « reste à verser » qui baisse sans versement
    // n'aurait aucune explication à l'écran.
    valeur: (l) => (Number(l.rembourse) > 0 ? euros(l.rembourse) : "—"),
  },
  {
    cle: "du",
    tri: (l) => Number(l.reste_a_verser),
    entete: "Reste à verser",
    alignement: "droite",
    valeur: (l) => (
      <span className={cn(l.reste_a_verser > 0 && "font-semibold")}>
        {euros(l.reste_a_verser)}
      </span>
    ),
  },
];

export default async function PageVendeurs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  // `?retire=` : posé par `retirerCompte` quand le compte a été SUPPRIMÉ, donc
  // quand la redirection depuis sa fiche a empêché le toast d'arriver.
  const params = await searchParams;
  const { retire } = params;
  const supabase = await creerClient();

  const [rCreances, rInvitations] = await Promise.all([
    supabase.rpc("creances"),
    supabase
      .from("invitations")
      .select("*")
      .eq("utilisee", false)
      .order("cree_le", { ascending: false }),
  ]);

  const toutes = (rCreances.data as Creance[] | null) ?? [];
  const creances = filtrer(toutes, params.q, (c) => [c.nom]);
  const invitations = (rInvitations.data as Invitation[] | null) ?? [];
  const erreur = rCreances.error ?? rInvitations.error;

  return (
    <div className="w-full space-y-6">
      <EntetePage titre="Vendeurs">
        <BoutonExport href="/gestion/vendeurs/export" />
        <FormulaireCreationVendeur />
      </EntetePage>

      {retire && (
        <Alert>
          <AlertDescription>{retire}</AlertDescription>
        </Alert>
      )}

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      {invitations.length > 0 && (
        <Alert>
          <AlertDescription>
            <p className="mb-1">
              Invitation(s) enregistrée(s) sans compte associé — la création
              s&apos;est interrompue après la première étape. Recréer le compte
              avec la même adresse réutilisera l&apos;invitation :
            </p>
            <ul className="list-inside list-disc text-sm">
              {invitations.map((i) => (
                <li key={i.email} className="flex items-center gap-2">
                  <span>
                    {i.email} ({i.nom}, {euros(i.commission_unitaire)}/unité)
                  </span>
                  <BoutonAnnulerInvitation email={i.email} />
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Comptes et créances ({creances.length})
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            « Encaissé » est le <strong>brut</strong>, sur tout
            l&apos;historique. Le Bilan affiche le même chiffre d&apos;affaires
            net des remboursements SAV, et borné à la période choisie.
          </p>
        </CardHeader>
        <CardContent>
          <ChampRecherche
            libelle="Rechercher un vendeur"
            className="mb-4 sm:max-w-xs"
          />
          <Tableau
            colonnes={COLONNES}
            lignes={creances}
            cle={(l) => l.vendeur_id}
            tri={{ params, chemin: "/gestion/vendeurs" }}
            vide={
              params.q
                ? "Aucun vendeur ne correspond à cette recherche."
                : "Aucun vendeur enregistré."
            }
            action={(l) => (
              <Link
                href={`/gestion/vendeurs/${l.vendeur_id}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "w-full md:w-auto",
                )}
              >
                Ouvrir la fiche
              </Link>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
