import { NextResponse } from "next/server";

/**
 * Test de vivacité, pour le `healthcheck` de compose.yaml.
 *
 * NE TOUCHE NI À LA BASE NI À SUPABASE, et c'est tout l'intérêt. Un healthcheck
 * qui interrogerait la base rendrait le conteneur « malsain » quand c'est
 * Supabase qui est tombé — or le redémarrer n'y changerait rien, et Docker le
 * relancerait en boucle pour une panne située ailleurs. Ce que ce point mesure
 * est exactement ce que `restart: unless-stopped` peut réparer : le processus
 * Node ne sert plus de HTTP.
 *
 * IL DOIT RESTER HORS DU `matcher` de src/proxy.ts. Le proxy appelle
 * `getUser()` sur chaque requête qu'il intercepte, ce qui est un aller-retour
 * réseau vers Supabase : y laisser passer cette route lui rendrait la
 * dépendance qu'on vient d'écarter, trente fois par minute.
 *
 * Ajouté après le constat qu'une boucle OOM-kill/redémarrage était invisible :
 * le moniteur Kuma est de type `docker` et voit un conteneur « running »
 * l'essentiel du temps, pendant que chaque tour remet à zéro les paliers 1 et 2
 * de l'anti-bourrage, qui vivent en mémoire du processus.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ etat: "ok" });
}
