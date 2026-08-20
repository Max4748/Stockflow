import Link from "next/link";

import { FiltrePeriode } from "@/components/filtre-periode";
import { Kpi } from "@/components/kpi";
import { ChampSelect } from "@/components/champ-select";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { date, dateHeure, euros } from "@/lib/format";
import { argsPeriode, lirePeriode } from "@/lib/periode";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { BilanGlobal, LigneJournal, Profil } from "@/lib/types";

import { BoutonAnnulerVente } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal comptable — StockFlow" };

const PAR_PAGE = 50;

const TYPES = [
  { valeur: "", libelle: "Tous les types" },
  { valeur: "vente", libelle: "Ventes" },
  { valeur: "achat", libelle: "Achats" },
  { valeur: "transfert", libelle: "Transferts" },
  { valeur: "retour", libelle: "Retours" },
  { valeur: "ajustement", libelle: "Ajustements" },
  { valeur: "sav", libelle: "SAV" },
  { valeur: "versement", libelle: "Versements" },
];

const VARIANTE: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  vente: "default",
  achat: "secondary",
  versement: "secondary",
  // Une défaillance est une mauvaise nouvelle : elle doit se repérer d'un
  // coup d'œil dans une colonne qui en compte six autres.
  sav: "destructive",
};

export default async function PageComptabilite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  const params = await searchParams;
  const periode = lirePeriode(params);
  const args = argsPeriode(periode);

  const type = params.type ?? "";
  const vendeurId = params.vendeur ?? "";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const supabase = await creerClient();
  const [rJournal, rBilan, rProfils] = await Promise.all([
    supabase.rpc("journal_transactions", {
      ...args,
      p_type: type || null,
      p_vendeur_id: vendeurId || null,
      // Pagination EXPLICITE : PostgREST tronque à 1000 lignes en silence, un
      // journal reconstitué côté client depuis une réponse tronquée serait
      // faux sans aucune erreur.
      p_limite: PAR_PAGE,
      p_offset: (page - 1) * PAR_PAGE,
    }),
    supabase.rpc("bilan_global", args),
    // Tous les comptes, pas seulement les vendeurs : un gérant qui vend a des
    // lignes dans le journal, elles doivent être filtrables comme les autres.
    supabase.from("profils").select("id, nom, role, actif").order("nom"),
  ]);

  const journal = (rJournal.data as LigneJournal[] | null) ?? [];
  const bilan = (rBilan.data as BilanGlobal[] | null)?.[0] ?? null;
  const vendeurs =
    (rProfils.data as Pick<Profil, "id" | "nom" | "role">[] | null) ?? [];
  const erreur = rJournal.error ?? rBilan.error;

  const colonnes: Colonne<LigneJournal>[] = [
    {
      cle: "date",
      entete: "Date",
      principale: true,
      valeur: (l) => (
        <span className="flex items-center gap-2">
          {date(l.date_compta)}
          <Badge variant={VARIANTE[l.type] ?? "outline"}>{l.type}</Badge>
        </span>
      ),
    },
    { cle: "libelle", entete: "Opération", valeur: (l) => l.libelle ?? "—" },
    { cle: "vendeur", entete: "Vendeur", valeur: (l) => l.vendeur ?? "—" },
    {
      cle: "qte",
      entete: "Unités",
      alignement: "droite",
      valeur: (l) => (l.quantite === null ? "—" : l.quantite),
    },
    {
      cle: "montant",
      entete: "Montant",
      alignement: "droite",
      valeur: (l) => (l.montant === null ? "—" : euros(l.montant)),
    },
    {
      cle: "saisie",
      entete: "Saisie le",
      masquerEnCarte: true,
      valeur: (l) => (
        <span className="text-muted-foreground text-xs">
          {dateHeure(l.horodatage)}
        </span>
      ),
    },
  ];

  function lienPage(n: number) {
    const p = new URLSearchParams();
    if (periode.cle !== "tout") p.set("periode", periode.cle);
    if (periode.cle === "libre") {
      if (periode.du) p.set("du", periode.du);
      if (periode.au) p.set("au", periode.au);
    }
    if (type) p.set("type", type);
    if (vendeurId) p.set("vendeur", vendeurId);
    if (n > 1) p.set("page", String(n));
    const q = p.toString();
    return `/gestion/comptabilite${q ? `?${q}` : ""}`;
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Journal comptable</h1>
        <FiltrePeriode actif={periode.cle} />
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi libelle="Chiffre d'affaires" valeur={euros(bilan?.ca ?? 0)} />
        <Kpi
          libelle="Coût des marchandises"
          valeur={euros(bilan?.cout_marchandises ?? 0)}
        />
        <Kpi libelle="Commissions" valeur={euros(bilan?.commissions ?? 0)} />
        <Kpi
          libelle="Marge nette"
          valeur={euros(bilan?.marge_nette ?? 0)}
          precision="Σ qté × (prix − coût − commission)"
          accent
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filtres</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Un GET : les filtres vivent dans l'URL, la page reste un Server
              Component et le lien est partageable. */}
          <form
            method="get"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            {periode.cle !== "tout" && (
              <input type="hidden" name="periode" value={periode.cle} />
            )}
            {periode.cle === "libre" && periode.du && (
              <input type="hidden" name="du" value={periode.du} />
            )}
            {periode.cle === "libre" && periode.au && (
              <input type="hidden" name="au" value={periode.au} />
            )}

            <div className="space-y-2">
              <label htmlFor="f-type" className="text-sm font-medium">
                Type d&apos;opération
              </label>
              <ChampSelect
                id="f-type"
                name="type"
                defaultValue={type}
                options={TYPES}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="f-vendeur" className="text-sm font-medium">
                Compte
              </label>
              <ChampSelect
                id="f-vendeur"
                name="vendeur"
                defaultValue={vendeurId}
                options={[
                  { valeur: "", libelle: "Tous les comptes" },
                  ...vendeurs.map((v) => ({
                    valeur: v.id,
                    libelle:
                      v.nom +
                      (v.role === "dev"
                        ? " (dev)"
                        : v.role === "gerant"
                          ? " (gérant)"
                          : ""),
                  })),
                ]}
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                className={cn(buttonVariants({ variant: "outline" }), "h-11")}
              >
                Appliquer
              </button>
              {(type || vendeurId) && (
                <Link
                  href={
                    periode.cle === "tout"
                      ? "/gestion/comptabilite"
                      : `/gestion/comptabilite?periode=${periode.cle}`
                  }
                  className={cn(buttonVariants({ variant: "ghost" }), "h-11")}
                >
                  Réinitialiser
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Transactions — page {page}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tableau
            colonnes={colonnes}
            lignes={journal}
            cle={(l) => `${l.type}-${l.reference}-${l.horodatage}`}
            vide="Aucune transaction sur cette période."
            action={(l) =>
              // Seule une vente est annulable : un achat ou un transfert
              // s'annule par un ajustement motivé, pour ne pas réécrire les
              // coûts déjà figés.
              l.type === "vente" ? (
                <BoutonAnnulerVente
                  venteId={l.reference}
                  libelle={l.libelle ?? "cette vente"}
                  montant={l.montant}
                />
              ) : null
            }
          />

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            {page > 1 ? (
              <Link
                href={lienPage(page - 1)}
                className={cn(buttonVariants({ variant: "outline" }), "h-10")}
              >
                Page précédente
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground text-sm">
              {journal.length} ligne(s) affichée(s)
            </span>
            {journal.length === PAR_PAGE ? (
              <Link
                href={lienPage(page + 1)}
                className={cn(buttonVariants({ variant: "outline" }), "h-10")}
              >
                Page suivante
              </Link>
            ) : (
              <span />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
