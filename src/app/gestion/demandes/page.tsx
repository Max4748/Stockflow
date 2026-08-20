import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { dateHeure, LIBELLES_STATUT } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { DemandeRestock, Profil, StockValorise } from "@/lib/types";

import { CarteDemande } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demandes de réassort — StockFlow" };

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

export default async function PageDemandes() {
  await exigerAdmin();
  const supabase = await creerClient();

  const [rDemandes, rStock, rProfils] = await Promise.all([
    supabase
      .from("demandes_restock")
      .select("*, demande_lignes(*, produits(nom))")
      .order("cree_le", { ascending: false })
      .limit(40),
    // Le stock entrepôt disponible, affiché en regard de chaque quantité
    // demandée : sans lui l'admin accorde à l'aveugle et se fait refuser par
    // le contrôle SQL.
    supabase.rpc("stock_valorise"),
    supabase
      .from("profils")
      .select(
        "id, nom, role, commission_unitaire, actif, doit_changer_mdp, cree_le",
      ),
  ]);

  const demandes = (rDemandes.data as DemandeRestock[] | null) ?? [];
  const stock = (rStock.data as StockValorise[] | null) ?? [];
  const profils = (rProfils.data as Profil[] | null) ?? [];
  const erreur = rDemandes.error ?? rStock.error ?? rProfils.error;

  const nomVendeur = new Map(profils.map((p) => [p.id, p.nom]));
  const dispoEntrepot = new Map(
    stock.map((s) => [s.produit_id, s.stock_entrepot]),
  );

  const enAttente = demandes.filter((d) => d.statut === "en_attente");
  const traitees = demandes.filter((d) => d.statut !== "en_attente");

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Demandes de réassort</h1>
        {enAttente.length > 0 && (
          <Badge variant="destructive">{enAttente.length} en attente</Badge>
        )}
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      {enAttente.length === 0 ? (
        <Alert>
          <AlertDescription>
            Aucune demande en attente. Rien ne bloque un vendeur.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {enAttente.map((d) => (
            <CarteDemande
              key={d.id}
              demande={d}
              vendeur={nomVendeur.get(d.vendeur_id) ?? "Vendeur inconnu"}
              dispoEntrepot={d.demande_lignes.map((l) => ({
                ligne_id: l.id,
                produit_id: l.produit_id,
                produit: l.produits?.nom ?? "—",
                demandee: l.quantite_demandee,
                disponible: dispoEntrepot.get(l.produit_id) ?? 0,
              }))}
            />
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Demandes traitées</CardTitle>
        </CardHeader>
        <CardContent>
          {traitees.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Aucune demande traitée pour le moment.
            </p>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {traitees.map((d) => (
                <li key={d.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {nomVendeur.get(d.vendeur_id) ?? "—"}
                    </span>
                    <Badge variant={VARIANTE_BADGE[d.statut] ?? "outline"}>
                      {LIBELLES_STATUT[d.statut] ?? d.statut}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    demandée le {dateHeure(d.cree_le)}
                    {d.traitee_le && ` · traitée le ${dateHeure(d.traitee_le)}`}
                  </p>
                  <ul className="text-sm">
                    {d.demande_lignes.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {l.produits?.nom ?? "—"}
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {d.statut === "annulee"
                            ? `${l.quantite_demandee} demandée(s)`
                            : `${l.quantite_accordee} / ${l.quantite_demandee}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {d.motif_refus && (
                    <p className="text-muted-foreground text-xs italic">
                      Motif : {d.motif_refus}
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
