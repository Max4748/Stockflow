import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerProfil } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { dateHeure, euros, niveauStock, quantite } from "@/lib/format";
import { estEncadrement } from "@/lib/types";
import type {
  LigneJournalVendeur,
  LigneStock,
  LigneStockEntrepot,
  MaDette,
  Produit,
} from "@/lib/types";

import { FormulaireRestock } from "./restock/formulaire";
import { FormulaireVente } from "./vente/formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mon espace — StockFlow" };

export default async function PageVendeur() {
  const profil = await exigerProfil();
  const supabase = await creerClient();

  // Lectures indépendantes, lancées en parallèle. Les deux dernières servent
  // aux dialogues montés sur cette page : depuis que les formulaires sont des
  // dialogues, le geste part d'ici plutôt que d'un aller-retour vers un écran
  // qui reposerait le même bouton.
  const [rDette, rStock, rJournal, rProduits, rEntrepot, rDemandes] =
    await Promise.all([
      supabase.rpc("ma_dette"),
      supabase.rpc("stock_disponible"),
      supabase.rpc("mon_journal", { p_limite: 15 }),
      supabase.from("produits").select("id, prix_vente_conseille"),
      supabase.rpc("stock_entrepot"),
      // Une seule demande de réassort peut être en attente à la fois.
      supabase
        .from("demandes_restock")
        .select("id", { count: "exact", head: true })
        .eq("statut", "en_attente"),
    ]);

  // Les RPC exigent un cast : PostgREST ne peut pas typer un retour dynamique.
  const dette = (rDette.data as MaDette[] | null)?.[0] ?? null;
  const stock = (rStock.data as LigneStock[] | null) ?? [];
  const journal = (rJournal.data as LigneJournalVendeur[] | null) ?? [];
  const entrepot = (rEntrepot.data as LigneStockEntrepot[] | null) ?? [];
  const produits =
    (rProduits.data as Pick<Produit, "id" | "prix_vente_conseille">[] | null) ??
    [];
  const demandeEnAttente = (rDemandes.count ?? 0) > 0;

  const erreur = rDette.error ?? rStock.error ?? rJournal.error;
  const alertes = stock.filter(
    (l) => niveauStock(l.quantite, l.seuil_alerte) !== "ok",
  );

  // Ce que le vendeur détient réellement, prix conseillé à l'appui. Le contrôle
  // qui compte reste celui du SQL : proposer un produit épuisé ne mènerait
  // qu'à un refus.
  const prixConseille = new Map(
    produits.map((p) => [p.id, Number(p.prix_vente_conseille)]),
  );
  const vendables = stock
    .filter((l) => l.quantite > 0)
    .map((l) => ({
      produit_id: l.produit_id,
      produit: l.produit,
      quantite: l.quantite,
      prix_conseille: prixConseille.get(l.produit_id) ?? 0,
    }));

  // Un gérant vend comme les autres, mais encaisse pour la maison : sa dette
  // vaut zéro par construction (v_comptes_vendeurs, migration 0007). Lui
  // afficher « ce que je dois » en grand et en permanence serait un contresens.
  const encadrement = estEncadrement(profil.role);

  return (
    <div className="space-y-6">
      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      {/* Bandeau de chiffres clés. Le nombre de colonnes augmente avec la
          largeur, au lieu d'étirer trois cartes sur tout l'écran :
            mobile  → empilées
            md (2)  → la dette occupe la ligne, les 2 indicateurs en dessous
            lg (4)  → la dette prend la moitié, chaque indicateur un quart */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        {/* La dette est l'information que le vendeur vient chercher : elle
            passe en premier, en grand, et occupe le plus de place. Pour un
            gérant, c'est l'encaissé qui prend cette place — sa dette est nulle
            par construction. */}
        {/* La carte de commission est masquée pour l'encadrement : sans ce
            rattrapage, la bande laissait une colonne vide sur six. */}
        <Card
          className={cn(
            "sm:col-span-2",
            encadrement ? "2xl:col-span-5" : "2xl:col-span-4",
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {encadrement
                ? "Ce que j'ai encaissé"
                : "Ce que je dois à l'administrateur"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-4xl font-semibold tabular-nums">
              {euros((encadrement ? dette?.ca : dette?.reste_a_verser) ?? 0)}
            </p>
            {encadrement ? (
              <p className="text-muted-foreground text-xs">
                Aucune créance : vous encaissez pour la maison. Ces ventes sont
                comptées dans le bilan de gestion.
              </p>
            ) : (
              <dl
                className={cn(
                  "text-muted-foreground grid gap-2 text-xs",
                  Number(dette?.rembourse ?? 0) > 0
                    ? "grid-cols-2 sm:grid-cols-4"
                    : "grid-cols-3",
                )}
              >
                <div>
                  <dt>Ventes encaissées</dt>
                  <dd className="text-foreground font-medium tabular-nums">
                    {euros(dette?.ca ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Ma commission</dt>
                  <dd className="text-foreground font-medium tabular-nums">
                    − {euros(dette?.commissions ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Déjà reversé</dt>
                  <dd className="text-foreground font-medium tabular-nums">
                    − {euros(dette?.verse ?? 0)}
                  </dd>
                </div>
                {/* Affiché seulement quand il y en a : sinon une ligne à 0 €
                    ferait chercher une explication à un cas qui n'existe pas.
                    Sans elle, en revanche, une dette qui baisse sans versement
                    serait incompréhensible. */}
                {Number(dette?.rembourse ?? 0) > 0 && (
                  <div>
                    <dt>Remboursé (SAV)</dt>
                    <dd className="text-foreground font-medium tabular-nums">
                      − {euros(dette?.rembourse ?? 0)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Mes ventes
            </p>
            <p className="mt-2 text-2xl leading-none font-semibold tabular-nums">
              {dette?.nb_ventes ?? 0}
            </p>
            <p className="text-muted-foreground mt-2 text-xs leading-snug">
              {quantite(dette?.qte_vendue ?? 0)} écoulées
            </p>
          </CardContent>
        </Card>
        {/* Un gérant n'a pas de commission : la maison lui appartient. Une
            carte à 0 € en permanence n'apprendrait rien. */}
        {!encadrement && (
          <Card>
            <CardContent>
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Ma commission
              </p>
              <p className="mt-2 text-2xl leading-none font-semibold tabular-nums">
                {euros(dette?.commissions ?? 0)}
              </p>
              <p className="text-muted-foreground mt-2 text-xs leading-snug">
                {euros(profil.commission_unitaire)} par unité
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Le dialogue s'ouvre ICI. Auparavant ce bouton menait à /vendeur/vente,
          où un second bouton du même libellé ouvrait le formulaire : deux clics
          sur le même mot. Depuis que la saisie est un dialogue, elle n'a plus
          besoin de sa page pour s'ouvrir. */}
      {vendables.length > 0 && <FormulaireVente produits={vendables} />}

      {/* Les alertes sont une courte liste, le journal en est une longue :
          1/3 – 2/3 plutôt que 50/50, qui laisserait la colonne de gauche
          presque vide. */}
      <div className="grid gap-6 lg:grid-cols-3 2xl:grid-cols-4 lg:items-start">
        {alertes.length > 0 && (
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Stock à surveiller</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alertes.map((l) => (
                <div
                  key={l.produit_id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">{l.produit}</span>
                  <Badge
                    variant={
                      niveauStock(l.quantite, l.seuil_alerte) === "rupture"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {l.quantite <= 0 ? "épuisé" : `${l.quantite} restant(s)`}
                  </Badge>
                </div>
              ))}
              {/* Même raisonnement que pour la vente : le geste s'ouvre depuis
                  la carte qui le motive. Quand une demande est déjà en attente,
                  il n'y a rien à ouvrir (une seule à la fois) — on renvoie donc
                  vers l'écran qui montre où elle en est. */}
              <div className="pt-2">
                {demandeEnAttente ? (
                  <Link
                    href="/vendeur/restock"
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-10 w-full",
                    )}
                  >
                    Demande en cours
                  </Link>
                ) : (
                  // Pleine largeur : la carte est une colonne étroite, le
                  // `sm:w-auto` par défaut y rétrécirait le bouton.
                  <FormulaireRestock
                    produits={entrepot}
                    classeBouton="w-full"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card
          className={
            alertes.length > 0
              ? "lg:col-span-2 2xl:col-span-3"
              : "lg:col-span-3 2xl:col-span-4"
          }
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Dernières opérations</CardTitle>
          </CardHeader>
          <CardContent>
            {journal.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                Aucune opération pour le moment.
              </p>
            ) : (
              <ul className="divide-y">
                {journal.map((l, i) => (
                  <li
                    key={`${l.horodatage}-${i}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate">{l.libelle}</p>
                      <p className="text-muted-foreground text-xs">
                        {dateHeure(l.horodatage)}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {l.montant !== null
                        ? euros(l.montant)
                        : quantite(l.quantite)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
