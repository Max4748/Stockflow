import assert from "node:assert/strict";
import { test } from "node:test";

import { choisirPas, construireSerie, graduations } from "./serie.ts";

test("un jour sans vente vaut zéro au lieu d'être sauté", () => {
  const { pas, serie } = construireSerie(
    [
      { jour: "2026-11-02", ca: 60, nb_ventes: 1 },
      { jour: "2026-11-05", ca: 40, nb_ventes: 2 },
    ],
    "2026-11-01",
    "2026-11-06",
  );
  assert.equal(pas, "jour");
  assert.deepEqual(serie.map((p) => p.ca), [0, 60, 0, 0, 40, 0]);
  assert.equal(serie[0].debut, "2026-11-01");
});

test("sans bornes, la série va du premier au dernier jour qui a bougé", () => {
  const { serie } = construireSerie([
    { jour: "2026-11-02", ca: 60, nb_ventes: 1 },
    { jour: "2026-11-04", ca: 40, nb_ventes: 1 },
  ]);
  assert.deepEqual(serie.map((p) => p.debut), ["2026-11-02", "2026-11-03", "2026-11-04"]);
});

test("le pas s'élargit avec la période", () => {
  assert.equal(choisirPas(31), "jour");
  assert.equal(choisirPas(120), "semaine");
  assert.equal(choisirPas(800), "mois");
});

test("le regroupement par semaine commence le lundi et conserve le total", () => {
  const { pas, serie } = construireSerie(
    [
      { jour: "2026-06-03", ca: 10, nb_ventes: 1 }, // mercredi
      { jour: "2026-06-07", ca: 5, nb_ventes: 1 }, // dimanche, même semaine
      { jour: "2026-06-08", ca: 7, nb_ventes: 1 }, // lundi suivant
    ],
    "2026-06-01",
    "2026-09-30",
  );
  assert.equal(pas, "semaine");
  assert.equal(serie[0].debut, "2026-06-01");
  assert.equal(serie[0].ca, 15);
  assert.equal(serie[1].ca, 7);
  assert.equal(serie.reduce((s, p) => s + p.ca, 0), 22);
});

test("le regroupement par mois ne perd rien aux changements de mois", () => {
  const { pas, serie } = construireSerie(
    [
      { jour: "2025-01-31", ca: 1, nb_ventes: 1 },
      { jour: "2025-02-01", ca: 2, nb_ventes: 1 },
      { jour: "2026-03-15", ca: 4, nb_ventes: 1 },
    ],
    "2025-01-01",
    "2026-03-31",
  );
  assert.equal(pas, "mois");
  assert.equal(serie.length, 15);
  assert.deepEqual(serie.slice(0, 2).map((p) => p.ca), [1, 2]);
  assert.equal(serie.at(-1)?.ca, 4);
});

test("les sommes de flottants sont arrondies au centime", () => {
  const { serie } = construireSerie([
    { jour: "2026-11-02", ca: 0.1, nb_ventes: 1 },
    { jour: "2026-11-02", ca: 0.2, nb_ventes: 1 },
  ]);
  assert.equal(serie[0].ca, 0.3);
});

test("les graduations sont rondes et couvrent les valeurs, zéro compris", () => {
  assert.deepEqual(graduations(0, 874), [0, 250, 500, 750, 1000]);
  assert.deepEqual(graduations(0, 0), [0, 1]);
  const g = graduations(-30, 120);
  assert.ok(g[0] <= -30 && g.at(-1)! >= 120 && g.includes(0));
});
