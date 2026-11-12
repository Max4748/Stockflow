import { BoxesIcon, TriangleAlertIcon, UsersIcon, WalletIcon, WarehouseIcon } from "lucide-react";
import { ChampRecherche } from "@/components/champ-recherche";
import { EntetePage } from "@/components/entete-page";
import { Kpi } from "@/components/kpi";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { filtrer } from "@/lib/tri";
import { exigerAdmin } from "@/lib/auth";
import { euros, niveauStock } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type {
  ProduitAvecModele,
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
    tri: (l) => l.produit,
    entete: "Produit",
    principale: true,
    valeur: (l) => {
      const niveau = niveauStock(l.stock_entrepot, l.seuil_parfum);
      return (
        <span className="flex items-center gap-2">
          {l.produit}
          {!l.actif && <Badge variant="outline">inactif</Badge>}
          {niveau === "rupture" && (
            <Badge variant="destructive">entrepôt vide</Badge>
          )}
          {niveau === "bas" && <Badge variant="alerte">entrepôt bas</Badge>}
        </span>
      );
    },
  },
  {
    cle: "entrepot",
    tri: (l) => l.stock_entrepot,
    entete: "Entrepôt",
    alignement: "droite",
    valeur: (l) => l.stock_entrepot,
  },
  {
    cle: "distribue",
    tri: (l) => l.stock_distribue,
    entete: "Chez les vendeurs",
    alignement: "droite",
    valeur: (l) => l.stock_distribue,
  },
  {
    cle: "total",
    tri: (l) => l.stock_total,
    entete: "Total",
    alignement: "droite",
    valeur: (l) => <span className="font-semibold">{l.stock_total}</span>,
  },
  {
    cle: "cout",
    tri: (l) => Number(l.cout_unitaire),
    entete: "Coût unitaire",
    alignement: "droite",
    valeur: (l) => euros(l.cout_unitaire),
  },
  {
    cle: "valeur",
    tri: (l) => Number(l.valeur_totale),
    entete: "Valeur",
    alignement: "droite",
    valeur: (l) => euros(l.valeur_totale),
  },
];

const COLONNES_DETENTEUR: Colonne<StockDetenteur>[] = [
  {
    cle: "detenteur",
    tri: (l) => l.detenteur,
    entete: "Détenteur",
    principale: true,
    valeur: (l) => l.detenteur,
  },
  { cle: "produit", tri: (l) => l.produit, entete: "Produit", valeur: (l) => l.produit },
  {
    cle: "qte",
    tri: (l) => l.quantite,
    entete: "Quantité",
    alignement: "droite",
    valeur: (l) => l.quantite,
  },
  {
    cle: "valeur",
    tri: (l) => Number(l.valeur),
    entete: "Valeur",
    alignement: "droite",
    valeur: (l) => euros(l.valeur),
  },
];

export default async function PageStock({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  const params = await searchParams;
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
      supabase
        .from("produits")
        .select("id, modele_id, nom, sku, actif, modeles(nom, prix_vente_conseille, actif)")
        .eq("actif", true)
        .order("nom"),
      // Les totaux viennent du SQL, pas d'un reduce() : sommer en TypeScript
      // des valeurs déjà arrondies au centime faisait diverger cet écran du
      // Bilan d'un centime. Voir `totaux_stock`.
      supabase.rpc("totaux_stock"),
    ],
  );

  const stock = (rStock.data as StockValorise[] | null) ?? [];
  const detenteurs = (rDetenteurs.data as StockDetenteur[] | null) ?? [];

  // La recherche ne filtre QUE les deux tableaux. `stock` et `detenteurs`
  // complets continuent d'alimenter les alertes de seuil et les dialogues :
  // chercher « vanille » ne doit ni cacher une rupture, ni retirer des
  // produits du formulaire de distribution.
  const stockAffiche = filtrer(stock, params.q, (l) => [l.produit, l.modele]);
  const detenteursAffiches = filtrer(detenteurs, params.q, (l) => [
    l.produit,
    l.detenteur,
  ]);
  const produits = ((rProduits.data as ProduitAvecModele[] | null) ?? [])
    .filter((p) => p.modeles?.actif)
    .sort((a, b) =>
      `${a.modeles.nom} ${a.nom}`.localeCompare(`${b.modeles.nom} ${b.nom}`),
    );

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
    (l) => l.actif && niveauStock(l.stock_entrepot, l.seuil_parfum) !== "ok",
  );

  return (
    <div className="w-full space-y-6">
      {/* Du moins fréquent au PRINCIPAL : « Nouveau Restock » finit à droite,
          comme l'action principale de tous les autres écrans. */}
      <EntetePage titre="État du stock">
        {/* Pas de bouton SAV ici : l'écran Service après-vente porte le sien,
            avec le suivi des dossiers qui va avec. Un doublon de plus dans un
            en-tête déjà chargé n'apportait rien. */}
        <FormulaireAjustement
          produits={stock.map((s) => ({ id: s.produit_id, nom: s.produit }))}
          detenteurs={comptes}
        />
        <FormulaireTransfert
          produits={stock.map((s) => ({
            id: s.produit_id,
            nom: s.produit,
            stockEntrepot: s.stock_entrepot,
          }))}
          detenteurs={comptesActifs}
        />
        {/* Même dialogue que l'écran Achats : recevoir une commande se pense
            depuis l'état du stock, pas depuis un historique d'achats. */}
        <FormulaireAchat produits={produits} />
      </EntetePage>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          libelle="En entrepôt" icone={WarehouseIcon}
          valeur={`${totaux?.entrepot ?? 0} u`}
          precision="disponible pour les réassorts"
        />
        <Kpi
          libelle="Chez les vendeurs" icone={UsersIcon}
          valeur={`${totaux?.distribue ?? 0} u`}
          precision="détenu, pas encore vendu"
        />
        <Kpi
          libelle="Stock total" icone={BoxesIcon}
          valeur={`${totaux?.total ?? 0} u`}
          precision="entrepôt + distribué"
          accent
        />
        <Kpi
          libelle="Valeur du stock" icone={WalletIcon}
          valeur={euros(totaux?.valeur ?? 0)}
          precision="au coût moyen pondéré"
        />
      </div>

      {alertes.length > 0 && (
        <Alert variant="alerte">
          <TriangleAlertIcon />
          <AlertDescription>
            Entrepôt sous le seuil d&apos;alerte :{" "}
            {alertes
              .map((a) => `${a.produit} (${a.stock_entrepot})`)
              .join(", ")}
            .
          </AlertDescription>
        </Alert>
      )}

      <ChampRecherche
        libelle="Rechercher un produit ou un détenteur"
        className="sm:max-w-sm"
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Par produit</CardTitle>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES_PRODUIT}
            lignes={stockAffiche}
            cle={(l) => l.produit_id}
            tri={{ params, chemin: "/gestion/stock" }}
            vide={
              params.q
                ? "Aucun produit ne correspond à cette recherche."
                : "Aucun produit au catalogue."
            }
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
            lignes={detenteursAffiches}
            cle={(l) => `${l.detenteur_id ?? "entrepot"}-${l.produit_id}`}
            tri={{ params, chemin: "/gestion/stock", prefixe: "d" }}
            vide={
              params.q
                ? "Aucun stock ne correspond à cette recherche."
                : "Aucun stock en circulation."
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
