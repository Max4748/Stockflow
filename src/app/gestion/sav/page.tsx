import { FormulaireSav } from "@/components/formulaire-sav";
import { Kpi } from "@/components/kpi";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { date, euros, LIBELLES_STATUT_SAV, quantite } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import { borneVue, type DossierSav, type VenteSavable } from "@/lib/types";

import {
  BoutonRevoquer,
  BoutonSupprimer,
  CarteArbitrage,
  MarquerSavGestionVu,
} from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "SAV — StockFlow" };

const VARIANTE: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  valide: "default",
  en_attente: "secondary",
  refuse: "destructive",
  annule: "outline",
};

const COLONNES: Colonne<DossierSav>[] = [
  {
    cle: "date",
    entete: "Date",
    principale: true,
    valeur: (l) => (
      <span className="flex items-center gap-2">
        {date(l.date)}
        <Badge variant={VARIANTE[l.statut] ?? "outline"}>
          {LIBELLES_STATUT_SAV[l.statut] ?? l.statut}
        </Badge>
      </span>
    ),
  },
  { cle: "produit", entete: "Produit", valeur: (l) => l.produit },
  {
    cle: "qte",
    entete: "Unités",
    alignement: "droite",
    valeur: (l) => l.quantite,
  },
  {
    cle: "resolution",
    entete: "Dénouement",
    valeur: (l) => (l.resolution === "echange" ? "Échange" : "Remboursement"),
  },
  {
    cle: "montant",
    entete: "Remboursé",
    alignement: "droite",
    valeur: (l) =>
      Number(l.montant_rembourse) > 0 ? euros(l.montant_rembourse) : "—",
  },
  { cle: "vendeur", entete: "Vendeur", valeur: (l) => l.vendeur },
  {
    cle: "motif",
    entete: "Défaillance",
    valeur: (l) => (
      <span>
        {l.motif}
        {l.motif_refus && (
          <span className="text-muted-foreground block text-xs">
            Refus : {l.motif_refus}
          </span>
        )}
      </span>
    ),
  },
];

export default async function PageSav() {
  await exigerAdmin();
  const supabase = await creerClient();

  const [rDossiers, rSavables, rNonVus] = await Promise.all([
    supabase.rpc("dossiers_sav", { p_limite: 200 }),
    supabase.rpc("ventes_savables"),
    supabase.rpc("sav_gestion_non_vus"),
  ]);

  const dossiers = (rDossiers.data as DossierSav[] | null) ?? [];
  const nonVus = (rNonVus.data as number | null) ?? 0;
  const savables = (rSavables.data as VenteSavable[] | null) ?? [];
  const erreur = rDossiers.error ?? rSavables.error;

  const enAttente = dossiers.filter((d) => d.statut === "en_attente");
  const valides = dossiers.filter((d) => d.statut === "valide");
  const historique = dossiers.filter((d) => d.statut !== "en_attente");

  const unitesValidees = valides.reduce((s, d) => s + d.quantite, 0);
  const totalRembourse = valides.reduce(
    (s, d) => s + Number(d.montant_rembourse),
    0,
  );

  // Le produit qui casse le plus. C'est l'intérêt d'un type de mouvement dédié
  // plutôt que d'un ajustement motivé : la question devient répondable.
  const parProduit = new Map<string, number>();
  for (const d of valides) {
    parProduit.set(d.produit, (parProduit.get(d.produit) ?? 0) + d.quantite);
  }
  const pire = [...parProduit.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="w-full space-y-6">
      {/* Éteint la pastille de la barre de gestion — depuis un effet, jamais
          pendant le rendu. La borne est celle des dossiers effectivement
          affichés : voir le commentaire du composant. */}
      <MarquerSavGestionVu actif={nonVus > 0} borne={borneVue(dossiers)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Service après-vente</h1>
        {/* Seul bouton de l'en-tête : il doit dire ce qu'il fait. « SAV » ne
            se comprend que sur l'écran Stock, parmi trois autres. */}
        <FormulaireSav
          lignes={savables}
          contexte="gestion"
          libelle="Déclarer un SAV"
        />
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          libelle="À arbitrer"
          valeur={`${enAttente.length}`}
          precision="remboursements demandés par des vendeurs"
          accent={enAttente.length > 0}
        />
        <Kpi
          libelle="Dossiers validés"
          valeur={`${valides.length}`}
          precision={`${quantite(unitesValidees)} concernées`}
        />
        <Kpi
          libelle="Remboursé"
          valeur={euros(totalRembourse)}
          precision="retranché du chiffre d'affaires"
        />
        <Kpi
          libelle="Produit le plus touché"
          valeur={pire ? pire[0] : "—"}
          precision={pire ? `${quantite(pire[1])} en SAV` : "aucun SAV validé"}
        />
      </div>

      {enAttente.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Remboursements à arbitrer ({enAttente.length})
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Ces demandes n&apos;ont encore produit aucun effet : ni le chiffre
              d&apos;affaires ni la dette du vendeur n&apos;ont bougé.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {enAttente.map((d) => (
              <CarteArbitrage key={d.id} dossier={d} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Historique ({historique.length})
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Un échange déclaré par un vendeur est validé d&apos;emblée : il a
            déjà remis l&apos;unité au client. <strong>Révoquer</strong> rend
            l&apos;unité au stock en conservant le dossier et son motif —
            préférable à la suppression, qui efface ce qui rendrait un abus
            répété visible.
          </p>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES}
            lignes={historique}
            cle={(l) => l.id}
            vide="Aucun dossier de SAV."
            action={(l) =>
              l.statut === "valide" ? (
                <span className="flex gap-2">
                  <BoutonRevoquer dossier={l} />
                  <BoutonSupprimer dossier={l} />
                </span>
              ) : null
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
