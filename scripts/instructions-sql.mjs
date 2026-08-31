/**
 * Découpage d'un fichier SQL en instructions.
 *
 * Extrait de `supabase/tests/rejeu.test.mjs`, qui en avait besoin le premier,
 * et partagé avec `scripts/verifier-schema.mjs`. Une seule définition :
 * deux découpeurs divergeraient, et le contrôle statique cesserait de voir ce
 * que le rejeu exécute.
 */
/**
 * Découpe un fichier en instructions, pour les envoyer UNE PAR UNE.
 *
 * Deux usages, tous deux au niveau de l'instruction : `verifier-schema.mjs`
 * cherche un `delete` ou un `update` sans `where`, ce qu'un fichier entier ne
 * permet pas de décider ; `rejeu.test.mjs` nomme l'instruction exacte qui a
 * échoué, au lieu de rendre un fichier de 400 lignes.
 *
 * CE QUI A CHANGÉ. Tant que le schéma vivait dans des migrations numérotées,
 * il ne pouvait PAS être appliqué d'un bloc : `alter type type_mouvement add
 * value 'sav'` puis un usage de 'sav' dans la même transaction font échouer
 * Postgres (« unsafe use of new value »). La valeur est maintenant déclarée
 * dans le `create type` lui-même, ce `alter type` a disparu, et
 * un `psql -1` sur la concaténation des fichiers du schéma passe — vérifié.
 *
 * Le découpage respecte le dollar-quoting (`$$`, `$fn$`), sans quoi chaque
 * `;` d'un corps plpgsql couperait au mauvais endroit.
 */
export function instructions(sql) {
  const out = [];
  let debut = 0, i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const f = sql.indexOf("\n", i);
      i = f === -1 ? n : f + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const f = sql.indexOf("*/", i + 2);
      i = f === -1 ? n : f + 2;
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n && sql[i] !== c) i += sql[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "$") {
      const m = /^\$[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const f = sql.indexOf(m[0], i + m[0].length);
        i = f === -1 ? n : f + m[0].length;
      } else i++;
    } else if (c === ";") {
      const s = sql.slice(debut, i).trim();
      if (s) out.push(s);
      debut = ++i;
    } else i++;
  }
  const reste = sql.slice(debut).trim();
  if (reste) out.push(reste);
  return out;
}
