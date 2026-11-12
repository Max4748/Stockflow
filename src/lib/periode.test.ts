import assert from "node:assert/strict";
import { test } from "node:test";

import { evolution, periodePrecedente } from "./periode.ts";

test("la période précédente a la même durée et se termine la veille", () => {
  assert.deepEqual(periodePrecedente({ du: "2026-11-01", au: "2026-11-12" }), {
    du: "2026-10-20",
    au: "2026-10-31",
  });
  // Un seul jour se compare à la veille.
  assert.deepEqual(periodePrecedente({ du: "2026-03-01", au: "2026-03-01" }), {
    du: "2026-02-28",
    au: "2026-02-28",
  });
});

test("pas de période précédente sans les deux bornes", () => {
  assert.equal(periodePrecedente({ du: null, au: null }), null);
  assert.equal(periodePrecedente({ du: "2026-01-01", au: null }), null);
  assert.equal(periodePrecedente({ du: "2026-02-01", au: "2026-01-01" }), null);
});

test("l'évolution est un pourcentage arrondi, absent sans base de comparaison", () => {
  assert.equal(evolution(112, 100), 12);
  assert.equal(evolution(50, 100), -50);
  assert.equal(evolution(0, 100), -100);
  assert.equal(evolution(100, 0), null);
  assert.equal(evolution(100, -20), null);
  assert.equal(evolution(100, null), null);
});
