import assert from "node:assert/strict";
import { test } from "node:test";

import { filtrer, lirePage, lireTri, motifIlike, triSql, trier } from "./tri.ts";

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

test("le motif de recherche traite % et _ comme des caractères", () => {
  assert.equal(motifIlike("100% coton"), "%100\\% coton%");
  assert.equal(motifIlike("a_b"), "%a\\_b%");
  assert.equal(motifIlike("  "), null);
  assert.equal(motifIlike(undefined), null);
  // `*` est un joker pour PostgREST et ne s'échappe pas : il est retiré.
  assert.equal(motifIlike("a*b"), "%ab%");
});

test("le tri en base n'accepte que les colonnes déclarées", () => {
  const colonnes = [{ cle: "montant", colonneSql: "montant_total" }, { cle: "badge" }];
  const defaut = { colonne: "cree_le", ascendant: false };
  assert.deepEqual(triSql(colonnes, { cle: "montant", ordre: "desc" }, defaut), {
    colonne: "montant_total",
    ascendant: false,
  });
  assert.deepEqual(triSql(colonnes, { cle: "badge", ordre: "asc" }, defaut), defaut);
  assert.deepEqual(triSql(colonnes, { cle: "mot_de_passe", ordre: "asc" }, defaut), defaut);
  assert.deepEqual(triSql(colonnes, null, defaut), defaut);
});

test("la page lue dans l'URL donne des bornes inclusives", () => {
  assert.deepEqual(lirePage({}, 20), { page: 1, de: 0, a: 19 });
  assert.deepEqual(lirePage({ page: "3" }, 20), { page: 3, de: 40, a: 59 });
  assert.deepEqual(lirePage({ vpage: "2" }, 10, "v"), { page: 2, de: 10, a: 19 });
  // Une valeur farfelue retombe sur la première page au lieu de planter.
  assert.deepEqual(lirePage({ page: "-4" }, 20).page, 1);
  assert.deepEqual(lirePage({ page: "abc" }, 20).page, 1);
});
