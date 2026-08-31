/**
 * Contrôle statique du schéma : aucun `delete` ni `update` sans `where`.
 *
 *     npm run verif:sql
 *
 * POURQUOI UN CONTRÔLE STATIQUE, et pas un test.
 *
 * L'instance charge `supautils` en `session_preload_libraries`, qui arme
 * `safeupdate` pour les rôles non superutilisateur : une suppression sans
 * clause `where` y échoue sur « DELETE requires a WHERE clause ». Or le harnais
 * pgTAP se connecte en `postgres` et simule le rôle par `set role`, où
 * `safeupdate` n'est pas armé. Aucun test ne peut donc voir le défaut, et il
 * n'apparaît qu'en conditions réelles, à travers l'application. C'est
 * exactement ce qui est arrivé à `reinitialiser_donnees` : 185 assertions au
 * vert pendant que la fonction était cassée.
 *
 * POURQUOI PAS UN GREP. `update profils` sur une ligne et `where` sur la
 * suivante est la forme courante, cinq fois dans le schéma. Il faut
 * découper les instructions en respectant le dollar-quoting, ce que fait
 * `instructions-sql.mjs`, partagé avec le harnais de rejeu.
 *
 * `where true` passe : c'est la façon explicite de dire « oui, je sais ».
 */
import { readFileSync } from "node:fs";

import { instructions } from "./instructions-sql.mjs";

import { fichiersSchema } from "./fichiers-schema.mjs";

/** Retire commentaires et littéraux avant de chercher le mot-clé. */
function nettoyer(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const fautes = [];

for (const { couche, nom, chemin } of fichiersSchema()) {
  const fichier = `${couche}/${nom}`;
  const brut = readFileSync(chemin, "utf8");
  for (const instruction of instructions(brut)) {
    const s = nettoyer(instruction);
    // `\b` sur le mot-clé en tête : `delete` apparaît aussi dans
    // `on delete cascade` et dans `revoke ... delete`, qui ne sont pas des
    // instructions de suppression.
    if (!/^\s*(delete\s+from|update)\s+/i.test(s)) continue;
    if (/\bwhere\b/i.test(s)) continue;
    fautes.push({ fichier, extrait: instruction.split("\n")[0].trim().slice(0, 80) });
  }
}

if (fautes.length > 0) {
  console.error("\x1b[31mSuppressions ou mises à jour sans clause WHERE :\x1b[0m\n");
  for (const f of fautes) console.error(`  ${f.fichier}\n    ${f.extrait}\n`);
  console.error(
    "`supautils` les refuse pour les rôles non superutilisateur, et aucun test",
  );
  console.error(
    "ne l'attrape : le harnais tourne en superutilisateur. Ajouter `where true`",
  );
  console.error("si la portée totale est voulue.");
  process.exit(1);
}

console.log("\x1b[32mAucune suppression ni mise à jour sans WHERE.\x1b[0m");
