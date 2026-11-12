import { SearchXIcon } from "lucide-react";

import { ChampRecherche } from "@/components/champ-recherche";
import { EtatVide } from "@/components/etat-vide";
import { EntetePage } from "@/components/entete-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { filtrer } from "@/lib/tri";
import { exigerAdmin } from "@/lib/auth";
import { euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { Modele, Produit } from "@/lib/types";

import {
  DialogueModele,
  DialogueNouveauModele,
  DialogueParfum,
} from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catalogue — StockFlow" };

export default async function PageProduits({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerAdmin();
  const params = await searchParams;
  const supabase = await creerClient();

  // Écriture directe en table : les policies `modeles_admin_all` et
  // `produits_admin_all` l'autorisent. Pas de RPC nécessaire, le catalogue ne
  // porte aucun invariant comptable.
  const [rModeles, rParfums] = await Promise.all([
    supabase.from("modeles").select("*").order("nom"),
    supabase.from("produits").select("*").order("nom"),
  ]);

  const modeles = (rModeles.data as Modele[] | null) ?? [];
  const parfums = (rParfums.data as Produit[] | null) ?? [];
  const erreur = rModeles.error ?? rParfums.error;

  // Recherche dans le catalogue. Un modèle reste affiché si SON nom
  // correspond (avec alors tous ses parfums) ou si l'un de ses parfums
  // correspond (avec alors ces seuls parfums) : chercher « vanille » montre
  // chaque modèle qui a un parfum vanille, sans les trente autres parfums.
  const q = params.q;
  const modelesTrouves = new Set(
    filtrer(modeles, q, (m) => [m.nom]).map((m) => m.id),
  );
  const parfumsTrouves = new Set(
    filtrer(parfums, q, (p) => [p.nom, p.sku]).map((p) => p.id),
  );

  const parModele = new Map<string, Produit[]>();
  for (const p of parfums) {
    if (!modelesTrouves.has(p.modele_id) && !parfumsTrouves.has(p.id)) continue;
    parModele.set(p.modele_id, [...(parModele.get(p.modele_id) ?? []), p]);
  }
  const modelesAffiches = modeles.filter(
    (m) => modelesTrouves.has(m.id) || parModele.has(m.id),
  );

  return (
    <div className="w-full space-y-6">
      <EntetePage titre="Catalogue">
        <DialogueNouveauModele />
      </EntetePage>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {modeles.length} modèle(s) · {parfums.length} parfum(s)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {modeles.length > 0 && (
            <ChampRecherche
              libelle="Rechercher un modèle ou un parfum"
              className="mb-4 sm:max-w-sm"
            />
          )}
          {modeles.length > 0 && modelesAffiches.length === 0 ? (
            <EtatVide
              icone={SearchXIcon}
              titre="Rien ne correspond à cette recherche."
            />
          ) : modeles.length === 0 ? (
            <EtatVide
              titre="Aucun modèle au catalogue"
              description="Créer un premier modèle avec le bouton « Nouveau modèle », puis lui ajouter ses parfums."
            />
          ) : (
            <ul className="space-y-3">
              {modelesAffiches.map((m) => {
                const siens = parModele.get(m.id) ?? [];
                return (
                  <li key={m.id} className="rounded-lg border">
                    {/* `details` natif : le dépliage n'a pas besoin d'état
                        client, et la page reste un composant serveur. */}
                    <details
                      // Déplié d'office pendant une recherche : le résultat
                      // cherché est DANS le modèle, pas dans son titre.
                      open={siens.length > 0 && (Boolean(q) || siens.length <= 6)}
                    >
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3">
                        <span className="font-medium">{m.nom}</span>
                        {!m.actif && <Badge variant="outline">inactif</Badge>}
                        <span className="text-muted-foreground text-xs">
                          {euros(m.prix_vente_conseille)} conseillé · seuil
                          parfum {m.seuil_parfum} · seuil modèle{" "}
                          {m.seuil_modele === 0 ? "désactivé" : m.seuil_modele}
                        </span>
                        <span className="text-muted-foreground ml-auto text-xs">
                          {siens.length} parfum(s)
                        </span>
                      </summary>

                      <div className="space-y-2 border-t p-3">
                        {siens.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            Aucun parfum. Ce modèle n&apos;apparaît nulle part
                            tant qu&apos;il n&apos;en a pas.
                          </p>
                        ) : (
                          <ul className="divide-border divide-y">
                            {siens.map((p) => (
                              <li
                                key={p.id}
                                className="flex items-center gap-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="flex items-center gap-2 truncate text-sm">
                                    {p.nom}
                                    {!p.actif && (
                                      <Badge variant="outline">inactif</Badge>
                                    )}
                                  </p>
                                  {p.sku && (
                                    <p className="text-muted-foreground text-xs">
                                      {p.sku}
                                    </p>
                                  )}
                                </div>
                                <DialogueParfum modele={m} parfum={p} />
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          <DialogueParfum modele={m} />
                          <DialogueModele modele={m} />
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
