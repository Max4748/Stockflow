import { Alert, AlertDescription } from "@/components/ui/alert";
import { exigerProfil } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { date, dateHeure, euros } from "@/lib/format";
import { FormulaireSav } from "@/components/formulaire-sav";
import type { LigneStock, MaVente, Produit, VenteSavable } from "@/lib/types";

import { FormulaireVente } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mes ventes — StockFlow" };

export default async function PageVente() {
  await exigerProfil();
  const supabase = await creerClient();

  const [rStock, rProduits, rVentes, rSavables] = await Promise.all([
    supabase.rpc("stock_disponible"),
    // Pour le prix conseillé, qui pré-remplit le formulaire.
    supabase.from("produits").select("id, prix_vente_conseille"),
    // `corrigeable` est calculé en SQL, pas ici : la fenêtre de 48 h ne doit
    // pas dépendre de l'horloge du téléphone.
    supabase.rpc("mes_ventes", { p_limite: 12 }),
    // `p_les_miennes` : dans l'espace vendeur, un gérant ne signale un SAV que
    // sur SES ventes, comme n'importe quel vendeur (migration 0018). Le suivi
    // des dossiers, lui, a son écran : /vendeur/sav.
    supabase.rpc("ventes_savables", { p_les_miennes: true }),
  ]);

  const stock = (rStock.data as LigneStock[] | null) ?? [];
  const mesVentes = (rVentes.data as MaVente[] | null) ?? [];
  const savables = (rSavables.data as VenteSavable[] | null) ?? [];
  const produits =
    (rProduits.data as Pick<Produit, "id" | "prix_vente_conseille">[] | null) ??
    [];

  const prixConseille = new Map(
    produits.map((p) => [p.id, Number(p.prix_vente_conseille)]),
  );

  // On ne propose que ce que le vendeur détient réellement. Le contrôle qui
  // compte reste celui du SQL (verrou + vérification), mais proposer un
  // produit épuisé ne mènerait qu'à un refus.
  const vendables = stock
    .filter((l) => l.quantite > 0)
    .map((l) => ({
      produit_id: l.produit_id,
      produit: l.produit,
      quantite: l.quantite,
      prix_conseille: prixConseille.get(l.produit_id) ?? 0,
    }));

  return (
    // Pleine largeur. Les champs ne sont pas étirés pour autant : les cartes
    // de produit se répartissent en colonnes (voir FormulaireVente), ce qui
    // occupe l'espace sans allonger la distance entre un libellé et son champ.
    <div className="w-full space-y-4">
      {/* La saisie vit dans un dialogue : la page montre les ventes récentes,
          le bouton ouvre le geste. Sans stock, pas de bouton — un formulaire de
          vente qu'aucune ligne ne peut remplir ne rend service à personne. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Mes ventes</h1>
        {vendables.length > 0 && <FormulaireVente produits={vendables} />}
      </div>

      {rStock.error && (
        <Alert variant="destructive">
          <AlertDescription>{rStock.error.message}</AlertDescription>
        </Alert>
      )}

      {vendables.length === 0 && (
        <Alert>
          <AlertDescription>
            Aucun stock disponible. Faire une demande de réassort auprès de
            l&apos;administrateur avant de pouvoir vendre.
          </AlertDescription>
        </Alert>
      )}

      {/* État vide indispensable : sans lui, un compte qui n'a encore rien
          vendu voyait un titre, un bouton, et 600 px de vide — une page qui a
          l'air cassée. */}
      {mesVentes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium">Aucune vente enregistrée.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {vendables.length > 0
                ? "La première apparaîtra ici, modifiable pendant 48 h."
                : "Il faut d'abord recevoir du stock."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-sm">Mes ventes récentes</CardTitle>
              <p className="text-muted-foreground text-xs">
                Modifiables ou annulables pendant 48 h. Au-delà, la correction
                passe par le gérant.
              </p>
            </div>
            {/* Le SAV se signale d'ici : c'est l'écran où le vendeur a ses
                ventes sous les yeux quand le client le rappelle. */}
            <FormulaireSav lignes={savables} contexte="vendeur" />
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {mesVentes.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {v.client} · {euros(v.montant_total)}
                      {/* Le vendeur doit pouvoir relier un SAV à sa dette :
                          un remboursement l'a fait baisser sans versement. */}
                      {v.sav_unites > 0 && (
                        <Badge
                          variant={
                            v.sav_en_attente > 0 ? "outline" : "secondary"
                          }
                          className="shrink-0"
                        >
                          SAV {v.sav_unites} u
                          {v.sav_en_attente > 0 && " · en attente"}
                        </Badge>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {date(v.date)} · {v.quantite_totale} u · saisie{" "}
                      {dateHeure(v.cree_le)}
                      {Number(v.sav_rembourse) > 0 &&
                        ` · ${euros(v.sav_rembourse)} remboursés`}
                    </p>
                  </div>
                  {v.corrigeable ? (
                    <Link
                      href={`/vendeur/vente/${v.id}`}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "h-10 shrink-0",
                      )}
                    >
                      Corriger
                    </Link>
                  ) : (
                    <Badge variant="outline" className="shrink-0">
                      figée
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
