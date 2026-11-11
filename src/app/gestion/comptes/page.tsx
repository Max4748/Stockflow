import { EtatVide } from "@/components/etat-vide";
import { EntetePage } from "@/components/entete-page";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerDev } from "@/lib/auth";
import { date } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { Creance } from "@/lib/types";

import {
  BoutonStockLie,
  FormulaireCreationGerant,
  LigneRole,
} from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comptes gérants — StockFlow" };

type CompteEncadrement = {
  id: string;
  nom: string;
  role: string;
  libelle: string;
  niveau: number;
  actif: boolean;
  mdp_provisoire: boolean;
  stock_lie_entrepot: boolean;
  cree_le: string;
};

export default async function PageComptes() {
  const moi = await exigerDev();
  const supabase = await creerClient();

  const [rComptes, rVendeurs] = await Promise.all([
    // Fermée aux gérants par sa propre garde SQL : ils n'ont pas à voir la
    // liste des comptes de niveau supérieur ou égal au leur.
    supabase.rpc("comptes_encadrement"),
    supabase.rpc("creances"),
  ]);

  const comptes = (rComptes.data as CompteEncadrement[] | null) ?? [];
  const vendeurs = (rVendeurs.data as Creance[] | null) ?? [];
  const erreur = rComptes.error ?? rVendeurs.error;

  const colonnes: Colonne<CompteEncadrement>[] = [
    {
      cle: "nom",
      entete: "Compte",
      principale: true,
      valeur: (c) => (
        <span className="flex flex-wrap items-center gap-2">
          {c.nom}
          {c.id === moi.id && <Badge variant="outline">vous</Badge>}
          {!c.actif && <Badge variant="destructive">désactivé</Badge>}
          {c.mdp_provisoire && (
            <Badge variant="alerte">mot de passe provisoire</Badge>
          )}
          {c.stock_lie_entrepot && (
            <Badge variant="info">vend depuis l&apos;entrepôt</Badge>
          )}
        </span>
      ),
    },
    {
      cle: "role",
      entete: "Niveau",
      valeur: (c) => (
        <Badge variant={c.role === "dev" ? "default" : "info"}>
          {c.libelle}
        </Badge>
      ),
    },
    { cle: "cree", entete: "Créé le", valeur: (c) => date(c.cree_le) },
  ];

  const colonnesVendeurs: Colonne<Creance>[] = [
    { cle: "nom", entete: "Vendeur", principale: true, valeur: (v) => v.nom },
    {
      cle: "etat",
      entete: "État",
      valeur: (v) =>
        v.actif ? "actif" : <Badge variant="outline">inactif</Badge>,
    },
    {
      cle: "nb",
      entete: "Ventes",
      alignement: "droite",
      valeur: (v) => v.nb_ventes,
    },
  ];

  return (
    <div className="w-full space-y-6">
      <EntetePage
        titre="Comptes gérants"
        description="Réservé au propriétaire technique. Un gérant ne voit pas cet écran et ne peut pas créer de compte à son propre niveau."
      >
        <FormulaireCreationGerant />
      </EntetePage>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Comptes d&apos;encadrement ({comptes.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Le réglage « entrepôt » est ici et non dans la carte de
              rétrogradation : il concerne TOUT l'encadrement, dev compris,
              et c'est même le dev qui héberge l'entrepôt le plus souvent. */}
          <Tableau
            colonnes={colonnes}
            lignes={comptes}
            cle={(c) => c.id}
            vide="Aucun compte d'encadrement."
            action={(c) => (
              <BoutonStockLie
                compteId={c.id}
                nom={c.nom}
                lie={c.stock_lie_entrepot}
              />
            )}
          />
          <Alert>
            <AlertDescription className="text-xs">
              Un second compte <code>dev</code> ne peut pas être créé depuis
              l&apos;application : la règle « on ne gère qu&apos;un niveau
              strictement inférieur au sien » est ce qui rend l&apos;escalade de
              privilèges impossible par construction. Il se crée en SQL, par un
              geste conscient.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Promouvoir un vendeur en gérant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={colonnesVendeurs}
            lignes={vendeurs}
            cle={(v) => v.vendeur_id}
            vide="Aucun vendeur enregistré."
            action={(v) => <LigneRole compteId={v.vendeur_id} nom={v.nom} />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Rétrograder un gérant</CardTitle>
        </CardHeader>
        <CardContent>
          {comptes.filter((c) => c.role === "gerant").length === 0 ? (
            <EtatVide titre="Aucun gérant à rétrograder." />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {comptes
                .filter((c) => c.role === "gerant")
                .map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <span className="truncate text-sm font-medium">
                      {c.nom}
                    </span>
                    <LigneRole compteId={c.id} nom={c.nom} versVendeur />
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
