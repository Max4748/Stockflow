import Link from "next/link";

import { FiltrePeriode } from "@/components/filtre-periode";
import { Kpi } from "@/components/kpi";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { euros } from "@/lib/format";
import { argsPeriode, lirePeriode } from "@/lib/periode";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { BilanGlobal, Creance, RevenuVendeur } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bilan — StockFlow" };

const COLONNES_REVENUS: Colonne<RevenuVendeur>[] = [
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
        {/* Un gérant qui vend figure dans ce tableau : son CA compte déjà dans
            le bilan ci-dessus, l'en exclure ferait diverger les deux. */}
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
    cle: "qte",
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.qte_vendue,
  },
  {
    cle: "ca",
    entete: "Chiffre d'affaires",
    alignement: "droite",
    valeur: (l) => euros(l.ca),
  },
  {
    cle: "com",
    entete: "Commissions",
    alignement: "droite",
    valeur: (l) => euros(l.commissions),
  },
  {
    cle: "marge",
    entete: "Marge nette",
    alignement: "droite",
    valeur: (l) => euros(l.marge_nette),
  },
];

const COLONNES_CREANCES: Colonne<Creance>[] = [
  {
    cle: "nom",
    entete: "Vendeur",
    principale: true,
    valeur: (l) => (
      <Link
        href={`/gestion/vendeurs/${l.vendeur_id}`}
        className="underline-offset-4 hover:underline"
      >
        {l.nom}
      </Link>
    ),
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
    entete: "Déjà reversé",
    alignement: "droite",
    valeur: (l) => euros(l.verse),
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

export default async function PageBilan({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  const periode = lirePeriode(await searchParams);
  const args = argsPeriode(periode);

  const supabase = await creerClient();
  const [rBilan, rRevenus, rCreances] = await Promise.all([
    supabase.rpc("bilan_global", args),
    supabase.rpc("revenus_vendeurs", args),
    // Une créance est un SOLDE : elle n'a pas de bornes de période.
    supabase.rpc("creances"),
  ]);

  const bilan = (rBilan.data as BilanGlobal[] | null)?.[0] ?? null;
  const revenus = (rRevenus.data as RevenuVendeur[] | null) ?? [];
  const creances = (rCreances.data as Creance[] | null) ?? [];
  const erreur = rBilan.error ?? rRevenus.error ?? rCreances.error;

  const aRecuperer = creances.reduce((s, c) => s + Number(c.reste_a_verser), 0);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Bilan</h1>
        <FiltrePeriode actif={periode.cle} />
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        <Kpi
          className="sm:col-span-2 2xl:col-span-2"
          libelle="Marge nette de la période"
          valeur={euros(bilan?.marge_nette ?? 0)}
          precision="chiffre d'affaires − coût de revient − commissions"
          accent
        />
        <Kpi
          libelle="Chiffre d'affaires"
          valeur={euros(bilan?.ca ?? 0)}
          // « net des remboursements » : sans cette mention, ce chiffre semble
          // contredire la colonne « Encaissé » de l'écran Vendeurs, qui est le
          // brut. Les deux sont justes, l'écart est le SAV remboursé.
          precision={`${bilan?.nb_ventes ?? 0} vente(s), ${bilan?.qte_vendue ?? 0} u · net des remboursements SAV`}
        />
        <Kpi
          libelle="Coût des marchandises"
          valeur={euros(bilan?.cout_marchandises ?? 0)}
          precision="au coût moyen pondéré figé"
        />
        <Kpi
          libelle="Commissions versées"
          valeur={euros(bilan?.commissions ?? 0)}
        />
        <Kpi
          libelle="À récupérer"
          valeur={euros(bilan?.montant_a_recuperer ?? 0)}
          precision="tous vendeurs, hors période"
        />
        <Kpi
          libelle="Valeur du stock"
          valeur={euros(bilan?.valeur_stock ?? 0)}
          precision="entrepôt + distribué"
        />
        <Kpi
          libelle="Achats de la période"
          valeur={euros(bilan?.achats_total ?? 0)}
          precision="frais de port inclus"
        />
      </div>

      {aRecuperer > 0 && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong className="tabular-nums">{euros(aRecuperer)}</strong> à
              récupérer auprès des vendeurs.
            </span>
            <Link
              href="/gestion/vendeurs"
              className={cn(buttonVariants({ variant: "outline" }), "h-9")}
            >
              Encaisser un versement
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Revenus par vendeur</CardTitle>
          <p className="text-muted-foreground text-xs">
            Chiffre d&apos;affaires et marge <strong>nets</strong> des
            remboursements SAV de la période. L&apos;écran Vendeurs, lui, montre
            l&apos;encaissé brut et le remboursé dans deux colonnes distinctes.
          </p>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES_REVENUS}
            lignes={revenus}
            cle={(l) => l.vendeur_id}
            vide="Aucun vendeur n'a encore vendu sur cette période."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Créances</CardTitle>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES_CREANCES}
            lignes={creances}
            cle={(l) => l.vendeur_id}
            vide="Aucun vendeur enregistré."
          />
        </CardContent>
      </Card>
    </div>
  );
}
