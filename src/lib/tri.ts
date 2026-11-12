/**
 * Tri et recherche des tableaux, pilotés par l'URL.
 *
 * Même parti que le filtre de période : l'état vit dans les `searchParams`,
 * la page reste un Server Component, le tri survit au rechargement et se
 * partage par lien. Il y a une raison de plus ici : les colonnes d'un tableau
 * portent des FONCTIONS (`valeur`, `tri`), qui ne traversent pas la frontière
 * serveur → client. Un tableau trié côté client obligerait chaque écran à
 * devenir un composant client.
 *
 * Ce module ne dépend de rien : il est testé à part (`tri.test.ts`).
 */

export type Ordre = "asc" | "desc";
export type Tri = { cle: string; ordre: Ordre };

export function lireTri(
  params: Record<string, string | undefined>,
  prefixe = "",
): Tri | null {
  const cle = params[`${prefixe}tri`];
  if (!cle) return null;
  return { cle, ordre: params[`${prefixe}ordre`] === "desc" ? "desc" : "asc" };
}

const comparateur = new Intl.Collator("fr", {
  sensitivity: "base",
  numeric: true,
});

/**
 * Trie SANS modifier le tableau reçu, et de façon stable : deux lignes égales
 * gardent leur ordre d'origine, qui est celui choisi par la requête SQL.
 *
 * `null` et `undefined` vont toujours à la fin, dans les deux sens. Un tri
 * décroissant qui remonterait les lignes sans valeur en tête montrerait
 * d'abord ce qu'il y a le moins à lire.
 */
export function trier<T>(
  lignes: T[],
  cle: ((ligne: T) => string | number | null | undefined) | undefined,
  ordre: Ordre,
): T[] {
  if (!cle) return lignes;
  const sens = ordre === "desc" ? -1 : 1;

  return lignes
    .map((ligne, index) => ({ ligne, index, v: cle(ligne) }))
    .sort((a, b) => {
      const aVide = a.v === null || a.v === undefined;
      const bVide = b.v === null || b.v === undefined;
      if (aVide || bVide) return aVide === bVide ? a.index - b.index : aVide ? 1 : -1;

      const ecart =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : comparateur.compare(String(a.v), String(b.v));
      return ecart !== 0 ? ecart * sens : a.index - b.index;
    })
    .map((x) => x.ligne);
}

/** Minuscules et sans accents : « ines » doit trouver « Inès ». */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Garde les lignes dont au moins un des textes contient la recherche. Tous les
 * mots saisis doivent être présents, dans n'importe quel ordre : « brume
 * vanille » trouve « Brume 100 ml · Vanille ».
 */
export function filtrer<T>(
  lignes: T[],
  recherche: string | undefined,
  textes: (ligne: T) => (string | null | undefined)[],
): T[] {
  const mots = normaliser(recherche ?? "").split(/\s+/).filter(Boolean);
  if (mots.length === 0) return lignes;

  return lignes.filter((ligne) => {
    const cible = normaliser(textes(ligne).filter(Boolean).join(" "));
    return mots.every((mot) => cible.includes(mot));
  });
}

/**
 * TRI, RECHERCHE ET PAGINATION FAITS EN BASE.
 *
 * Tout ce qui précède travaille sur des lignes déjà chargées, ce qui ne vaut
 * que pour une liste entière. Dès qu'une liste est PAGINÉE, trier ou chercher
 * dans la page reçue mentirait : « le plus gros montant » serait celui des
 * vingt lignes affichées. Ces trois fonctions traduisent donc les mêmes
 * paramètres d'URL en arguments pour PostgREST (`order`, `ilike`, `range`).
 */

/**
 * Motif `ilike` pour une recherche saisie, ou `null` s'il n'y a rien à
 * chercher. `%` et `_` sont des jokers pour LIKE : saisis par l'utilisateur,
 * ce sont des caractères (« 100% coton »). `*` est retiré : PostgREST le lit
 * comme un autre nom de `%`, et il n'existe pas de façon de l'échapper.
 */
export function motifIlike(recherche: string | undefined): string | null {
  const texte = (recherche ?? "").trim().replaceAll("*", "");
  if (!texte) return null;
  return `%${texte.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Colonne SQL et sens à passer à `.order()`. Seules les colonnes qui déclarent
 * `colonneSql` sont acceptées : la clé vient de l'URL, on ne la laisse pas
 * désigner une colonne arbitraire.
 */
export function triSql(
  colonnes: { cle: string; colonneSql?: string }[],
  tri: Tri | null,
  defaut: { colonne: string; ascendant: boolean },
): { colonne: string; ascendant: boolean } {
  const colonne = colonnes.find((c) => c.cle === tri?.cle)?.colonneSql;
  return colonne ? { colonne, ascendant: tri!.ordre === "asc" } : defaut;
}

/** Page courante (à partir de 1) et bornes inclusives pour `.range()`. */
export function lirePage(
  params: Record<string, string | undefined>,
  parPage: number,
  prefixe = "",
): { page: number; de: number; a: number } {
  const page = Math.max(1, Math.floor(Number(params[`${prefixe}page`]) || 1));
  return { page, de: (page - 1) * parPage, a: page * parPage - 1 };
}
