/**
 * Découpage d'un fichier SQL en instructions.
 *
 * Extrait de `supabase/tests/rejeu.test.mjs`, qui en avait besoin le premier,
 * et partagé avec `scripts/verifier-migrations.mjs`. Une seule définition :
 * deux découpeurs divergeraient, et le contrôle statique cesserait de voir ce
 * que le rejeu exécute.
 */
/**
 * Découpe un fichier en instructions, pour les envoyer UNE PAR UNE.
 *
 * Ce n'est pas un détail d'implémentation : envoyer tout un fichier d'un bloc
 * le fait exécuter dans une seule transaction implicite, et Postgres refuse
 * alors d'utiliser une valeur d'enum ajoutée dans cette même transaction
 * (« unsafe use of new value »). C'est le cas de 0014, qui ajoute 'sav' à
 * type_mouvement puis s'en sert. Le comportement reproduit ici est celui de
 * appliquer-migrations.sh, c'est-à-dire psql SANS -1 : autocommit par
 * instruction.
 *
 * Corollaire à connaître : le schéma de StockFlow ne peut PAS être appliqué
 * d'un bloc dans une transaction unique. Un bundle `psql -1` échouerait à
 * 0014, sur le vrai moteur comme ici.
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
