/**
 * Freine les tentatives de connexion, en trois paliers.
 *
 * Ce module ne connaît ni HTTP ni la base : il reçoit des clés et un instant,
 * il rend une décision. C'est ce qui le rend testable directement, et c'est
 * aussi ce qui empêche la règle de se diluer dans la Server Action.
 *
 * PALIER 1, ralentir. Le délai croît avec les échecs, plafonné : un humain qui
 * se trompe deux fois ne remarque rien, un script perd son débit.
 *
 * PALIER 2, refuser. Au-delà d'un seuil sur la même clé, la tentative est
 * rejetée sans même interroger Supabase.
 *
 * PALIER 3, bloquer l'IP. Il ne vit PAS ici : il est persistant, donc en base
 * (voir `ip_bloquees`, migration 0033). Ce module se contente de dire quand le
 * déclencher, via `doitBloquerIp`.
 *
 * POURQUOI LE PALIER 3 COMPTE DES ADRESSES DISTINCTES, et non des échecs.
 * Bloquer une IP bloque tout le monde derrière elle, or les vendeurs sont sur
 * téléphone, donc derrière le NAT d'un opérateur : des milliers d'abonnés
 * partagent une adresse publique. Compter les échecs mettrait un vendeur
 * dehors parce qu'un inconnu du même opérateur a tapé à côté. Compter les
 * ADRESSES ESSAYÉES est la signature du bourrage d'identifiants, et un
 * utilisateur légitime ne peut pas la produire : il n'en a qu'une. Se tromper
 * cinquante fois sur la sienne ne déclenche jamais rien.
 *
 * L'état des paliers 1 et 2 est en mémoire, donc perdu à chaque redémarrage.
 * C'est sans conséquence : ils ne font que ralentir, et un attaquant ne
 * déclenche pas de redémarrage. Le palier 3, lui, doit survivre aux
 * déploiements, d'où la base.
 */

/** Fenêtre glissante : au-delà, les échecs ne comptent plus. */
export const FENETRE_MS = 15 * 60 * 1000;

/** À partir d'ici, la tentative est refusée sans être transmise. */
export const SEUIL_REFUS = 8;

/** Adresses DISTINCTES depuis une même IP qui font basculer au palier 3. */
export const SEUIL_ADRESSES_DISTINCTES = 5;

const DELAI_MAX_MS = 4000;

type Echecs = { horodatages: number[] };

const parCle = new Map<string, Echecs>();
const adressesParIp = new Map<string, Map<string, number>>();

function recents(liste: number[], maintenant: number) {
  return liste.filter((t) => maintenant - t < FENETRE_MS);
}

/**
 * Purge les entrées expirées.
 *
 * Appelée à chaque décision plutôt que par un minuteur : sans processus de
 * fond, la mémoire ne peut pas croître indéfiniment, et le coût est celui d'un
 * parcours de quelques dizaines d'entrées.
 */
function purger(maintenant: number) {
  for (const [cle, e] of parCle) {
    e.horodatages = recents(e.horodatages, maintenant);
    if (e.horodatages.length === 0) parCle.delete(cle);
  }
  for (const [ip, adresses] of adressesParIp) {
    for (const [adresse, t] of adresses) {
      if (maintenant - t >= FENETRE_MS) adresses.delete(adresse);
    }
    if (adresses.size === 0) adressesParIp.delete(ip);
  }
}

export type Decision = {
  /** Refuser sans interroger Supabase. */
  refuser: boolean;
  /** Millisecondes à attendre avant de répondre. */
  delaiMs: number;
  /** Secondes restantes avant de pouvoir réessayer, si `refuser`. */
  secondesRestantes: number;
};

/**
 * Que faire de cette tentative, avant de la transmettre.
 *
 * `cles` : les identifiants du demandeur, en général l'appareil et l'adresse
 * e-mail. La décision retient la plus contraignante des deux.
 */
export function evaluer(cles: string[], maintenant = Date.now()): Decision {
  purger(maintenant);

  let pire = 0;
  let plusAncien = maintenant;
  for (const cle of cles) {
    const e = parCle.get(cle);
    if (!e) continue;
    const n = e.horodatages.length;
    if (n > pire) {
      pire = n;
      plusAncien = e.horodatages[0];
    }
  }

  if (pire >= SEUIL_REFUS) {
    const reste = Math.max(0, FENETRE_MS - (maintenant - plusAncien));
    return {
      refuser: true,
      delaiMs: 0,
      secondesRestantes: Math.ceil(reste / 1000),
    };
  }

  // Croissance par doublement à partir du 3ᵉ échec : les deux premiers sont
  // gratuits, une faute de frappe ne doit rien coûter.
  const delaiMs = pire < 2 ? 0 : Math.min(DELAI_MAX_MS, 2 ** (pire - 2) * 250);
  return { refuser: false, delaiMs, secondesRestantes: 0 };
}

/**
 * Enregistre un échec, et dit si l'IP doit passer au palier 3.
 *
 * Le booléen n'est vrai qu'au FRANCHISSEMENT du seuil, pas à chaque tentative
 * au-delà : l'appelant écrit ainsi une ligne de journal par blocage, et non
 * une par requête.
 */
export function enregistrerEchec(
  cles: string[],
  ip: string | null,
  email: string,
  maintenant = Date.now(),
): { doitBloquerIp: boolean; adressesDistinctes: number } {
  purger(maintenant);

  for (const cle of cles) {
    const e = parCle.get(cle) ?? { horodatages: [] };
    e.horodatages = [...recents(e.horodatages, maintenant), maintenant];
    parCle.set(cle, e);
  }

  if (!ip) return { doitBloquerIp: false, adressesDistinctes: 0 };

  const adresses = adressesParIp.get(ip) ?? new Map<string, number>();
  const avant = adresses.size;
  adresses.set(email, maintenant);
  adressesParIp.set(ip, adresses);

  return {
    doitBloquerIp:
      avant < SEUIL_ADRESSES_DISTINCTES &&
      adresses.size >= SEUIL_ADRESSES_DISTINCTES,
    adressesDistinctes: adresses.size,
  };
}

/** Efface les compteurs d'une connexion réussie. */
export function oublier(cles: string[]) {
  for (const cle of cles) parCle.delete(cle);
}

/** Réservé aux tests : remet le module à zéro entre deux scénarios. */
export function reinitialiser() {
  parCle.clear();
  adressesParIp.clear();
}
