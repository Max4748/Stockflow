import { BoxesIcon, CoinsIcon, HandCoinsIcon, ReceiptIcon } from "lucide-react";
import { notFound } from "next/navigation";

import { ChampRecherche } from "@/components/champ-recherche";
import { EntetePage } from "@/components/entete-page";
import { Kpi } from "@/components/kpi";
import { Pagination } from "@/components/pagination";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { lirePage, lireTri, motifIlike, triSql } from "@/lib/tri";
import { exigerAdmin } from "@/lib/auth";
import { date, euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";

import { ListePrelevements, TarifsPrelevement } from "./prelevements";
import type {
  Creance,
  LignePrelevement,
  Profil,
  StockDetenteur,
  TarifPreleve,
  VenteVendeur,
} from "@/lib/types";

import { BarreActions, ListeVersements } from "./formulaire";

export const dynamic = "force-dynamic";

// Les ventes et les versements sont PAGINÉS : un vendeur actif depuis un an
// en a des centaines, et l'ancienne coupe à 50 lignes rendait le reste
// invisible. Tri et recherche sont donc faits en base, sur tout l'historique.
const VENTES_PAR_PAGE = 20;
const VERSEMENTS_PAR_PAGE = 10;

type Versement = {
  id: string;
  date: string;
  montant: number;
  note: string | null;
};

const COLONNES_VENTES: Colonne<VenteVendeur>[] = [
  {
    cle: "date",
    colonneSql: "date",
    entete: "Date",
    principale: true,
    valeur: (l) => (
      <span className="flex items-center gap-2">
        <span className={l.annulee_le ? "line-through" : ""}>
          {date(l.date)}
        </span>
        {l.annulee_le && <Badge variant="destructive">annulée</Badge>}
        {/* La vente n'est jamais réécrite par un SAV : c'est ce badge, et lui
            seul, qui répond à « cette vente a-t-elle posé problème ? ». */}
        {l.sav_unites > 0 && (
          <Badge variant={l.sav_en_attente > 0 ? "alerte" : "info"}>
            SAV {l.sav_unites} u{l.sav_en_attente > 0 && " · en attente"}
          </Badge>
        )}
      </span>
    ),
  },
  { cle: "client", colonneSql: "client", entete: "Client", valeur: (l) => l.client },
  {
    cle: "qte",
    colonneSql: "quantite_totale",
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.quantite_totale,
  },
  {
    cle: "montant",
    colonneSql: "montant_total",
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
    tri: (l) => l.produit,
    entete: "Produit",
    principale: true,
    valeur: (l) => l.produit,
  },
  {
    cle: "qte",
    tri: (l) => l.quantite,
    entete: "Quantité détenue",
    alignement: "droite",
    valeur: (l) => l.quantite,
  },
  {
    cle: "valeur",
    tri: (l) => Number(l.valeur),
    entete: "Valeur",
    alignement: "droite",
    valeur: (l) => euros(l.valeur),
  },
];

export default async function PageFicheVendeur({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  const { id } = await params;
  const requete = await searchParams;
  const chemin = `/gestion/vendeurs/${id}`;
  const supabase = await creerClient();

  const pageVentes = lirePage(requete, VENTES_PAR_PAGE);
  const pageVersements = lirePage(requete, VERSEMENTS_PAR_PAGE, "v");
  // Sans tri choisi : les plus récentes d'abord, comme avant.
  const ordre = triSql(COLONNES_VENTES, lireTri(requete), {
    colonne: "cree_le",
    ascendant: false,
  });
  const motif = motifIlike(requete.q);

  // RPC plutôt que la table : elle agrège le SAV de chaque vente, qu'un
  // simple select sur `ventes` ne porte pas. `p_limite: null` lève son
  // plafond ; c'est PostgREST qui trie, cherche et découpe son résultat.
  let lectureVentes = supabase
    .rpc("ventes_vendeur", { p_vendeur_id: id, p_limite: null }, { count: "exact" })
    .order(ordre.colonne, { ascending: ordre.ascendant })
    // Départage stable : sans lui, deux ventes du même jour peuvent changer
    // de page d'un chargement à l'autre.
    .order("id")
    .range(pageVentes.de, pageVentes.a);
  if (motif) lectureVentes = lectureVentes.ilike("client", motif);

  const [rProfil, rCreances, rStock, rVentes, rPrelevements, rTarifs, rVersements] =
    await Promise.all([
    supabase.from("profils").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("creances"),
    supabase.rpc("stock_detenteurs", { p_vendeur_id: id }),
    lectureVentes,
    supabase.rpc("prelevements_vendeur", { p_vendeur_id: id, p_limite: 50 }),
    supabase.rpc("tarifs_preleves", { p_vendeur_id: id }),
    supabase
      .from("versements")
      .select("id, date, montant, note", { count: "exact" })
      .eq("vendeur_id", id)
      .order("date", { ascending: false })
      .order("id")
      .range(pageVersements.de, pageVersements.a),
  ]);

  const profil = rProfil.data as Profil | null;
  if (!profil) notFound();

  const creance =
    (rCreances.data as Creance[] | null)?.find((c) => c.vendeur_id === id) ??
    null;
  const stock = (rStock.data as StockDetenteur[] | null) ?? [];
  const ventes = (rVentes.data as VenteVendeur[] | null) ?? [];
  const versements = (rVersements.data as Versement[] | null) ?? [];
  const prelevements = (rPrelevements.data as LignePrelevement[] | null) ?? [];
  const tarifs = (rTarifs.data as TarifPreleve[] | null) ?? [];
  const erreur = rCreances.error ?? rStock.error ?? rVentes.error;

  const unitesDetenues = stock.reduce((s, l) => s + l.quantite, 0);

  return (
    <div className="w-full space-y-6">
      {/* En-tête et barre d'actions. Les gestes ponctuels (encaisser, reprendre
          du stock, régler le compte) vivent dans des dialogues : la page ne
          présente que de l'information. */}
      <EntetePage
        titre={profil.nom}
        retour={{ href: "/gestion/vendeurs", libelle: "Vendeurs" }}
        badge={
          <>
            {!profil.actif && <Badge variant="outline">inactif</Badge>}
            {profil.doit_changer_mdp && (
              <Badge variant="alerte">mot de passe provisoire</Badge>
            )}
          </>
        }
      >
        <BarreActions
          profil={profil}
          resteAVerser={Number(creance?.reste_a_verser ?? 0)}
          stock={stock.map((s) => ({
            produit_id: s.produit_id,
            produit: s.produit,
            quantite: s.quantite,
          }))}
        />
      </EntetePage>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          libelle="Reste à verser" icone={HandCoinsIcon}
          valeur={euros(creance?.reste_a_verser ?? 0)}
          precision="encaissé − sa commission − déjà reversé"
          accent
        />
        <Kpi
          libelle="Encaissé" icone={ReceiptIcon}
          valeur={euros(creance?.ca ?? 0)}
          precision={`${creance?.nb_ventes ?? 0} vente(s)`}
        />
        <Kpi
          libelle="Sa commission" icone={CoinsIcon}
          valeur={euros(creance?.commissions ?? 0)}
          precision={`${euros(profil.commission_unitaire)} par unité aujourd'hui`}
        />
        <Kpi
          libelle="Stock détenu" icone={BoxesIcon}
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
              tri={{ params: requete, chemin, prefixe: "s" }}
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
            <Pagination
              params={requete}
              chemin={chemin}
              prefixe="v"
              page={pageVersements.page}
              parPage={VERSEMENTS_PAR_PAGE}
              total={rVersements.count}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Ses ventes</CardTitle>
        </CardHeader>
        <CardContent>
          <ChampRecherche
            libelle="Rechercher un client"
            className="mb-4 sm:max-w-xs"
          />
          <Tableau
            colonnes={COLONNES_VENTES}
            lignes={ventes}
            cle={(l) => l.id}
            tri={{ params: requete, chemin, dejaTrie: true }}
            vide={
              requete.q
                ? "Aucune vente ne correspond à cette recherche."
                : "Aucune vente enregistrée."
            }
          />
          <Pagination
            params={requete}
            chemin={chemin}
            page={pageVentes.page}
            parPage={VENTES_PAR_PAGE}
            total={rVentes.count}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Ce qu&apos;il a pris pour lui</CardTitle>
          </CardHeader>
          <CardContent>
            <ListePrelevements prelevements={prelevements} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Tarifs de prélèvement</CardTitle>
          </CardHeader>
          <CardContent>
            <TarifsPrelevement vendeurId={id} tarifs={tarifs} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
