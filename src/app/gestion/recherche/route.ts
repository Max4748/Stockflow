import { exigerAdmin } from "@/lib/auth";
import { creerClient } from "@/lib/supabase/server";
import { motifIlike } from "@/lib/tri";

export const dynamic = "force-dynamic";

/**
 * Recherche globale de l'espace gestion (Ctrl+K) : les vendeurs et les
 * produits dont le nom contient le texte saisi.
 *
 * La garde est rappelée ICI : un Route Handler n'hérite pas du layout de
 * `/gestion`. Les lectures passent de toute façon par la RLS, avec la session
 * de l'appelant.
 *
 * Six résultats par groupe : c'est une palette pour ALLER quelque part, pas un
 * écran de résultats. Qui veut la liste entière a la recherche de l'écran
 * Vendeurs ou du Catalogue.
 */
const PAR_GROUPE = 6;

export type ResultatsRecherche = {
  vendeurs: { id: string; nom: string; role: string; actif: boolean }[];
  produits: { id: string; nom: string; modele: string }[];
};

export async function GET(requete: Request) {
  await exigerAdmin();

  const motif = motifIlike(new URL(requete.url).searchParams.get("q") ?? "");
  const vide: ResultatsRecherche = { vendeurs: [], produits: [] };
  if (!motif) return Response.json(vide);

  const supabase = await creerClient();
  const [rVendeurs, rProduits] = await Promise.all([
    supabase
      .from("profils")
      .select("id, nom, role, actif")
      .ilike("nom", motif)
      .order("nom")
      .limit(PAR_GROUPE),
    supabase
      .from("produits")
      .select("id, nom, modeles(nom)")
      .ilike("nom", motif)
      .order("nom")
      .limit(PAR_GROUPE),
  ]);
  if (rVendeurs.error ?? rProduits.error) {
    return new Response((rVendeurs.error ?? rProduits.error)!.message, {
      status: 500,
    });
  }

  const produits =
    (rProduits.data as unknown as
      | { id: string; nom: string; modeles: { nom: string } | null }[]
      | null) ?? [];

  return Response.json(
    {
      vendeurs: (rVendeurs.data as ResultatsRecherche["vendeurs"] | null) ?? [],
      produits: produits.map((p) => ({
        id: p.id,
        nom: p.nom,
        modele: p.modeles?.nom ?? "",
      })),
    } satisfies ResultatsRecherche,
    { headers: { "Cache-Control": "no-store" } },
  );
}
