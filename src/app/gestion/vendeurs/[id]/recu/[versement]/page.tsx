import { notFound } from "next/navigation";

import { BoutonImprimer } from "@/components/bouton-imprimer";
import { EntetePage } from "@/components/entete-page";
import { Logo } from "@/components/logo";
import { Card, CardContent } from "@/components/ui/card";
import { exigerAdmin } from "@/lib/auth";
import { date, dateHeure, euros } from "@/lib/format";
import { creerClient } from "@/lib/supabase/server";
import type { Creance, Profil } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reçu de versement — StockFlow" };

/**
 * Reçu d'un versement, à imprimer ou à enregistrer en PDF pour le remettre au
 * vendeur.
 *
 * Un versement se fait souvent en espèces, de la main à la main : sans trace
 * écrite, le seul témoin est la ligne saisie par le gérant. Le reçu donne au
 * vendeur de quoi vérifier que SON versement a bien été enregistré, pour le
 * bon montant.
 *
 * DEUX BLOCS, et la distinction est écrite sur le reçu :
 *   • le versement lui-même : un fait daté, qui ne changera plus ;
 *   • la situation du compte : un solde AU MOMENT DE L'IMPRESSION. Réimprimé
 *     un mois plus tard, le même reçu affichera un autre reste à verser.
 *     Le présenter comme « le solde après ce versement » serait faux dès
 *     qu'une vente ou un autre versement est passé depuis.
 *
 * Aucun calcul ici : les montants viennent de `creances()`, la même source
 * que la fiche du vendeur.
 */
export default async function PageRecu({
  params,
}: {
  params: Promise<{ id: string; versement: string }>;
}) {
  const gerant = await exigerAdmin();
  const { id, versement: versementId } = await params;
  const supabase = await creerClient();

  const [rProfil, rVersement, rCreances] = await Promise.all([
    supabase.from("profils").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("versements")
      .select("id, date, montant, note")
      .eq("id", versementId)
      // Le vendeur de l'URL doit être celui du versement : sans ce filtre, un
      // lien bricolé afficherait le versement de l'un sous le nom de l'autre.
      .eq("vendeur_id", id)
      .maybeSingle(),
    supabase.rpc("creances"),
  ]);

  const profil = rProfil.data as Profil | null;
  const versement = rVersement.data as {
    id: string;
    date: string;
    montant: number;
    note: string | null;
  } | null;
  if (!profil || !versement) notFound();

  const creance =
    (rCreances.data as Creance[] | null)?.find((c) => c.vendeur_id === id) ??
    null;
  const maintenant = new Date().toISOString();

  return (
    <div className="w-full space-y-6">
      <div className="print:hidden">
        <EntetePage
          titre="Reçu de versement"
          retour={{ href: `/gestion/vendeurs/${id}`, libelle: profil.nom }}
        >
          <BoutonImprimer />
        </EntetePage>
      </div>

      {/* Largeur d'une feuille : c'est un document à imprimer, pas un écran de
          données. Seule exception à la règle « pas de plafond de largeur ». */}
      <Card className="mx-auto max-w-2xl print:max-w-none print:shadow-none print:ring-0">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <header className="flex items-start justify-between gap-4 border-b pb-5">
            <div className="flex items-center gap-2.5 font-semibold">
              <Logo />
              StockFlow
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">Reçu de versement</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                n° {versement.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          </header>

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Reçu de</dt>
              <dd className="font-medium">{profil.nom}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Date du versement</dt>
              <dd className="font-medium">{date(versement.date)}</dd>
            </div>
            {versement.note && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground text-xs">Note</dt>
                <dd>{versement.note}</dd>
              </div>
            )}
          </dl>

          <div className="bg-muted/60 rounded-lg p-5 text-center">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              Montant reçu
            </p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">
              {euros(versement.montant)}
            </p>
          </div>

          {creance && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">
                Situation du compte au {dateHeure(maintenant)}
              </h2>
              <p className="text-muted-foreground text-xs">
                Solde au moment où ce reçu est imprimé, tous versements
                compris. Il évolue avec chaque vente et chaque versement.
              </p>
              <dl className="divide-y text-sm">
                {(
                  [
                    ["Ventes encaissées", creance.ca, ""],
                    ["Commission du vendeur", creance.commissions, "− "],
                    ["Déjà reversé", creance.verse, "− "],
                    ["Remboursé aux clients (SAV)", creance.rembourse, "− "],
                    ["Pris pour lui", creance.preleve, "+ "],
                  ] as const
                )
                  // Les deux dernières lignes n'apparaissent que si elles
                  // existent : une ligne à 0 € ferait chercher une explication.
                  .filter(([, montant], i) => i < 3 || Number(montant) > 0)
                  .map(([libelle, montant, signe]) => (
                    <div key={libelle} className="flex justify-between gap-3 py-2">
                      <dt className="text-muted-foreground">{libelle}</dt>
                      <dd className="tabular-nums">
                        {signe}
                        {euros(montant)}
                      </dd>
                    </div>
                  ))}
                <div className="flex justify-between gap-3 py-2.5 font-semibold">
                  <dt>Reste à verser</dt>
                  <dd className="tabular-nums">{euros(creance.reste_a_verser)}</dd>
                </div>
              </dl>
            </section>
          )}

          <footer className="text-muted-foreground grid gap-8 border-t pt-5 text-xs sm:grid-cols-2">
            <div>
              <p>Enregistré par {gerant.nom}</p>
              <p className="mt-10 border-t pt-1">Signature du gérant</p>
            </div>
            <div>
              <p>Remis à {profil.nom}</p>
              <p className="mt-10 border-t pt-1">Signature du vendeur</p>
            </div>
          </footer>
        </CardContent>
      </Card>
    </div>
  );
}
