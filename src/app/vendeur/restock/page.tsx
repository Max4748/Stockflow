import { Pagination } from "@/components/pagination";
import { lirePage } from "@/lib/tri";
import { EtatVide } from "@/components/etat-vide";
import { EntetePage } from "@/components/entete-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VARIANTE_STATUT } from "@/lib/statuts";
import { exigerProfil } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { dateHeure, LIBELLES_STATUT } from "@/lib/format";
import type { DemandeRestock, LigneStockEntrepot } from "@/lib/types";

import { BoutonAnnuler, FormulaireRestock } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Réassort — StockFlow" };

// L'historique était coupé à 20 demandes ; il est paginé.
const PAR_PAGE = 12;

export default async function PageRestock({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = lirePage(params, PAR_PAGE);
  await exigerProfil();
  const supabase = await creerClient();

  const [rEntrepot, rDemandes, rEnAttente] = await Promise.all([
    // Quantités de l'entrepôt, sans aucune valorisation : sans cette info le
    // vendeur demanderait des réassorts impossibles.
    supabase.rpc("stock_entrepot"),
    supabase
      .from("demandes_restock")
      .select("*, demande_lignes(*, produits(nom))", { count: "exact" })
      .order("cree_le", { ascending: false })
      .range(page.de, page.a),
    // La demande en attente est cherchée À PART : en page 2 de l'historique
    // elle ne serait plus dans les lignes reçues, et le bouton « Nouvelle
    // demande » réapparaîtrait à tort.
    supabase
      .from("demandes_restock")
      .select("*, demande_lignes(*, produits(nom))")
      .eq("statut", "en_attente")
      .limit(1),
  ]);

  const entrepot = (rEntrepot.data as LigneStockEntrepot[] | null) ?? [];
  const demandes = (rDemandes.data as DemandeRestock[] | null) ?? [];
  const enAttente = (rEnAttente.data as DemandeRestock[] | null)?.[0];

  return (
    <div className="w-full space-y-6">
      {/* Le bouton n'apparaît que s'il n'y a rien en attente : une seule
          demande à la fois (index unique partiel en base). */}
      <EntetePage titre="Réassort">
        {!enAttente && <FormulaireRestock produits={entrepot} />}
      </EntetePage>

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
              <Badge variant="alerte">En attente</Badge>
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
            <EtatVide titre="Aucune demande pour le moment." />
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {demandes.map((d) => (
                <li key={d.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {dateHeure(d.cree_le)}
                    </span>
                    <Badge variant={VARIANTE_STATUT[d.statut] ?? "outline"}>
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
          <Pagination
            params={params}
            chemin="/vendeur/restock"
            page={page.page}
            parPage={PAR_PAGE}
            total={rDemandes.count}
          />
        </CardContent>
      </Card>
    </div>
  );
}
