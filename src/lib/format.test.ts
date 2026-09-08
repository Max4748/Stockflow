import assert from "node:assert/strict";
import { test } from "node:test";

import { niveauModele, niveauStock } from "./format.ts";

/**
 * Les deux seuils répondent à deux questions distinctes. Ces tests fixent la
 * frontière : un modèle peut aller bien alors qu'un de ses parfums est mort, et
 * inversement un modèle peut être bas alors qu'aucun parfum ne l'est.
 */

test("un parfum épuisé est en rupture, quel que soit le seuil", () => {
  assert.equal(niveauStock(0, 3), "rupture");
  assert.equal(niveauStock(0, 0), "rupture");
});

test("le modèle somme ses parfums", () => {
  // 1 + 1 + 1 = 3, sous un seuil de 5 : le modèle s'éteint.
  assert.equal(niveauModele([1, 1, 1], 5), "bas");
  assert.equal(niveauModele([4, 4, 4], 5), "ok");
});

test("un modèle va bien alors qu'un parfum est mort", () => {
  // C'est tout l'intérêt d'avoir DEUX seuils : le total rassure, le détail non.
  assert.equal(niveauModele([0, 20], 3), "ok");
  assert.equal(niveauStock(0, 3), "rupture");
});

test("un modèle est bas alors qu'aucun parfum ne l'est", () => {
  // Trois parfums à 2, seuil parfum 1 : aucun n'alerte. Total 6, seuil modèle
  // 10 : le modèle alerte. La réciproque du cas précédent.
  assert.equal(niveauStock(2, 1), "ok");
  assert.equal(niveauModele([2, 2, 2], 10), "bas");
});

test("seuil de modèle à 0 : alerte désactivée, mais la rupture reste", () => {
  assert.equal(niveauModele([1], 0), "ok");
  assert.equal(niveauModele([50], 0), "ok");
  // Zéro partout reste une rupture : ce n'est pas un seuil, c'est un fait.
  assert.equal(niveauModele([0, 0], 0), "rupture");
});

test("un modèle sans parfum est en rupture", () => {
  assert.equal(niveauModele([], 5), "rupture");
});
