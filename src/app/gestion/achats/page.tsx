import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { date, euros, eurosPrecis } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { Produit, Restock } from "@/lib/types";

import { FormulaireAchat } from "./formulaire";

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

  const [rProduits, rAchats] = await Promise.all([
    supabase.from("produits").select("*").eq("actif", true).order("nom"),
    supabase
      .from("restocks")
      .select("*")
      .order("date", { ascending: false })
      .order("cree_le", { ascending: false })
      .limit(50),
  ]);

  const produits = (rProduits.data as Produit[] | null) ?? [];
  const achats = (rAchats.data as Restock[] | null) ?? [];
  const erreur = rProduits.error ?? rAchats.error;

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
          />
        </CardContent>
      </Card>
    </div>
  );
}
