import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { Produit } from "@/lib/types";

import { DialogueProduit } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produits — StockFlow" };

export default async function PageProduits() {
  await exigerAdmin();
  const supabase = await creerClient();

  // Écriture directe en table : la policy `produits_admin_all` l'autorise.
  // Pas de RPC nécessaire, un produit ne porte aucun invariant comptable.
  const { data, error } = await supabase
    .from("produits")
    .select("*")
    .order("nom");

  const produits = (data as Produit[] | null) ?? [];

  return (
    <div className="w-full space-y-6">
      {/* Création et édition passent par des dialogues : la page reste une
          liste lisible, sans formulaire permanent en tête. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Produits</h1>
        <DialogueProduit />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Catalogue ({produits.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {produits.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Aucun produit. En créer un pour commencer.
            </p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {produits.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{p.nom}</span>
                      {!p.actif && <Badge variant="outline">inactif</Badge>}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {p.sku ? `${p.sku} · ` : ""}
                      {euros(p.prix_vente_conseille)} conseillé · seuil{" "}
                      {p.seuil_alerte}
                    </p>
                  </div>
                  <DialogueProduit produit={p} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
