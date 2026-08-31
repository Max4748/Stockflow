import { FiltrePeriode } from "@/components/filtre-periode";
import { Tableau, type Colonne } from "@/components/tableau";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exigerDev } from "@/lib/auth";
import { dateHeure } from "@/lib/format";
import { argsPeriode, lirePeriode } from "@/lib/periode";
import { creerClient } from "@/lib/supabase/server";

import { BoutonBloquerDefinitivement, BoutonLeverBlocage } from "./formulaire";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal d'administration — StockFlow" };

type LigneJournal = {
  cree_le: string;
  acteur: string;
  action: string;
  cible: string | null;
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
};

type IpBloquee = {
  ip: string;
  bloquee_le: string;
  jusqu_a: string | null;
  recidive: number;
  motif: string | null;
  definitif: boolean;
};

/**
 * Rend un `jsonb` de trace lisible sans le déplier sur trois lignes.
 * Les valeurs sont courtes par construction : un nom, un rôle, un booléen.
 */
function resume(v: Record<string, unknown> | null) {
  if (!v) return "—";
  return Object.entries(v)
    .map(([k, x]) => `${k} : ${x}`)
    .join(" · ");
}

const COLONNES: Colonne<LigneJournal>[] = [
  {
    cle: "quand",
    entete: "Quand",
    principale: true,
    valeur: (l) => dateHeure(l.cree_le),
  },
  { cle: "acteur", entete: "Par", valeur: (l) => l.acteur },
  {
    cle: "action",
    entete: "Action",
    valeur: (l) => <Badge variant="secondary">{l.action}</Badge>,
  },
  { cle: "cible", entete: "Sur", valeur: (l) => l.cible ?? "—" },
  {
    cle: "avant",
    entete: "Avant",
    valeur: (l) => (
      <span className="text-muted-foreground text-xs">{resume(l.avant)}</span>
    ),
  },
  {
    cle: "apres",
    entete: "Après",
    valeur: (l) => (
      <span className="text-xs">{resume(l.apres)}</span>
    ),
  },
];

export default async function PageJournalAdmin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerDev();
  const params = await searchParams;
  const periode = lirePeriode(params);

  const supabase = await creerClient();
  const [rJournal, rIp] = await Promise.all([
    supabase.rpc("journal_admin", { ...argsPeriode(periode), p_limite: 200 }),
    supabase.rpc("ip_bloquees_actives"),
  ]);

  const lignes = (rJournal.data as LigneJournal[] | null) ?? [];
  const ips = (rIp.data as IpBloquee[] | null) ?? [];
  const erreur = rJournal.error ?? rIp.error;

  const COLONNES_IP: Colonne<IpBloquee>[] = [
    {
      cle: "ip",
      entete: "Adresse",
      principale: true,
      valeur: (l) => (
        <span className="flex items-center gap-2 font-mono text-sm">
          {l.ip}
          {l.definitif && <Badge variant="destructive">sans échéance</Badge>}
          {l.recidive > 1 && (
            <Badge variant="outline">{l.recidive}ᵉ fois</Badge>
          )}
        </span>
      ),
    },
    { cle: "depuis", entete: "Depuis", valeur: (l) => dateHeure(l.bloquee_le) },
    {
      cle: "jusqu",
      entete: "Jusqu'à",
      valeur: (l) => (l.jusqu_a ? dateHeure(l.jusqu_a) : "—"),
    },
    {
      cle: "motif",
      entete: "Motif",
      valeur: (l) => (
        <span className="text-muted-foreground text-xs">{l.motif ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Journal d&apos;administration</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Qui a touché à quel compte, et ce qu&apos;il y avait avant. Réservé
            au propriétaire technique : la liste dit qui surveille qui.
          </p>
        </div>
        <FiltrePeriode actif={periode.cle} />
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur.message}</AlertDescription>
        </Alert>
      )}

      {/* Les IP d'abord : c'est l'état courant, donc ce qu'on vient vérifier
          quand un vendeur signale qu'il ne peut plus se connecter. Le journal
          en dessous est l'historique, qu'on consulte plus rarement. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Adresses IP bloquées ({ips.length})
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Le blocage se déclenche sur <strong>cinq adresses e-mail
            distinctes</strong> essayées depuis la même IP, jamais sur le nombre
            d&apos;échecs : un vendeur qui se trompe cinquante fois sur la
            sienne ne bloque pas son opérateur mobile. La durée croît à chaque
            récidive, de 15 minutes à 7 jours.
          </p>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES_IP}
            lignes={ips}
            cle={(l) => l.ip}
            vide="Aucune adresse bloquée."
            action={(l) => (
              <span className="flex shrink-0 gap-1">
                <BoutonLeverBlocage ip={l.ip} />
                {!l.definitif && <BoutonBloquerDefinitivement ip={l.ip} />}
              </span>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Actions sur les comptes ({lignes.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tableau
            colonnes={COLONNES}
            lignes={lignes}
            cle={(l) => `${l.cree_le}-${l.action}-${l.cible ?? ""}`}
            vide="Aucune action enregistrée sur cette période."
          />
        </CardContent>
      </Card>
    </div>
  );
}
