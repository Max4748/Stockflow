import assert from "node:assert/strict";
import { test } from "node:test";

import { filtrer, lireTri, trier } from "./tri.ts";

const lignes = [
  { nom: "Yanis", du: 732 },
  { nom: "inès", du: 533 },
  { nom: "Hugo", du: null as number | null },
  { nom: "Élodie", du: 533 },
];

test("le tri numérique compare des nombres, pas des chaînes", () => {
  const r = trier([{ v: 9 }, { v: 100 }, { v: 20 }], (l) => l.v, "asc");
  assert.deepEqual(r.map((l) => l.v), [9, 20, 100]);
});

test("le tri de texte ignore la casse et les accents", () => {
  const r = trier(lignes, (l) => l.nom, "asc");
  assert.deepEqual(r.map((l) => l.nom), ["Élodie", "Hugo", "inès", "Yanis"]);
});

test("les lignes sans valeur vont à la fin dans les deux sens", () => {
  assert.equal(trier(lignes, (l) => l.du, "asc").at(-1)?.nom, "Hugo");
  assert.equal(trier(lignes, (l) => l.du, "desc").at(-1)?.nom, "Hugo");
});

test("le tri est stable et ne modifie pas le tableau reçu", () => {
  const avant = lignes.map((l) => l.nom);
  const r = trier(lignes, (l) => l.du, "desc");
  // inès et Élodie sont à égalité : elles gardent leur ordre d'origine.
  assert.deepEqual(r.map((l) => l.nom), ["Yanis", "inès", "Élodie", "Hugo"]);
  assert.deepEqual(lignes.map((l) => l.nom), avant);
});

test("un tri inconnu laisse l'ordre de la requête", () => {
  assert.equal(trier(lignes, undefined, "asc"), lignes);
});

test("la recherche ignore accents et casse, et exige tous les mots", () => {
  const produits = [{ n: "Brume 100 ml · Vanille" }, { n: "Bougie Vanille" }];
  assert.equal(filtrer(lignes, "ines", (l) => [l.nom]).length, 1);
  assert.equal(filtrer(produits, "vanille brume", (l) => [l.n]).length, 1);
  assert.equal(filtrer(produits, "   ", (l) => [l.n]).length, 2);
});

test("lireTri lit le sens, croissant par défaut", () => {
  assert.equal(lireTri({}), null);
  assert.deepEqual(lireTri({ tri: "du" }), { cle: "du", ordre: "asc" });
  assert.deepEqual(lireTri({ tri: "du", ordre: "desc" }), { cle: "du", ordre: "desc" });
  assert.deepEqual(lireTri({ ctri: "nom" }, "c"), { cle: "nom", ordre: "asc" });
});
