import { Kpi } from "@/components/kpi";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { euros, niveauStock } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type {
  Produit,
  StockDetenteur,
  StockValorise,
  TotauxStock,
} from "@/lib/types";

import { FormulaireAchat } from "../achats/formulaire";

import {
  FormulaireAjustement,
  FormulaireTransfert,
  type Detenteur,
} from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "État du stock — StockFlow" };

const COLONNES_PRODUIT: Colonne<StockValorise>[] = [
  {
    cle: "produit",
    entete: "Produit",
    principale: true,
    valeur: (l) => {
      const niveau = niveauStock(l.stock_entrepot, l.seuil_alerte);
      return (
        <span className="flex items-center gap-2">
          {l.produit}
          {!l.actif && <Badge variant="outline">inactif</Badge>}
          {niveau === "rupture" && (
            <Badge variant="destructive">entrepôt vide</Badge>
          )}
          {niveau === "bas" && <Badge variant="secondary">entrepôt bas</Badge>}
        </span>
      );
    },
  },
  {
    cle: "entrepot",
    entete: "Entrepôt",
    alignement: "droite",
    valeur: (l) => l.stock_entrepot,
  },
  {
    cle: "distribue",
    entete: "Chez les vendeurs",
    alignement: "droite",
    valeur: (l) => l.stock_distribue,
  },
  {
    cle: "total",
    entete: "Total",
    alignement: "droite",
    valeur: (l) => <span className="font-semibold">{l.stock_total}</span>,
  },
  {
    cle: "cout",
    entete: "Coût unitaire",
    alignement: "droite",
    valeur: (l) => euros(l.cout_unitaire),
  },
  {
    cle: "valeur",
    entete: "Valeur",
    alignement: "droite",
    valeur: (l) => euros(l.valeur_totale),
  },
];

const COLONNES_DETENTEUR: Colonne<StockDetenteur>[] = [
  {
    cle: "detenteur",
    entete: "Détenteur",
    principale: true,
    valeur: (l) => l.detenteur,
  },
  { cle: "produit", entete: "Produit", valeur: (l) => l.produit },
  {
    cle: "qte",
    entete: "Quantité",
    alignement: "droite",
    valeur: (l) => l.quantite,
  },
  {
    cle: "valeur",
    entete: "Valeur",
    alignement: "droite",
    valeur: (l) => euros(l.valeur),
  },
];

export default async function PageStock() {
  await exigerAdmin();
  const supabase = await creerClient();

  const [rStock, rDetenteurs, rProfils, rProduits, rTotaux] = await Promise.all(
    [
      supabase.rpc("stock_valorise"),
      supabase.rpc("stock_detenteurs"),
      // AUCUN filtre de rôle : un gérant vend aussi, il détient donc du stock
      // comme un vendeur. C'est la fonction SQL qui décide de ce qui est permis.
      supabase.from("profils").select("id, nom, role, actif").order("nom"),
      // Le formulaire de restock a besoin des produits complets (prix conseillé),
      // que stock_valorise() ne porte pas.
      supabase.from("produits").select("*").eq("actif", true).order("nom"),
      // Les totaux viennent du SQL, pas d'un reduce() : sommer en TypeScript
      // des valeurs déjà arrondies au centime faisait diverger cet écran du
      // Bilan d'un centime. Voir migration 0018.
      supabase.rpc("totaux_stock"),
    ],
  );

  const stock = (rStock.data as StockValorise[] | null) ?? [];
  const detenteurs = (rDetenteurs.data as StockDetenteur[] | null) ?? [];
  const produits = (rProduits.data as Produit[] | null) ?? [];

  // Ce que chaque compte détient déjà, pour que le choix d'un destinataire se
  // fasse en connaissance de cause plutôt qu'à l'aveugle. Les lignes
  // d'entrepôt (detenteur_id null) sont écartées : l'entrepôt n'est pas un
  // destinataire, c'est la source.
  const parCompte = new Map<string, { produit: string; quantite: number }[]>();
  for (const d of detenteurs) {
    if (!d.detenteur_id) continue;
    const liste = parCompte.get(d.detenteur_id) ?? [];
    liste.push({ produit: d.produit, quantite: d.quantite });
    parCompte.set(d.detenteur_id, liste);
  }

  const comptes: Detenteur[] = (
    (rProfils.data as Omit<Detenteur, "detient">[] | null) ?? []
  ).map((c) => ({ ...c, detient: parCompte.get(c.id) ?? [] }));
  // On ne distribue du stock qu'à un compte actif ; l'ajustement d'inventaire,
  // lui, doit rester possible sur le stock resté chez un compte désactivé.
  const comptesActifs = comptes.filter((c) => c.actif);
  const totaux = (rTotaux.data as TotauxStock[] | null)?.[0] ?? null;
  const erreur = rStock.error ?? rDetenteurs.error ?? rProfils.error;

  const alertes = stock.filter(
    (l) => l.actif && niveauStock(l.stock_entrepot, l.seuil_alerte) !== "ok",
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">État du stock</h1>
        <div className="flex flex-col gap-2 sm:flex-row">
          {/* Même dialogue que l'écran Achats : recevoir une commande se pense
              depuis l'état du stock, pas depuis un historique d'achats. */}
          <FormulaireAchat produits={produits} />
          <FormulaireTransfert
            produits={stock.map((s) => ({
              id: s.produit_id,
              nom: s.produit,
              stockEntrepot: s.stock_entrepot,
            }))}
            detenteurs={comptesActifs}
          />
          {/* Pas de bouton SAV ici : l'écran Service après-vente porte le sien,
              avec le suivi des dossiers qui va avec. Un doublon de plus dans un
              en-tête déjà chargé n'apportait rien. */}
          <FormulaireAjustement
            produits={stock.map((s) => ({ id: s.produit_id, nom: s.produit }))}
            detenteurs={comptes}
          />
        </div>
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          libelle="En entrepôt"
          valeur={`${totaux?.entrepot ?? 0} u`}
          precision="disponible pour les réassorts"
        />
        <Kpi
          libelle="Chez les vendeurs"
          valeur={`${totaux?.distribue ?? 0} u`}
          precision="détenu, pas encore vendu"
        />
        <Kpi
          libelle="Stock total"
          valeur={`${totaux?.total ?? 0} u`}
          precision="entrepôt + distribué"
          accent
        />
        <Kpi
          libelle="Valeur du stock"
          valeur={euros(totaux?.valeur ?? 0)}
          precision="au coût moyen pondéré"
        />
      </div>

      {alertes.length > 0 && (
        <Alert>
          <AlertDescription>
            Entrepôt sous le seuil d&apos;alerte :{" "}
            {alertes
              .map((a) => `${a.produit} (${a.stock_entrepot})`)
              .join(", ")}
            .
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Par produit</CardTitle>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES_PRODUIT}
            lignes={stock}
            cle={(l) => l.produit_id}
            vide="Aucun produit au catalogue."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Qui détient quoi</CardTitle>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES_DETENTEUR}
            lignes={detenteurs}
            cle={(l) => `${l.detenteur_id ?? "entrepot"}-${l.produit_id}`}
            vide="Aucun stock en circulation."
          />
        </CardContent>
      </Card>
    </div>
  );
}
