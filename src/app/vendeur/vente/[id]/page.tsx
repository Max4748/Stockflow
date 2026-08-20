import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { exigerProfil } from "@/lib/auth";
import { dateHeure, euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { LigneStock, MaVente, Produit } from "@/lib/types";

import { FormulaireCorrection } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Corriger une vente — StockFlow" };

type LigneExistante = {
  produit_id: string;
  produit: string;
  quantite: number;
  prix_vente_unitaire: number;
};

export default async function PageCorrection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerProfil();
  const { id } = await params;
  const supabase = await creerClient();

  const [rVentes, rLignes, rStock, rProduits] = await Promise.all([
    supabase.rpc("mes_ventes", { p_limite: 100 }),
    // v_lignes_vente filtre sur auth.uid() dans sa définition et n'expose
    // AUCUN coût : c'est le seul accès du vendeur au détail de ses ventes.
    supabase
      .from("v_lignes_vente")
      // La vue porte déjà le nom du produit : pas d'embed PostgREST, qui
      // suppose une relation détectable — ce qu'une vue n'a pas.
      .select("produit_id, produit, quantite, prix_vente_unitaire")
      .eq("vente_id", id),
    supabase.rpc("stock_disponible"),
    supabase.from("produits").select("id, nom, prix_vente_conseille"),
  ]);

  const ventes = (rVentes.data as MaVente[] | null) ?? [];
  const vente = ventes.find((v) => v.id === id);
  // Absente de mes_ventes = pas la sienne, ou inexistante. Dans les deux cas
  // le vendeur n'a rien à voir ici.
  if (!vente) notFound();

  const lignes = (rLignes.data as LigneExistante[] | null) ?? [];
  const stock = (rStock.data as LigneStock[] | null) ?? [];
  const produits =
    (rProduits.data as
      Pick<Produit, "id" | "nom" | "prix_vente_conseille">[] | null) ?? [];

  const prixConseille = new Map(
    produits.map((p) => [p.id, Number(p.prix_vente_conseille)]),
  );

  // Stock disponible POUR CETTE CORRECTION : ce que le vendeur détient
  // aujourd'hui, plus ce que la vente en cours lui a retiré — puisque la
  // corriger restitue d'abord l'ancienne version. Sans cet ajout, il ne
  // pourrait même pas remettre la quantité qu'il avait déjà saisie.
  const dejaSorti = new Map<string, number>();
  for (const l of lignes) {
    dejaSorti.set(
      l.produit_id,
      (dejaSorti.get(l.produit_id) ?? 0) + l.quantite,
    );
  }

  const vendables = produits
    .map((p) => {
      const detenu = stock.find((s) => s.produit_id === p.id)?.quantite ?? 0;
      return {
        produit_id: p.id,
        produit: p.nom,
        quantite: detenu + (dejaSorti.get(p.id) ?? 0),
        prix_conseille: prixConseille.get(p.id) ?? 0,
      };
    })
    .filter((p) => p.quantite > 0);

  return (
    <div className="w-full space-y-4">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/vendeur/vente" className="hover:underline">
            Vendre
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Corriger une vente</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Saisie du {dateHeure(vente.cree_le)} · {euros(vente.montant_total)}
        </p>
      </div>

      {!vente.corrigeable ? (
        <Alert>
          <AlertDescription className="space-y-3">
            <p>
              Cette vente a plus de 48 heures : elle n&apos;est plus modifiable
              par vos soins. Demander au gérant, qui peut la corriger sans
              limite de temps.
            </p>
            <Link
              href="/vendeur/vente"
              className={cn(buttonVariants({ variant: "outline" }), "h-10")}
            >
              Retour
            </Link>
          </AlertDescription>
        </Alert>
      ) : vendables.length === 0 ? (
        <Alert>
          <AlertDescription>
            Aucun stock disponible pour corriger cette vente.
          </AlertDescription>
        </Alert>
      ) : (
        <FormulaireCorrection
          venteId={vente.id}
          client={vente.client}
          date={vente.date}
          produits={vendables}
          lignesInitiales={lignes.map((l) => ({
            produit_id: l.produit_id,
            quantite: l.quantite,
            prix_vente_unitaire: Number(l.prix_vente_unitaire),
            produit: l.produit,
          }))}
        />
      )}
    </div>
  );
}
