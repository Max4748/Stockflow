import type { SupabaseClient } from "@supabase/supabase-js";

import type { LigneVendue } from "@/lib/habitudes-vente";
import type { MaVente } from "@/lib/types";

export type LigneHabitude = LigneVendue & { produit: string };

/**
 * Ce qu'il faut pour accélérer la saisie d'une vente : les lignes récentes du
 * vendeur (pour classer ses produits par fréquence) et celles de sa DERNIÈRE
 * vente (pour la reprendre). Appelé par les deux écrans qui montent le
 * dialogue de vente.
 *
 * `v_lignes_vente` est le seul accès du vendeur au détail de ses ventes : elle
 * filtre sur l'appelant et n'expose aucun coût. L'ordre de saisie n'y figure
 * pas, d'où `mes_ventes` pour savoir laquelle est la dernière ; une vente
 * annulée n'a plus de lignes et ne peut pas l'être.
 *
 * Deux lectures qui échouent ne doivent pas empêcher de vendre : en cas
 * d'erreur, la liste est vide et le formulaire s'affiche comme avant.
 */
export async function lireHabitudes(
  supabase: SupabaseClient,
): Promise<{ recentes: LigneHabitude[]; derniere: LigneHabitude[] }> {
  const [rLignes, rVentes] = await Promise.all([
    supabase
      .from("v_lignes_vente")
      .select("vente_id, produit_id, produit, quantite, prix_vente_unitaire")
      .order("date", { ascending: false })
      .limit(200),
    supabase.rpc("mes_ventes", { p_limite: 5 }),
  ]);

  const recentes = (rLignes.data as LigneHabitude[] | null) ?? [];
  const dernierId = ((rVentes.data as MaVente[] | null) ?? []).find(
    (v) => !v.annulee_le,
  )?.id;

  return {
    recentes,
    derniere: recentes.filter((l) => l.vente_id === dernierId),
  };
}
