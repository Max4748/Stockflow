import type { NextRequest } from "next/server";

import { exigerAdmin } from "@/lib/auth";
import { aujourdHui } from "@/lib/format";
import { argsPeriode, lirePeriode } from "@/lib/periode";
import { reponseCsv } from "@/lib/reponse-csv";
import { creerClient } from "@/lib/supabase/server";
import type { LigneJournal } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Export CSV du journal comptable, avec LES MÊMES FILTRES que l'écran : la
 * période, le type, le compte et la recherche sont lus dans l'URL, exactement
 * comme le fait la page. Ce qu'on exporte est ce qu'on regarde.
 *
 * La garde est rappelée ici comme dans toute Server Action : le layout ne
 * protège que le rendu des pages, pas une route appelée directement. Et
 * `journal_transactions()` vérifie de toute façon le rôle en base.
 *
 * LECTURE PAR PAGES jusqu'à épuisement. La fonction plafonne à 1 000 lignes
 * par appel et PostgREST tronque au même seuil en silence : un seul appel
 * donnerait un export incomplet sans la moindre erreur, ce qui est le pire
 * défaut possible pour un fichier destiné au comptable.
 */

const PAR_APPEL = 1000;
// Garde-fou : 200 000 lignes. Au-delà, mieux vaut un export refusé qu'une
// requête qui tourne sans fin.
const APPELS_MAX = 200;

export async function GET(request: NextRequest) {
  await exigerAdmin();

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const periode = lirePeriode(params);
  const supabase = await creerClient();

  const lignes: LigneJournal[] = [];
  for (let appel = 0; ; appel++) {
    if (appel >= APPELS_MAX) {
      return new Response(
        "Journal trop volumineux pour un seul export : réduire la période.",
        { status: 413 },
      );
    }

    const { data, error } = await supabase.rpc("journal_transactions", {
      ...argsPeriode(periode),
      p_type: params.type || null,
      p_vendeur_id: params.vendeur || null,
      p_recherche: params.q?.trim() || null,
      p_limite: PAR_APPEL,
      p_offset: appel * PAR_APPEL,
    });
    if (error) return new Response(error.message, { status: 500 });

    const page = (data as LigneJournal[] | null) ?? [];
    lignes.push(...page);
    if (page.length < PAR_APPEL) break;
  }

  return reponseCsv(
    `journal-comptable-${aujourdHui()}`,
    ["Date", "Type", "Opération", "Compte", "Unités", "Montant", "Saisie le", "Référence"],
    lignes.map((l) => [
      l.date_compta,
      l.type,
      l.libelle,
      l.vendeur,
      l.quantite,
      l.montant === null ? null : Number(l.montant),
      l.horodatage,
      l.reference,
    ]),
  );
}
