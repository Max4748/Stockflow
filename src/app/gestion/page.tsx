import {
  BoxesIcon,
  CoinsIcon,
  HandCoinsIcon,
  PackageIcon,
  ReceiptIcon,
  TrendingUpIcon,
  TruckIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";

import { EntetePage } from "@/components/entete-page";
import { EtatVide } from "@/components/etat-vide";
import { FiltrePeriode } from "@/components/filtre-periode";
import { BarresVendeurs } from "@/components/graphiques/barres-vendeurs";
import { CourbeCa } from "@/components/graphiques/courbe-ca";
import { Kpi } from "@/components/kpi";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { euros } from "@/lib/format";
import { argsPeriode, lirePeriode } from "@/lib/periode";
import { construireSerie, type PointJour } from "@/lib/serie";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { BilanGlobal, Creance, RevenuVendeur } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bilan — StockFlow" };

const COLONNES_REVENUS: Colonne<RevenuVendeur>[] = [
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
        {/* Un gérant qui vend figure dans ce tableau : son CA compte déjà dans
            le bilan ci-dessus, l'en exclure ferait diverger les deux. */}
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
    cle: "qte",
    tri: (l) => l.qte_vendue,
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.qte_vendue,
  },
  {
    cle: "ca",
    tri: (l) => Number(l.ca),
    entete: "Chiffre d'affaires",
    alignement: "droite",
    valeur: (l) => euros(l.ca),
  },
  {
    cle: "com",
    tri: (l) => Number(l.commissions),
    entete: "Commissions",
    alignement: "droite",
    valeur: (l) => euros(l.commissions),
  },
  {
    cle: "marge",
    tri: (l) => Number(l.marge_nette),
    entete: "Marge nette",
    alignement: "droite",
    valeur: (l) => euros(l.marge_nette),
  },
];

const COLONNES_CREANCES: Colonne<Creance>[] = [
  {
    cle: "nom",
    tri: (l) => l.nom,
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
    entete: "Déjà reversé",
    alignement: "droite",
    valeur: (l) => euros(l.verse),
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

export default async function PageBilan({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  const params = await searchParams;
  const periode = lirePeriode(params);
  const args = argsPeriode(periode);

  const supabase = await creerClient();
  const [rBilan, rRevenus, rCreances, rCourbe] = await Promise.all([
    supabase.rpc("bilan_global", args),
    supabase.rpc("revenus_vendeurs", args),
    // Une créance est un SOLDE : elle n'a pas de bornes de période.
    supabase.rpc("creances"),
    // Même période et même définition du chiffre d'affaires que `bilan_global` :
    // la somme de la courbe retombe sur l'indicateur affiché au-dessus d'elle.
    supabase.rpc("ca_par_jour", args),
  ]);

  const bilan = (rBilan.data as BilanGlobal[] | null)?.[0] ?? null;
  const revenus = (rRevenus.data as RevenuVendeur[] | null) ?? [];
  const creances = (rCreances.data as Creance[] | null) ?? [];
  const erreur =
    rBilan.error ?? rRevenus.error ?? rCreances.error ?? rCourbe.error;

  const { pas, serie } = construireSerie(
    (rCourbe.data as PointJour[] | null) ?? [],
    periode.du,
    periode.au,
  );

  // Les raccourcis des indicateurs gardent la période choisie : arriver sur le
  // journal « Tout » depuis un bilan du mois ferait comparer deux chiffres qui
  // ne portent pas sur la même chose.
  const qPeriode = new URLSearchParams(
    Object.entries({
      periode: params.periode,
      du: params.du,
      au: params.au,
    }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const suffixe = qPeriode ? `?${qPeriode}` : "";

  const aRecuperer = creances.reduce((s, c) => s + Number(c.reste_a_verser), 0);

  return (
    <div className="w-full space-y-6">
      <EntetePage
        titre="Bilan"
        filtres={<FiltrePeriode actif={periode.cle} />}
      />

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        <Kpi
          className="sm:col-span-2 2xl:col-span-2"
          libelle="Marge nette de la période" icone={TrendingUpIcon}
          valeur={euros(bilan?.marge_nette ?? 0)}
          precision="chiffre d'affaires − coût de revient − commissions"
          accent
        />
        <Kpi
          libelle="Chiffre d'affaires" icone={ReceiptIcon}
          href={`/gestion/comptabilite${suffixe}`}
          valeur={euros(bilan?.ca ?? 0)}
          // « net des remboursements » : sans cette mention, ce chiffre semble
          // contredire la colonne « Encaissé » de l'écran Vendeurs, qui est le
          // brut. Les deux sont justes, l'écart est le SAV remboursé.
          precision={`${bilan?.nb_ventes ?? 0} vente(s), ${bilan?.qte_vendue ?? 0} u · net des remboursements SAV`}
        />
        <Kpi
          libelle="Coût des marchandises" icone={PackageIcon}
          valeur={euros(bilan?.cout_marchandises ?? 0)}
          precision="au coût moyen pondéré figé"
        />
        <Kpi
          libelle="Commissions versées" icone={CoinsIcon}
          valeur={euros(bilan?.commissions ?? 0)}
        />
        <Kpi
          libelle="À récupérer" icone={HandCoinsIcon} ton="alerte"
          href="/gestion/vendeurs"
          valeur={euros(bilan?.montant_a_recuperer ?? 0)}
          precision="tous vendeurs, hors période"
        />
        <Kpi
          libelle="Valeur du stock" icone={BoxesIcon}
          href="/gestion/stock"
          valeur={euros(bilan?.valeur_stock ?? 0)}
          precision="entrepôt + distribué"
        />
        <Kpi
          libelle="Achats de la période" icone={TruckIcon}
          href="/gestion/achats"
          valeur={euros(bilan?.achats_total ?? 0)}
          precision="frais de port inclus"
        />
      </div>

      {aRecuperer > 0 && (
        <Alert variant="alerte">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong className="tabular-nums">{euros(aRecuperer)}</strong> à
              récupérer auprès des vendeurs.
            </span>
            <Link
              href="/gestion/vendeurs"
              data-slot="button"
              className={buttonVariants({ variant: "outline" })}
            >
              Encaisser un versement
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* 2/3 – 1/3 : la courbe a besoin de largeur pour qu'un mois se lise, le
          classement tient dans une colonne étroite. */}
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Chiffre d&apos;affaires{" "}
              {pas === "jour"
                ? "par jour"
                : pas === "semaine"
                  ? "par semaine"
                  : "par mois"}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Net des remboursements SAV, comptés le jour où ils sont accordés.
            </p>
          </CardHeader>
          <CardContent>
            {serie.length === 0 ? (
              <EtatVide
                icone={TrendingUpIcon}
                titre="Aucune vente sur cette période."
              />
            ) : (
              <CourbeCa serie={serie} pas={pas} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Classement des vendeurs</CardTitle>
            <p className="text-muted-foreground text-xs">
              Par chiffre d&apos;affaires sur la période.
            </p>
          </CardHeader>
          <CardContent>
            {revenus.length === 0 ? (
              <EtatVide
                icone={UsersIcon}
                titre="Aucun vendeur n'a encore vendu sur cette période."
              />
            ) : (
              <BarresVendeurs
                vendeurs={revenus.map((v) => ({
                  id: v.vendeur_id,
                  nom: v.nom,
                  ca: Number(v.ca),
                  nbVentes: v.nb_ventes,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

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
            tri={{ params, chemin: "/gestion", prefixe: "r" }}
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
            tri={{ params, chemin: "/gestion", prefixe: "c" }}
            vide="Aucun vendeur enregistré."
          />
        </CardContent>
      </Card>
    </div>
  );
}
