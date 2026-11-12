import { exigerAdmin } from "@/lib/auth";
import { aujourdHui } from "@/lib/format";
import { argsPeriode, lirePeriode } from "@/lib/periode";
import { reponseCsv } from "@/lib/reponse-csv";
import { creerClient } from "@/lib/supabase/server";
import type { VenteProduit } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Export CSV des ventes par produit, sur la période du Bilan.
 *
 * La garde est rappelée ICI : un Route Handler n'hérite pas du layout de
 * `/gestion`, et la marge par produit n'est pas une information vendeur. La
 * fonction SQL la refuse de toute façon ; ceci évite d'en arriver là.
 */
export async function GET(requete: Request) {
  await exigerAdmin();

  const params = Object.fromEntries(new URL(requete.url).searchParams);
  const supabase = await creerClient();
  const { data, error } = await supabase.rpc(
    "ventes_par_produit",
    argsPeriode(lirePeriode(params)),
  );
  if (error) return new Response(error.message, { status: 500 });

  const produits = (data as VenteProduit[] | null) ?? [];

  return reponseCsv(
    `ventes-par-produit-${aujourdHui()}`,
    ["Modèle", "Parfum", "Unités vendues", "Chiffre d'affaires", "Marge nette"],
    produits.map((p) => [
      p.modele,
      p.produit,
      p.unites,
      Number(p.ca),
      Number(p.marge),
    ]),
  );
}
