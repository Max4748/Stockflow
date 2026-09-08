import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { date, euros, eurosPrecis } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { ProduitAvecModele, Restock } from "@/lib/types";

import {
  BoutonSupprimerAchat,
  DialogueCorrigerAchat,
  FormulaireAchat,
  type SaisieAchat,
} from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Restock — StockFlow" };

const COLONNES: Colonne<Restock>[] = [
  {
    cle: "ref",
    entete: "Référence",
    principale: true,
    valeur: (l) => l.reference ?? "(sans référence)",
  },
  { cle: "date", entete: "Date", valeur: (l) => date(l.date) },
  {
    cle: "qte",
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.quantite_totale,
  },
  {
    cle: "base",
    entete: "Marchandise",
    alignement: "droite",
    valeur: (l) => euros(l.prix_achat_base),
  },
  {
    cle: "port",
    entete: "Frais de port",
    alignement: "droite",
    valeur: (l) => euros(l.frais_port),
  },
  {
    cle: "unitaire",
    entete: "Coût unitaire",
    alignement: "droite",
    // 4 décimales : une division par 250 unités ne tombe pas juste au centime,
    // et arrondir ici décalerait la marge.
    valeur: (l) => eurosPrecis(l.prix_achat_unitaire),
  },
];

export default async function PageAchats() {
  await exigerAdmin();
  const supabase = await creerClient();

  const [rProduits, rAchats, rLignes] = await Promise.all([
    supabase
      .from("produits")
      // Le prix conseillé vit sur le modèle : PostgREST le joint plutôt qu'un
      // second aller-retour.
      .select("id, modele_id, nom, sku, actif, modeles(nom, prix_vente_conseille, actif)")
      .eq("actif", true)
      .order("nom"),
    supabase
      .from("restocks")
      .select("*")
      .order("date", { ascending: false })
      .order("cree_le", { ascending: false })
      .limit(50),
    // Les lignes servent UNIQUEMENT à pré-remplir le formulaire de
    // correction. Une seule requête pour les 50 achats affichés, plutôt qu'une
    // par ligne ouverte : c'est le même volume et ça évite un aller-retour au
    // moment où le dialogue s'ouvre.
    supabase.from("restock_lignes").select("restock_id, produit_id, quantite"),
  ]);

  const produits = ((rProduits.data as ProduitAvecModele[] | null) ?? [])
    // Un modèle désactivé emporte ses parfums : ils n'ont plus de prix.
    .filter((p) => p.modeles?.actif)
    .sort((a, b) =>
      `${a.modeles.nom} ${a.nom}`.localeCompare(`${b.modeles.nom} ${b.nom}`),
    );
  const achats = (rAchats.data as Restock[] | null) ?? [];
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Restock</h1>
        <FormulaireAchat produits={produits} />
      </div>

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
          <Tableau
            colonnes={COLONNES}
            lignes={achats}
            cle={(l) => l.id}
            vide="Aucun achat enregistré."
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
        </CardContent>
      </Card>
    </div>
  );
}
