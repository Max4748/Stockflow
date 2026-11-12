import { versCsv, type CelluleCsv } from "@/lib/csv";

/**
 * Réponse HTTP d'un export CSV : téléchargement, jamais affichage.
 *
 * `no-store` : le fichier porte des chiffres d'affaires et des créances. Il ne
 * doit rester ni dans un cache partagé, ni dans celui du navigateur.
 *
 * Le nom de fichier est fabriqué ici et n'est fait que de lettres, chiffres et
 * tirets : rien de ce que l'utilisateur saisit n'entre dans un en-tête.
 */
export function reponseCsv(
  nom: string,
  entetes: string[],
  lignes: CelluleCsv[][],
): Response {
  const propre = nom.replace(/[^a-z0-9-]/gi, "-");
  return new Response(versCsv(entetes, lignes), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${propre}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
