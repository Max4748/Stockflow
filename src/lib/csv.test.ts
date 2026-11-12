import assert from "node:assert/strict";
import { test } from "node:test";

import { celluleCsv, versCsv } from "./csv.ts";

/**
 * Le fichier est ouvert dans un tableur, par quelqu'un qui n'a pas saisi les
 * données : ces tests fixent ce qu'un libellé hostile ou simplement inhabituel
 * ne doit pas pouvoir faire.
 */

test("un libellé qui commence comme une formule est neutralisé", () => {
  assert.equal(celluleCsv("=1+1"), "'=1+1");
  assert.equal(celluleCsv("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(celluleCsv("+33 6 12 34 56 78"), "'+33 6 12 34 56 78");
  assert.equal(celluleCsv("-10% promo"), "'-10% promo");
});

test("un montant négatif reste un nombre, pas un texte neutralisé", () => {
  assert.equal(celluleCsv(-12.5), "-12,5");
});

test("les décimales sont à virgule, sans séparateur de milliers", () => {
  assert.equal(celluleCsv(1234.56), "1234,56");
  assert.equal(celluleCsv(40), "40");
});

test("séparateur, guillemets et sauts de ligne sont protégés", () => {
  assert.equal(celluleCsv("Dupont ; fils"), '"Dupont ; fils"');
  assert.equal(celluleCsv('dit "le grand"'), '"dit ""le grand"""');
  assert.equal(celluleCsv("ligne 1\nligne 2"), '"ligne 1\nligne 2"');
});

test("une formule contenant le séparateur est neutralisée PUIS protégée", () => {
  assert.equal(celluleCsv("=A1;B1"), "\"'=A1;B1\"");
});

test("vide pour null, undefined et les nombres non finis", () => {
  assert.equal(celluleCsv(null), "");
  assert.equal(celluleCsv(undefined), "");
  assert.equal(celluleCsv(Number.NaN), "");
});

test("le fichier commence par un BOM et ses lignes finissent en CRLF", () => {
  const csv = versCsv(["Date", "Montant"], [["2026-11-10", 12.5]]);
  assert.equal(csv, "﻿Date;Montant\r\n2026-11-10;12,5\r\n");
});
