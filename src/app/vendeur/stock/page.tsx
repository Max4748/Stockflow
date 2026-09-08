import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { exigerProfil } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { niveauStock } from "@/lib/format";
import type { LigneStock, TarifPreleve } from "@/lib/types";

import { FormulairePrelevement } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mon stock — StockFlow" };

export default async function PageStock() {
  const profil = await exigerProfil();
  const supabase = await creerClient();

  // stock_disponible() ne renvoie que le stock DÉTENU par l'appelant, et
  // jamais de valorisation : le coût d'achat n'est pas une information vendeur.
  // Les deux en parallèle : l'un ne dépend pas de l'autre, et les enchaîner
  // ajouterait un aller-retour pour rien.
  const [{ data, error }, { data: tarifsBruts }] = await Promise.all([
    supabase.rpc("stock_disponible"),
    // Ses PROPRES tarifs : `tarifs_preleves` refuse ceux d'un autre compte.
    supabase.rpc("tarifs_preleves", { p_vendeur_id: profil.id }),
  ]);
  const stock = (data as LigneStock[] | null) ?? [];
  const tarifs = (tarifsBruts as TarifPreleve[] | null) ?? [];
  const total = stock.reduce((s, l) => s + l.quantite, 0);

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Mon stock</h1>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm tabular-nums">
            {total} unité(s)
          </span>
          <FormulairePrelevement stock={stock} tarifs={tarifs} />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {stock.length === 0 ? (
        <Alert>
          <AlertDescription>
            Aucun produit au catalogue pour le moment.
          </AlertDescription>
        </Alert>
      ) : (
        // Tuiles plutôt qu'une liste : une liste en pleine largeur mettrait le
        // nom du produit à un bout de l'écran et sa quantité à l'autre. Le
        // nombre de colonnes suit la place disponible, jusqu'à 6.
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          {stock.map((l) => {
            const niveau = niveauStock(l.quantite, l.seuil_parfum);
            return (
              <li key={l.produit_id}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-2 pt-5">
                    <p className="line-clamp-2 text-sm font-medium">
                      {l.produit}
                    </p>
                    <div className="mt-auto flex items-end justify-between gap-2">
                      <span className="text-3xl font-semibold tabular-nums">
                        {l.quantite}
                      </span>
                      {niveau === "rupture" && (
                        <Badge variant="destructive">épuisé</Badge>
                      )}
                      {niveau === "bas" && (
                        <Badge variant="secondary">bas</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      seuil d&apos;alerte : {l.seuil_parfum}
                    </p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Masqué pour un compte lié à l'entrepôt : il se demanderait du stock
          à lui-même, et l'onglet Réassort a déjà disparu de sa navigation.
          Son geste à lui est l'achat fournisseur, côté gestion. */}
      {!profil.stock_lie_entrepot && (
        <Link
          href="/vendeur/restock"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 w-full md:w-auto md:px-8",
          )}
        >
          Demander un réassort
        </Link>
      )}
    </div>
  );
}
