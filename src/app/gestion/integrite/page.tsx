import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerDev } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import type { Anomalie } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intégrité — StockFlow" };

const EXPLICATIONS: Record<string, string> = {
  stock_negatif:
    "Un détenteur possède une quantité négative. Structurellement impossible via l'application : indique une écriture directe en base ou un chemin d'écriture sans verrou.",
  transfert_desequilibre:
    "Les deux jambes d'un déplacement ne s'annulent pas. Du stock a été créé ou détruit lors d'un transfert.",
  entete_vente_incoherente:
    "Le total d'une vente ne correspond plus à la somme de ses lignes.",
};

export default async function PageIntegrite() {
  await exigerDev();
  const supabase = await creerClient();

  const { data, error } = await supabase.rpc("verifier_coherence_stock");
  const anomalies = (data as Anomalie[] | null) ?? [];

  // Regroupement par type : trente lignes du même symptôme, c'est un seul
  // problème, pas trente.
  const parType = anomalies.reduce<Record<string, string[]>>((acc, a) => {
    (acc[a.anomalie] ??= []).push(a.detail);
    return acc;
  }, {});

  return (
    <div className="w-full space-y-6">
      <h1 className="text-xl font-semibold">Intégrité des données</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pourquoi cet écran existe</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            Trois invariants ne peuvent pas être garantis par une contrainte
            SQL, parce qu&apos;ils portent sur des <strong>agrégats</strong> et
            non sur des lignes : un <code>CHECK</code> examine une ligne, pas
            une somme.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>un stock ne devient jamais négatif ;</li>
            <li>les deux jambes d&apos;un transfert s&apos;annulent ;</li>
            <li>l&apos;en-tête d&apos;une vente reflète ses lignes.</li>
          </ul>
          <p>
            Ils sont tenus par les fonctions d&apos;écriture, qui prennent un
            verrou avant de lire le stock. Ce contrôle vérifie qu&apos;ils le
            sont <strong>restés</strong> — à passer périodiquement.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : anomalies.length === 0 ? (
        <Alert>
          <AlertDescription className="flex items-center gap-2">
            <Badge>Conforme</Badge>
            Aucune anomalie : les trois invariants tiennent.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              {anomalies.length} anomalie(s) détectée(s). Ne pas « corriger » le
              stock à la main : identifier d&apos;abord le chemin
              d&apos;écriture fautif, sinon l&apos;écart reviendra.
            </AlertDescription>
          </Alert>

          {Object.entries(parType).map(([type, details]) => (
            <Card key={type}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">{type}</CardTitle>
                  <Badge variant="destructive">{details.length}</Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  {EXPLICATIONS[type] ?? "Anomalie non documentée."}
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {details.map((d, i) => (
                    <li key={i} className="font-mono text-xs">
                      {d}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
