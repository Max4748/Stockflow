import assert from "node:assert/strict";
import { test } from "node:test";

import { ordonnerParFrequence, reprendreVente } from "./habitudes-vente.ts";

const ligne = (produit_id: string, quantite: number, vente_id = "v1") => ({
  vente_id,
  produit_id,
  quantite,
  prix_vente_unitaire: 20,
  produit: produit_id.toUpperCase(),
});

test("les produits les plus vendus passent en tête, les autres gardent leur ordre", () => {
  const produits = ["a", "b", "c", "d"].map((produit_id) => ({ produit_id }));
  const r = ordonnerParFrequence(produits, [
    ligne("c", 2),
    ligne("b", 5),
    ligne("c", 4),
  ]);
  assert.deepEqual(r.map((p) => p.produit_id), ["c", "b", "a", "d"]);
});

test("sans historique, l'ordre reçu est conservé", () => {
  const produits = ["a", "b"].map((produit_id) => ({ produit_id }));
  assert.deepEqual(ordonnerParFrequence(produits, []), produits);
});

test("la reprise d'une vente est bornée au stock détenu, et le dit", () => {
  const stock = [
    { produit_id: "a", produit: "Ambre", quantite: 10 },
    { produit_id: "b", produit: "Brume", quantite: 1 },
    { produit_id: "c", produit: "Cèdre", quantite: 0 },
  ];
  const r = reprendreVente(
    [ligne("a", 2), ligne("b", 3), ligne("c", 1), ligne("z", 1)],
    stock,
  );
  assert.deepEqual(r.lignes, [
    { produit_id: "a", quantite: 2, prix: 20 },
    { produit_id: "b", quantite: 1, prix: 20 },
  ]);
  assert.equal(r.ajustements.length, 3);
  assert.match(r.ajustements[0], /Brume : 1 au lieu de 3/);
});

test("une vente entièrement reprenable ne signale rien", () => {
  const r = reprendreVente([ligne("a", 2)], [
    { produit_id: "a", produit: "Ambre", quantite: 2 },
  ]);
  assert.deepEqual(r.ajustements, []);
});
