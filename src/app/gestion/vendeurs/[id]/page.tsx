import Link from "next/link";
import { notFound } from "next/navigation";

import { Kpi } from "@/components/kpi";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { date, euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type {
  Creance,
  Profil,
  StockDetenteur,
  VenteVendeur,
} from "@/lib/types";

import { BarreActions, ListeVersements } from "./formulaire";

export const dynamic = "force-dynamic";

type Versement = {
  id: string;
  date: string;
  montant: number;
  note: string | null;
};

const COLONNES_VENTES: Colonne<VenteVendeur>[] = [
  {
    cle: "date",
    entete: "Date",
    principale: true,
    valeur: (l) => (
      <span className="flex items-center gap-2">
        {date(l.date)}
        {/* La vente n'est jamais réécrite par un SAV : c'est ce badge, et lui
            seul, qui répond à « cette vente a-t-elle posé problème ? ». */}
        {l.sav_unites > 0 && (
          <Badge variant={l.sav_en_attente > 0 ? "outline" : "secondary"}>
            SAV {l.sav_unites} u{l.sav_en_attente > 0 && " · en attente"}
          </Badge>
        )}
      </span>
    ),
  },
  { cle: "client", entete: "Client", valeur: (l) => l.client },
  {
    cle: "qte",
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.quantite_totale,
  },
  {
    cle: "montant",
    entete: "Montant",
    alignement: "droite",
    valeur: (l) => euros(l.montant_total),
  },
  {
    cle: "rembourse",
    entete: "Remboursé",
    alignement: "droite",
    valeur: (l) =>
      Number(l.sav_rembourse) > 0 ? `− ${euros(l.sav_rembourse)}` : "—",
  },
];

const COLONNES_STOCK: Colonne<StockDetenteur>[] = [
  {
    cle: "produit",
    entete: "Produit",
    principale: true,
    valeur: (l) => l.produit,
  },
  {
    cle: "qte",
    entete: "Quantité détenue",
    alignement: "droite",
    valeur: (l) => l.quantite,
  },
  {
    cle: "valeur",
    entete: "Valeur",
    alignement: "droite",
    valeur: (l) => euros(l.valeur),
  },
];

export default async function PageFicheVendeur({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerAdmin();
  const { id } = await params;
  const supabase = await creerClient();

  const [rProfil, rCreances, rStock, rVentes, rVersements] = await Promise.all([
    supabase.from("profils").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("creances"),
    supabase.rpc("stock_detenteurs", { p_vendeur_id: id }),
    // RPC plutôt que la table : elle agrège le SAV de chaque vente, qu'un
    // simple select sur `ventes` ne porte pas.
    supabase.rpc("ventes_vendeur", { p_vendeur_id: id, p_limite: 50 }),
    supabase
      .from("versements")
      .select("id, date, montant, note")
      .eq("vendeur_id", id)
      .order("date", { ascending: false })
      .limit(50),
  ]);

  const profil = rProfil.data as Profil | null;
  if (!profil) notFound();

  const creance =
    (rCreances.data as Creance[] | null)?.find((c) => c.vendeur_id === id) ??
    null;
  const stock = (rStock.data as StockDetenteur[] | null) ?? [];
  const ventes = (rVentes.data as VenteVendeur[] | null) ?? [];
  const versements = (rVersements.data as Versement[] | null) ?? [];
  const erreur = rCreances.error ?? rStock.error ?? rVentes.error;

  const unitesDetenues = stock.reduce((s, l) => s + l.quantite, 0);

  return (
    <div className="w-full space-y-6">
      {/* En-tête et barre d'actions. Les gestes ponctuels (encaisser, reprendre
          du stock, régler le compte) vivent dans des dialogues : la page ne
          présente que de l'information. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-muted-foreground text-xs">
            <Link href="/gestion/vendeurs" className="hover:underline">
              Vendeurs
            </Link>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {profil.nom}
            {!profil.actif && <Badge variant="outline">inactif</Badge>}
            {profil.doit_changer_mdp && (
              <Badge variant="secondary">mot de passe provisoire</Badge>
            )}
          </h1>
        </div>

        <BarreActions
          profil={profil}
          resteAVerser={Number(creance?.reste_a_verser ?? 0)}
          stock={stock.map((s) => ({
            produit_id: s.produit_id,
            produit: s.produit,
            quantite: s.quantite,
          }))}
        />
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          libelle="Reste à verser"
          valeur={euros(creance?.reste_a_verser ?? 0)}
          precision="encaissé − sa commission − déjà reversé"
          accent
        />
        <Kpi
          libelle="Encaissé"
          valeur={euros(creance?.ca ?? 0)}
          precision={`${creance?.nb_ventes ?? 0} vente(s)`}
        />
        <Kpi
          libelle="Sa commission"
          valeur={euros(creance?.commissions ?? 0)}
          precision={`${euros(profil.commission_unitaire)} par unité aujourd'hui`}
        />
        <Kpi
          libelle="Stock détenu"
          valeur={`${unitesDetenues} u`}
          precision="pas encore vendu"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3 xl:items-start">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Stock détenu</CardTitle>
          </CardHeader>
          <CardContent>
            <Tableau
              colonnes={COLONNES_STOCK}
              lignes={stock}
              cle={(l) => l.produit_id}
              vide="Ce vendeur ne détient aucun stock."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Versements reçus</CardTitle>
          </CardHeader>
          <CardContent>
            <ListeVersements versements={versements} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Ses ventes</CardTitle>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES_VENTES}
            lignes={ventes}
            cle={(l) => l.id}
            vide="Aucune vente enregistrée."
          />
        </CardContent>
      </Card>
    </div>
  );
}
