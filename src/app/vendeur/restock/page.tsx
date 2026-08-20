import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerProfil } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { dateHeure, LIBELLES_STATUT } from "@/lib/format";
import type { DemandeRestock, LigneStockEntrepot } from "@/lib/types";

import { BoutonAnnuler, FormulaireRestock } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Réassort — StockFlow" };

const VARIANTE_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  en_attente: "secondary",
  approuvee: "default",
  partielle: "default",
  refusee: "destructive",
  annulee: "outline",
};

export default async function PageRestock() {
  await exigerProfil();
  const supabase = await creerClient();

  const [rEntrepot, rDemandes] = await Promise.all([
    // Quantités de l'entrepôt, sans aucune valorisation : sans cette info le
    // vendeur demanderait des réassorts impossibles.
    supabase.rpc("stock_entrepot"),
    supabase
      .from("demandes_restock")
      .select("*, demande_lignes(*, produits(nom))")
      .order("cree_le", { ascending: false })
      .limit(20),
  ]);

  const entrepot = (rEntrepot.data as LigneStockEntrepot[] | null) ?? [];
  const demandes = (rDemandes.data as DemandeRestock[] | null) ?? [];
  const enAttente = demandes.find((d) => d.statut === "en_attente");

  return (
    <div className="w-full space-y-6">
      {/* Le bouton n'apparaît que s'il n'y a rien en attente : une seule
          demande à la fois (index unique partiel en base). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Réassort</h1>
        {!enAttente && <FormulaireRestock produits={entrepot} />}
      </div>

      {(rEntrepot.error || rDemandes.error) && (
        <Alert variant="destructive">
          <AlertDescription>
            {rEntrepot.error?.message ?? rDemandes.error?.message}
          </AlertDescription>
        </Alert>
      )}

      {enAttente && (
        <Card className="lg:max-w-2xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Demande en cours</CardTitle>
              <Badge variant="secondary">En attente</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Une seule demande peut être en attente à la fois. Pour en modifier
              le contenu, il faut l&apos;annuler puis en créer une nouvelle.
            </p>
            <ul className="divide-y text-sm">
              {enAttente.demande_lignes.map((l) => (
                <li key={l.id} className="flex justify-between py-2">
                  <span className="truncate">{l.produits?.nom ?? "—"}</span>
                  <span className="tabular-nums">
                    {l.quantite_demandee} demandée(s)
                  </span>
                </li>
              ))}
            </ul>
            {enAttente.note && (
              <p className="text-muted-foreground text-sm italic">
                « {enAttente.note} »
              </p>
            )}
            <BoutonAnnuler demandeId={enAttente.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Historique des demandes</CardTitle>
        </CardHeader>
        <CardContent>
          {demandes.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Aucune demande pour le moment.
            </p>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {demandes.map((d) => (
                <li key={d.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {dateHeure(d.cree_le)}
                    </span>
                    <Badge variant={VARIANTE_BADGE[d.statut] ?? "outline"}>
                      {LIBELLES_STATUT[d.statut] ?? d.statut}
                    </Badge>
                  </div>
                  <ul className="text-sm">
                    {d.demande_lignes.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {l.produits?.nom ?? "—"}
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {d.statut === "en_attente" || d.statut === "annulee"
                            ? `${l.quantite_demandee} demandée(s)`
                            : `${l.quantite_accordee} / ${l.quantite_demandee} accordée(s)`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {d.motif_refus && (
                    <p className="text-muted-foreground text-xs italic">
                      Réponse de l&apos;administrateur : {d.motif_refus}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
