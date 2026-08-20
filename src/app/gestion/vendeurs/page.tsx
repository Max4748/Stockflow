import Link from "next/link";

import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Creance, Invitation } from "@/lib/types";

import { FormulaireCreationVendeur } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendeurs — StockFlow" };

const COLONNES: Colonne<Creance>[] = [
  {
    cle: "nom",
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
          <Badge variant="secondary">
            {l.role === "dev" ? "dev" : "gérant"}
          </Badge>
        )}
        {!l.actif && <Badge variant="outline">inactif</Badge>}
      </span>
    ),
  },
  {
    cle: "nb",
    entete: "Ventes",
    alignement: "droite",
    valeur: (l) => l.nb_ventes,
  },
  {
    cle: "ca",
    entete: "Encaissé",
    alignement: "droite",
    valeur: (l) => euros(l.ca),
  },
  {
    cle: "com",
    entete: "Sa commission",
    alignement: "droite",
    valeur: (l) => euros(l.commissions),
  },
  {
    cle: "verse",
    entete: "Reversé",
    alignement: "droite",
    valeur: (l) => euros(l.verse),
  },
  {
    cle: "rembourse",
    entete: "Remboursé (SAV)",
    alignement: "droite",
    // Sans cette colonne, un « reste à verser » qui baisse sans versement
    // n'aurait aucune explication à l'écran.
    valeur: (l) => (Number(l.rembourse) > 0 ? euros(l.rembourse) : "—"),
  },
  {
    cle: "du",
    entete: "Reste à verser",
    alignement: "droite",
    valeur: (l) => (
      <span className={cn(l.reste_a_verser > 0 && "font-semibold")}>
        {euros(l.reste_a_verser)}
      </span>
    ),
  },
];

export default async function PageVendeurs() {
  await exigerAdmin();
  const supabase = await creerClient();

  const [rCreances, rInvitations] = await Promise.all([
    supabase.rpc("creances"),
    supabase
      .from("invitations")
      .select("*")
      .eq("utilisee", false)
      .order("cree_le", { ascending: false }),
  ]);

  const creances = (rCreances.data as Creance[] | null) ?? [];
  const invitations = (rInvitations.data as Invitation[] | null) ?? [];
  const erreur = rCreances.error ?? rInvitations.error;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Vendeurs</h1>
        <FormulaireCreationVendeur />
      </div>

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
                <li key={i.email}>
                  {i.email} ({i.nom}, {euros(i.commission_unitaire)}/unité)
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
          <Tableau
            colonnes={COLONNES}
            lignes={creances}
            cle={(l) => l.vendeur_id}
            vide="Aucun vendeur enregistré."
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
