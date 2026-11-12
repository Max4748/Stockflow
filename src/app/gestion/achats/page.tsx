import { ChampRecherche } from "@/components/champ-recherche";
import { EntetePage } from "@/components/entete-page";
import { Pagination } from "@/components/pagination";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { date, euros, eurosPrecis } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import { lirePage, lireTri, motifIlike, triSql } from "@/lib/tri";
import type { ProduitAvecModele, Restock } from "@/lib/types";

import {
  BoutonSupprimerAchat,
  DialogueCorrigerAchat,
  FormulaireAchat,
  type SaisieAchat,
} from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Restock — StockFlow" };

// Paginé, donc trié et cherché en base : l'ancienne coupe à 50 achats rendait
// les plus anciens introuvables.
const PAR_PAGE = 20;

const COLONNES: Colonne<Restock>[] = [
  {
    cle: "ref",
    colonneSql: "reference",
    entete: "Référence",
    principale: true,
    valeur: (l) => l.reference ?? "(sans référence)",
  },
  { cle: "date", colonneSql: "date", entete: "Date", valeur: (l) => date(l.date) },
  {
    cle: "qte",
    colonneSql: "quantite_totale",
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.quantite_totale,
  },
  {
    cle: "base",
    colonneSql: "prix_achat_base",
    entete: "Marchandise",
    alignement: "droite",
    valeur: (l) => euros(l.prix_achat_base),
  },
  {
    cle: "port",
    colonneSql: "frais_port",
    entete: "Frais de port",
    alignement: "droite",
    valeur: (l) => euros(l.frais_port),
  },
  {
    cle: "unitaire",
    colonneSql: "prix_achat_unitaire",
    entete: "Coût unitaire",
    alignement: "droite",
    // 4 décimales : une division par 250 unités ne tombe pas juste au centime,
    // et arrondir ici décalerait la marge.
    valeur: (l) => eurosPrecis(l.prix_achat_unitaire),
  },
];

export default async function PageAchats({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  const params = await searchParams;
  const supabase = await creerClient();

  const page = lirePage(params, PAR_PAGE);
  const ordre = triSql(COLONNES, lireTri(params), {
    colonne: "date",
    ascendant: false,
  });
  const motif = motifIlike(params.q);

  let lectureAchats = supabase
    .from("restocks")
    .select("*", { count: "exact" })
    .order(ordre.colonne, { ascending: ordre.ascendant })
    // Départage stable entre deux achats du même jour.
    .order("cree_le", { ascending: false })
    .range(page.de, page.a);
  if (motif) lectureAchats = lectureAchats.ilike("reference", motif);

  const [rProduits, rAchats] = await Promise.all([
    supabase
      .from("produits")
      // Le prix conseillé vit sur le modèle : PostgREST le joint plutôt qu'un
      // second aller-retour.
      .select("id, modele_id, nom, sku, actif, modeles(nom, prix_vente_conseille, actif)")
      .eq("actif", true)
      .order("nom"),
    lectureAchats,
  ]);
  const achats = (rAchats.data as Restock[] | null) ?? [];

  // Les lignes servent UNIQUEMENT à pré-remplir le formulaire de correction.
  // Une seule requête pour les achats de la PAGE, plutôt qu'une par dialogue
  // ouvert ; et plus pour toute la table, qui grossit sans fin.
  const rLignes =
    achats.length > 0
      ? await supabase
          .from("restock_lignes")
          .select("restock_id, produit_id, quantite")
          .in("restock_id", achats.map((a) => a.id))
      : { data: [], error: null };

  const produits = ((rProduits.data as ProduitAvecModele[] | null) ?? [])
    // Un modèle désactivé emporte ses parfums : ils n'ont plus de prix.
    .filter((p) => p.modeles?.actif)
    .sort((a, b) =>
      `${a.modeles.nom} ${a.nom}`.localeCompare(`${b.modeles.nom} ${b.nom}`),
    );
  const lignes =
    (rLignes.data as
      | { restock_id: string; produit_id: string; quantite: number }[]
      | null) ?? [];
  const erreur = rProduits.error ?? rAchats.error;

  const saisies = new Map<string, SaisieAchat>(
    achats.map((a) => [
      a.id,
      {
        quantites: Object.fromEntries(
          lignes
            .filter((l) => l.restock_id === a.id)
            .map((l) => [l.produit_id, String(l.quantite)]),
        ),
        prixBase: String(a.prix_achat_base),
        fraisPort: String(a.frais_port),
        reference: a.reference ?? "",
        date: a.date,
      },
    ]),
  );

  return (
    <div className="w-full space-y-6">
      <EntetePage titre="Restock">
        <FormulaireAchat produits={produits} />
      </EntetePage>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Historique des restocks</CardTitle>
        </CardHeader>
        <CardContent>
          <ChampRecherche
            libelle="Rechercher une référence"
            className="mb-4 sm:max-w-xs"
          />
          <Tableau
            colonnes={COLONNES}
            lignes={achats}
            cle={(l) => l.id}
            tri={{ params, chemin: "/gestion/achats", dejaTrie: true }}
            vide={
              params.q
                ? "Aucun achat ne correspond à cette recherche."
                : "Aucun achat enregistré."
            }
            action={(a) => (
              <span className="flex shrink-0 gap-2">
                <DialogueCorrigerAchat
                  produits={produits}
                  achat={a}
                  saisie={saisies.get(a.id)!}
                />
                <BoutonSupprimerAchat achat={a} />
              </span>
            )}
          />
          <Pagination
            params={params}
            chemin="/gestion/achats"
            page={page.page}
            parPage={PAR_PAGE}
            total={rAchats.count}
          />
        </CardContent>
      </Card>
    </div>
  );
}
