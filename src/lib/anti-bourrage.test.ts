/**
 * Tests de la logique d'anti-bourrage.
 *
 *     npm run test:unit
 *
 * `node:test`, présent dans Node depuis la 18 : aucune dépendance ajoutée pour
 * le seul module du projet dont la logique ne vit pas en SQL.
 *
 * L'instant est passé en argument partout, donc rien n'attend réellement : la
 * fenêtre de quinze minutes se traverse en changeant un nombre.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  enregistrerEchec,
  evaluer,
  FENETRE_MS,
  oublier,
  reinitialiser,
  SEUIL_ADRESSES_DISTINCTES,
  SEUIL_REFUS,
} from "./anti-bourrage.ts";

const T = 1_000_000;

beforeEach(() => reinitialiser());

describe("palier 1 — ralentir", () => {
  it("laisse passer les deux premiers échecs sans délai", () => {
    assert.equal(evaluer(["a"], T).delaiMs, 0);
    enregistrerEchec(["a"], null, "x@y.z", T);
    assert.equal(evaluer(["a"], T).delaiMs, 0);
  });

  it("allonge le délai ensuite, sans dépasser le plafond", () => {
    let precedent = 0;
    for (let i = 0; i < SEUIL_REFUS - 1; i++) {
      enregistrerEchec(["a"], null, "x@y.z", T);
      const d = evaluer(["a"], T).delaiMs;
      assert.ok(d >= precedent, "le délai ne décroît jamais");
      precedent = d;
    }
    assert.ok(precedent <= 4000, "le délai reste borné");
  });

  it("retient la plus contraignante des clés", () => {
    for (let i = 0; i < 4; i++) enregistrerEchec(["appareil"], null, "x@y.z", T);
    assert.ok(evaluer(["appareil", "email-neuf"], T).delaiMs > 0);
  });
});

describe("palier 2 — refuser", () => {
  it("refuse au seuil, et dit combien de temps attendre", () => {
    for (let i = 0; i < SEUIL_REFUS; i++)
      enregistrerEchec(["a"], null, "x@y.z", T);
    const d = evaluer(["a"], T);
    assert.equal(d.refuser, true);
    assert.ok(d.secondesRestantes > 0);
  });

  it("laisse repasser une fois la fenêtre écoulée", () => {
    for (let i = 0; i < SEUIL_REFUS; i++)
      enregistrerEchec(["a"], null, "x@y.z", T);
    assert.equal(evaluer(["a"], T + FENETRE_MS + 1).refuser, false);
  });

  it("oublie tout après une connexion réussie", () => {
    for (let i = 0; i < SEUIL_REFUS; i++)
      enregistrerEchec(["a"], null, "x@y.z", T);
    oublier(["a"]);
    assert.equal(evaluer(["a"], T).refuser, false);
  });
});

describe("palier 3 — bloquer l'IP", () => {
  it("NE bloque PAS sur cinquante échecs d'une seule adresse", () => {
    let bloque = false;
    for (let i = 0; i < 50; i++) {
      bloque ||= enregistrerEchec(["a"], "1.2.3.4", "vendeur@maison.fr", T)
        .doitBloquerIp;
    }
    assert.equal(
      bloque,
      false,
      "un vendeur qui se trompe cinquante fois ne bloque pas son opérateur",
    );
  });

  it("bloque au seuil d'adresses distinctes", () => {
    let bloque = false;
    for (let i = 0; i < SEUIL_ADRESSES_DISTINCTES; i++) {
      bloque ||= enregistrerEchec(["a"], "1.2.3.4", `cible${i}@x.z`, T)
        .doitBloquerIp;
    }
    assert.equal(bloque, true);
  });

  it("ne signale le blocage qu'UNE fois, au franchissement", () => {
    let fois = 0;
    for (let i = 0; i < SEUIL_ADRESSES_DISTINCTES + 5; i++) {
      if (enregistrerEchec(["a"], "1.2.3.4", `cible${i}@x.z`, T).doitBloquerIp)
        fois++;
    }
    assert.equal(fois, 1, "une ligne de journal par blocage, pas par requête");
  });

  it("ne bloque JAMAIS quand l'IP est inconnue", () => {
    // Sans en-tête de confiance, `ipAppelante()` renvoie null. Le palier 3 ne
    // doit alors pas s'armer : le contraire reviendrait à bloquer une clé
    // vide, donc tout le monde d'un coup.
    let bloque = false;
    for (let i = 0; i < SEUIL_ADRESSES_DISTINCTES * 3; i++) {
      bloque ||= enregistrerEchec(["a"], null, `cible${i}@x.z`, T).doitBloquerIp;
    }
    assert.equal(bloque, false);
  });

  it("compte les adresses par IP, sans mélanger deux IP", () => {
    for (let i = 0; i < SEUIL_ADRESSES_DISTINCTES - 1; i++)
      enregistrerEchec(["a"], "1.1.1.1", `cible${i}@x.z`, T);
    const r = enregistrerEchec(["a"], "2.2.2.2", "autre@x.z", T);
    assert.equal(r.doitBloquerIp, false);
    assert.equal(r.adressesDistinctes, 1);
  });

  it("oublie les adresses sorties de la fenêtre", () => {
    for (let i = 0; i < SEUIL_ADRESSES_DISTINCTES - 1; i++)
      enregistrerEchec(["a"], "1.2.3.4", `cible${i}@x.z`, T);
    const r = enregistrerEchec(
      ["a"],
      "1.2.3.4",
      "dernier@x.z",
      T + FENETRE_MS + 1,
    );
    assert.equal(r.doitBloquerIp, false, "les anciennes ne comptent plus");
  });
});
