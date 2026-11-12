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
import { BoutonExport } from "@/components/bouton-export";
import { BarresClassement } from "@/components/graphiques/barres-classement";
import { CourbeCa } from "@/components/graphiques/courbe-ca";
import { Kpi } from "@/components/kpi";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { euros } from "@/lib/format";
import {
  argsPeriode,
  evolution,
  lirePeriode,
  periodePrecedente,
} from "@/lib/periode";
import { construireSerie, type PointJour } from "@/lib/serie";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type {
  BilanGlobal,
  Creance,
  RevenuVendeur,
  VenteProduit,
} from "@/lib/types";

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

const COLONNES_PRODUITS: Colonne<VenteProduit>[] = [
  {
    cle: "produit",
    tri: (l) => `${l.modele} ${l.produit}`,
    entete: "Produit",
    principale: true,
    valeur: (l) => nomProduit(l),
  },
  {
    cle: "unites",
    tri: (l) => l.unites,
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.unites,
  },
  {
    cle: "ca",
    tri: (l) => Number(l.ca),
    entete: "Chiffre d'affaires",
    alignement: "droite",
    valeur: (l) => euros(l.ca),
  },
  {
    cle: "marge",
    tri: (l) => Number(l.marge),
    entete: "Marge nette",
    alignement: "droite",
    valeur: (l) => euros(l.marge),
  },
  {
    cle: "unitaire",
    // Sans unité vendue (un remboursement seul sur la période), il n'y a pas
    // de marge « par unité » : la colonne reste vide et se range en dernier.
    tri: (l) => (l.unites > 0 ? Number(l.marge) / l.unites : null),
    entete: "Marge par unité",
    alignement: "droite",
    valeur: (l) => (l.unites > 0 ? euros(Number(l.marge) / l.unites) : "—"),
  },
];

/** « Brume 100 ml · Vanille », ou le seul nom quand modèle et parfum coïncident. */
function nomProduit(l: { modele: string; produit: string }): string {
  return l.modele === l.produit ? l.produit : `${l.modele} · ${l.produit}`;
}

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

  // La période de même durée juste avant, pour dire si « ça monte ». Absente
  // sur « Tout » : il n'y a pas d'avant.
  const avant = periodePrecedente(periode);
  const argsAvant = avant ? { p_du: avant.du, p_au: avant.au } : null;

  const supabase = await creerClient();
  const [rBilan, rRevenus, rCreances, rCourbe, rProduits, rBilanAvant, rCourbeAvant] =
    await Promise.all([
    supabase.rpc("bilan_global", args),
    supabase.rpc("revenus_vendeurs", args),
    // Une créance est un SOLDE : elle n'a pas de bornes de période.
    supabase.rpc("creances"),
    // Même période et même définition du chiffre d'affaires que `bilan_global` :
    // la somme de la courbe retombe sur l'indicateur affiché au-dessus d'elle.
    supabase.rpc("ca_par_jour", args),
    supabase.rpc("ventes_par_produit", args),
    argsAvant ? supabase.rpc("bilan_global", argsAvant) : null,
    argsAvant ? supabase.rpc("ca_par_jour", argsAvant) : null,
  ]);

  const bilan = (rBilan.data as BilanGlobal[] | null)?.[0] ?? null;
  const revenus = (rRevenus.data as RevenuVendeur[] | null) ?? [];
  const creances = (rCreances.data as Creance[] | null) ?? [];
  const produits = (rProduits.data as VenteProduit[] | null) ?? [];
  const bilanAvant = (rBilanAvant?.data as BilanGlobal[] | null)?.[0] ?? null;
  const erreur =
    rBilan.error ??
    rRevenus.error ??
    rCreances.error ??
    rCourbe.error ??
    rProduits.error;

  // Écart de chaque indicateur de PÉRIODE avec la période précédente. Les
  // soldes (à récupérer, valeur du stock) n'en ont pas : ils ne dépendent pas
  // de la période, les comparer à eux-mêmes afficherait toujours 0 %.
  const ecart = (cle: keyof BilanGlobal, favorable = false) => {
    const pourcent = bilanAvant
      ? evolution(Number(bilan?.[cle] ?? 0), Number(bilanAvant[cle]))
      : null;
    return pourcent === null ? null : { pourcent, favorable };
  };

  const { pas, serie } = construireSerie(
    (rCourbe.data as PointJour[] | null) ?? [],
    periode.du,
    periode.au,
  );
  const serieAvant = avant
    ? construireSerie(
        (rCourbeAvant?.data as PointJour[] | null) ?? [],
        avant.du,
        avant.au,
      ).serie
    : [];

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
          evolution={ecart("marge_nette", true)}
          accent
        />
        <Kpi
          libelle="Chiffre d'affaires" icone={ReceiptIcon}
          href={`/gestion/comptabilite${suffixe}`}
          valeur={euros(bilan?.ca ?? 0)}
          evolution={ecart("ca", true)}
          // « net des remboursements » : sans cette mention, ce chiffre semble
          // contredire la colonne « Encaissé » de l'écran Vendeurs, qui est le
          // brut. Les deux sont justes, l'écart est le SAV remboursé.
          precision={`${bilan?.nb_ventes ?? 0} vente(s), ${bilan?.qte_vendue ?? 0} u · net des remboursements SAV`}
        />
        <Kpi
          libelle="Coût des marchandises" icone={PackageIcon}
          valeur={euros(bilan?.cout_marchandises ?? 0)}
          evolution={ecart("cout_marchandises")}
          precision="au coût moyen pondéré figé"
        />
        <Kpi
          libelle="Commissions versées" icone={CoinsIcon}
          valeur={euros(bilan?.commissions ?? 0)}
          evolution={ecart("commissions")}
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
          evolution={ecart("achats_total")}
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
              {avant &&
                ` Comparé aux ${serie.length} ${pas === "jour" ? "jours" : pas === "semaine" ? "semaines" : "mois"} précédents.`}
            </p>
          </CardHeader>
          <CardContent>
            {serie.length === 0 ? (
              <EtatVide
                icone={TrendingUpIcon}
                titre="Aucune vente sur cette période."
              />
            ) : (
              <CourbeCa serie={serie} pas={pas} precedente={serieAvant} />
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
              <BarresClassement
                format={euros}
                // `revenus_vendeurs` classe déjà par chiffre d'affaires.
                lignes={revenus.map((v) => ({
                  id: v.vendeur_id,
                  nom: v.nom,
                  valeur: Number(v.ca),
                  detail: `${v.nb_ventes} vente(s)`,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Les produits : ce qui part le plus, et ce qui rapporte le plus. Ce ne
          sont pas toujours les mêmes, d'où le tableau triable à côté des
          barres, qui ne classent que par unités. */}
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Meilleures ventes</CardTitle>
            <p className="text-muted-foreground text-xs">
              En unités vendues sur la période.
            </p>
          </CardHeader>
          <CardContent>
            {produits.length === 0 ? (
              <EtatVide
                icone={PackageIcon}
                titre="Aucun produit vendu sur cette période."
              />
            ) : (
              <BarresClassement
                max={8}
                format={(n) => `${n} u`}
                // `ventes_par_produit` classe déjà par unités vendues.
                lignes={produits.map((p) => ({
                  id: p.produit_id,
                  nom: nomProduit(p),
                  valeur: p.unites,
                  detail: `${euros(p.ca)} de chiffre d'affaires`,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-wrap items-start justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-sm">Marge par produit</CardTitle>
              <p className="text-muted-foreground text-xs">
                Nette des remboursements SAV et du coût des unités échangées,
                comme la marge du haut de l&apos;écran.
              </p>
            </div>
            {produits.length > 0 && (
              <BoutonExport href={`/gestion/export-produits${suffixe}`} />
            )}
          </CardHeader>
          <CardContent>
            <Tableau
              colonnes={COLONNES_PRODUITS}
              lignes={produits}
              cle={(l) => l.produit_id}
              tri={{ params, chemin: "/gestion", prefixe: "p" }}
              vide="Aucun produit vendu sur cette période."
            />
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
