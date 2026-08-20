import { FormulaireSav } from "@/components/formulaire-sav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerProfil } from "@/lib/auth";
import { date, dateHeure, euros, LIBELLES_STATUT_SAV } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import { borneVue, type DossierSav, type VenteSavable } from "@/lib/types";

import { DemandeSavEnAttente, MarquerSavVu } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "SAV — StockFlow" };

const VARIANTE_BADGE: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  valide: "default",
  en_attente: "secondary",
  refuse: "destructive",
  annule: "outline",
};

export default async function PageSavVendeur() {
  await exigerProfil();
  const supabase = await creerClient();

  const [rDossiers, rSavables, rNonVus] = await Promise.all([
    // `p_les_miennes` : dans l'espace vendeur, un gérant est un vendeur comme
    // les autres. Sans ce drapeau il voyait ici les dossiers de TOUS ses
    // vendeurs, sous un titre qui dit « Mes SAV » (migration 0018). Le
    // paramètre ne peut que restreindre — un vendeur n'obtient rien de plus en
    // le passant à false.
    supabase.rpc("dossiers_sav", { p_limite: 50, p_les_miennes: true }),
    supabase.rpc("ventes_savables", { p_les_miennes: true }),
    supabase.rpc("sav_non_vus"),
  ]);

  const dossiers = (rDossiers.data as DossierSav[] | null) ?? [];
  const savables = (rSavables.data as VenteSavable[] | null) ?? [];
  const nonVus = (rNonVus.data as number | null) ?? 0;
  const erreur = rDossiers.error ?? rSavables.error;

  const enAttente = dossiers.filter((d) => d.statut === "en_attente");
  const traites = dossiers.filter((d) => d.statut !== "en_attente");

  return (
    <div className="w-full space-y-6">
      {/* La page est affichée : la pastille n'a plus lieu d'être — mais
          seulement pour les dossiers qu'elle a montrés, d'où la borne. */}
      <MarquerSavVu actif={nonVus > 0} borne={borneVue(dossiers)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Mes SAV</h1>
        <FormulaireSav lignes={savables} contexte="vendeur" />
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      {enAttente.length > 0 && (
        <Card className="lg:max-w-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              En attente du gérant ({enAttente.length})
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Un remboursement ne change rien tant qu&apos;il n&apos;est pas
              validé : ce que vous devez reste le même jusque-là.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {enAttente.map((d) => (
              <DemandeSavEnAttente key={d.id} dossier={d} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Dossiers traités</CardTitle>
          <p className="text-muted-foreground text-xs">
            Un échange prend effet dès que vous le signalez. Un remboursement
            attend l&apos;accord du gérant, puis diminue ce que vous devez.
          </p>
        </CardHeader>
        <CardContent>
          {traites.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Aucun dossier traité pour le moment.
            </p>
          ) : (
            // Grille de cartes plutôt qu'une liste pleine largeur : sur un
            // grand écran, un libellé à un bout et sa valeur à l'autre serait
            // illisible (règle documentée dans docs/interface.md).
            <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {traites.map((d) => (
                <li key={d.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {date(d.date)}
                    </span>
                    <Badge variant={VARIANTE_BADGE[d.statut] ?? "outline"}>
                      {LIBELLES_STATUT_SAV[d.statut] ?? d.statut}
                    </Badge>
                  </div>

                  <p className="text-sm font-medium">
                    {d.produit} × {d.quantite}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {d.resolution === "echange"
                      ? "Échange — unité sortie de votre stock"
                      : `Remboursement de ${euros(d.montant_rembourse)}`}
                    {" · vente à "}
                    {d.client}
                  </p>
                  <p className="text-sm italic">« {d.motif} »</p>

                  {/* La réponse du gérant, en clair : c'est l'information que
                      le vendeur vient chercher ici. */}
                  {d.motif_refus && (
                    <p className="text-muted-foreground text-xs">
                      Réponse du gérant : {d.motif_refus}
                    </p>
                  )}
                  {d.traite_le && (
                    <p className="text-muted-foreground text-xs">
                      {LIBELLES_STATUT_SAV[d.statut] ?? d.statut} le{" "}
                      {dateHeure(d.traite_le)}
                      {d.traite_par && ` par ${d.traite_par}`}
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
