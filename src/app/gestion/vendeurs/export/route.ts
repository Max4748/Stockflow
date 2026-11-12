import { exigerAdmin } from "@/lib/auth";
import { aujourdHui } from "@/lib/format";
import { reponseCsv } from "@/lib/reponse-csv";
import { creerClient } from "@/lib/supabase/server";
import type { Creance } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Export CSV des créances : ce que chaque vendeur a encaissé, gardé en
 * commission, déjà reversé, et ce qu'il doit encore.
 *
 * Toujours la liste COMPLÈTE, sans tenir compte de la recherche de l'écran :
 * une créance est un solde à transmettre au comptable, pas une vue filtrée.
 * La garde est rappelée, voir l'export du journal.
 */
export async function GET() {
  await exigerAdmin();

  const supabase = await creerClient();
  const { data, error } = await supabase.rpc("creances");
  if (error) return new Response(error.message, { status: 500 });

  const creances = (data as Creance[] | null) ?? [];
  const nombre = (v: number | string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);

  return reponseCsv(
    `creances-${aujourdHui()}`,
    [
      "Vendeur",
      "Rôle",
      "Actif",
      "Ventes",
      "Encaissé",
      "Commission",
      "Déjà reversé",
      "Remboursé (SAV)",
      "Prélevé",
      "Reste à verser",
    ],
    creances.map((c) => [
      c.nom,
      c.role,
      c.actif ? "oui" : "non",
      c.nb_ventes,
      nombre(c.ca),
      nombre(c.commissions),
      nombre(c.verse),
      nombre(c.rembourse),
      nombre(c.preleve),
      nombre(c.reste_a_verser),
    ]),
  );
}
