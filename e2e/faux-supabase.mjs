/**
 * Faux Supabase pour les tests de bout en bout : juste ce qu'il faut de GoTrue
 * et de PostgREST pour que l'application s'affiche.
 *
 * POURQUOI UN FAUX. Les vraies règles métier vivent en SQL et sont testées
 * là (pgTAP, sur le moteur de production). Ce que ces tests-ci vérifient est
 * l'INTERFACE : qu'un écran s'affiche, qu'un tri change l'ordre, qu'un vendeur
 * est refoulé de la gestion. Monter Postgres, PostgREST et GoTrue pour cela
 * coûterait des minutes de CI à chaque poussée sans rien apprendre de plus.
 *
 * LA LIMITE qui va avec : ce serveur répond ce qu'on lui a écrit de répondre.
 * Un test vert ici ne dit rien d'un calcul ; il dit que l'écran sait afficher
 * une réponse de la forme attendue. Voir docs/tests.md.
 *
 * Ce qu'il sait faire de PostgREST : `eq`, `ilike`, `in`, `order`, `offset` /
 * `limit`, le décompte (`Prefer: count=exact`) et l'objet unique
 * (`Accept: …pgrst.object`). Une fonction inconnue est traitée comme une
 * écriture : acceptée, sans effet.
 *
 *   node e2e/faux-supabase.mjs          # port 8001
 *   LENT=1500 node e2e/faux-supabase.mjs   # réponses retardées (squelettes)
 */
import http from "node:http";

import { fonctions, profils, tables } from "./donnees.mjs";

const PORT = Number(process.env.PORT_FAUX_SUPABASE ?? 8001);
const RETARD = Number(process.env.LENT ?? 0);

/** Identifiant porté par le jeton. La signature n'est pas vérifiée : tout est faux ici. */
function appelant(req) {
  try {
    const charge = (req.headers.authorization ?? "").split(".")[1];
    return JSON.parse(Buffer.from(charge, "base64url").toString()).sub ?? null;
  } catch {
    return null;
  }
}

function corps(req) {
  return new Promise((resolve) => {
    let texte = "";
    req.on("data", (morceau) => (texte += morceau));
    req.on("end", () => {
      try {
        resolve(texte ? JSON.parse(texte) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const echapper = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Motif LIKE (`%`, `_`, échappement `\`) → expression régulière. */
function versRegExp(motif) {
  let source = "";
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i];
    if (c === "\\" && i + 1 < motif.length) source += echapper(motif[++i]);
    else if (c === "%" || c === "*") source += ".*";
    else if (c === "_") source += ".";
    else source += echapper(c);
  }
  return new RegExp(`^${source}$`, "i");
}

const RESERVES = new Set(["select", "order", "offset", "limit"]);

function filtrer(lignes, params) {
  let resultat = lignes;
  for (const [colonne, valeur] of params) {
    if (RESERVES.has(colonne)) continue;
    const [operateur, ...reste] = valeur.split(".");
    const operande = reste.join(".");
    if (operateur === "eq") {
      resultat = resultat.filter((l) => String(l[colonne]) === operande);
    } else if (operateur === "ilike") {
      const motif = versRegExp(operande);
      resultat = resultat.filter((l) => motif.test(String(l[colonne] ?? "")));
    } else if (operateur === "in") {
      const valeurs = new Set(operande.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")));
      resultat = resultat.filter((l) => valeurs.has(String(l[colonne])));
    }
  }
  return resultat;
}

function trier(lignes, ordre) {
  if (!ordre) return lignes;
  const cles = ordre.split(",").map((c) => {
    const [colonne, sens] = c.split(".");
    return { colonne, sens: sens === "desc" ? -1 : 1 };
  });
  return [...lignes].sort((a, b) => {
    for (const { colonne, sens } of cles) {
      const x = a[colonne], y = b[colonne];
      if (x === y) continue;
      // NULL en dernier en croissant, en premier en décroissant : comme Postgres.
      if (x == null) return sens;
      if (y == null) return -sens;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sens;
    }
    return 0;
  });
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://faux");
  const id = appelant(req);
  const envoyer = (code, contenu, entetes = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...entetes });
    res.end(req.method === "HEAD" || contenu === undefined ? undefined : JSON.stringify(contenu));
  };

  // ---------- GoTrue ----------
  if (url.pathname === "/auth/v1/user") {
    const profil = profils.find((p) => p.id === id);
    return profil
      ? envoyer(200, { id, aud: "authenticated", role: "authenticated", email: profil.email, factors: [], app_metadata: {}, user_metadata: {} })
      : envoyer(401, { msg: "Jeton inconnu" });
  }
  if (url.pathname.startsWith("/auth/")) return envoyer(200, {});

  // ---------- PostgREST ----------
  if (RETARD) await new Promise((r) => setTimeout(r, RETARD));

  const nom = url.pathname.replace("/rest/v1/", "");
  const estFonction = nom.startsWith("rpc/");
  let lignes;
  if (estFonction) {
    const fonction = fonctions[nom.slice(4)];
    // Une fonction inconnue est une écriture : on l'accepte sans rien changer.
    if (!fonction) return envoyer(200, null);
    lignes = fonction(await corps(req), id);
  } else {
    if (!tables[nom]) {
      console.log("table inconnue :", nom);
      return envoyer(200, []);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return envoyer(204);
    lignes = tables[nom](id);
  }

  if (!Array.isArray(lignes)) return envoyer(200, lignes);

  const retenues = trier(filtrer(lignes, url.searchParams), url.searchParams.get("order"));
  const debut = Number(url.searchParams.get("offset") ?? 0);
  const limite = url.searchParams.get("limit");
  const page = retenues.slice(debut, limite === null ? undefined : debut + Number(limite));

  const compte = (req.headers.prefer ?? "").includes("count=exact") ? retenues.length : "*";
  const plage = page.length > 0 ? `${debut}-${debut + page.length - 1}` : "*";
  const unique = (req.headers.accept ?? "").includes("pgrst.object");
  envoyer(200, unique ? (page[0] ?? null) : page, { "content-range": `${plage}/${compte}` });
});

serveur.listen(PORT, "127.0.0.1", () => console.log(`faux Supabase sur le port ${PORT}`));
