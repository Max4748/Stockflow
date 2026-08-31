/**
 * Liste les fichiers du schéma dans l'ordre d'application.
 *
 * L'ORDRE VIENT DU SEUL SYSTÈME DE FICHIERS : `supabase/schema/<couche>/<n>.sql`,
 * couches triées puis fichiers triés. `appliquer-schema.sh` applique exactement
 * la même règle avec un glob shell. Aucune liste n'est tenue à jour nulle part :
 * une liste aurait divergé au premier fichier ajouté, et le rejeu aurait cessé
 * de vérifier ce que l'exploitation exécute.
 *
 * Les couches et ce que leur ordre garantit :
 *   10  types, tables, index, RLS      l'incrémental, ordonné par clés étrangères
 *   20  fonctions                      une seule définition par fonction
 *   30  vues et triggers               après 20 : leurs corps citent des fonctions
 *   40  policies, droits, commentaires après 20 : les 24 policies citent est_admin
 *   90  amorçage et reprises de données
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RACINE_SCHEMA = join(
  dirname(fileURLToPath(import.meta.url)), "..", "supabase", "schema");

/** @returns {{couche: string, nom: string, chemin: string}[]} */
export function fichiersSchema(racine = RACINE_SCHEMA) {
  const out = [];
  for (const couche of readdirSync(racine).sort()) {
    const d = join(racine, couche);
    if (!statSync(d).isDirectory()) continue;
    for (const nom of readdirSync(d).filter((f) => f.endsWith(".sql")).sort())
      out.push({ couche, nom, chemin: join(d, nom) });
  }
  return out;
}
