import { devices, expect, test } from "@playwright/test";

import { connecter, VENDEUR } from "./session";

// L'espace vendeur se pratique debout, sur un téléphone : c'est à cette
// largeur que ses écrans doivent tenir. `Pixel 5` garde Chromium, le seul
// navigateur installé pour ces tests.
test.use({ ...devices["Pixel 5"] });

test.beforeEach(async ({ context }) => {
  await connecter(context, VENDEUR);
});

test("la saisie de vente nomme ses champs et reprend la dernière vente", async ({ page }) => {
  await page.goto("/vendeur");
  await page.getByRole("button", { name: "Enregistrer une vente" }).click();
  const dialogue = page.getByRole("dialog");

  // Sur téléphone, l'en-tête de colonnes est masqué : chaque champ porte son
  // libellé visible.
  await expect(dialogue.getByText("Quantité", { exact: true })).toBeVisible();
  await expect(dialogue.getByText("Prix unitaire (€)")).toBeVisible();

  await dialogue.getByRole("button", { name: "Reprendre la dernière vente" }).click();
  // Deux lignes dans la dernière vente, dont une au-delà du stock détenu.
  await expect(dialogue.getByText("Quantité", { exact: true })).toHaveCount(2);
  await expect(dialogue.getByText(/1 au lieu de 3, faute de stock/)).toBeVisible();
});

test("les ventes se cherchent par client, sur tout l'historique", async ({ page }) => {
  await page.goto("/vendeur/vente");
  await expect(page.getByText("Page 1 sur 5")).toBeVisible();

  const champ = page.getByRole("searchbox", { name: "Rechercher un client" });
  await champ.fill("roche");
  await champ.press("Enter");
  await expect(page).toHaveURL(/q=roche/);
  // 8 ventes à Mme Roche : elles tiennent sur une page, le pied disparaît.
  await expect(page.getByText(/Mme Roche ·/)).toHaveCount(8);
  await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
});

test("le stock se filtre sans changer le total affiché", async ({ page }) => {
  await page.goto("/vendeur/stock?q=bougie");
  await expect(page.getByText("Bougie Ambre")).toBeVisible();
  await expect(page.getByText("Brume Vanille")).toHaveCount(0);
  // 29 unités détenues en tout : la recherche ne filtre que les tuiles.
  await expect(page.getByText("29 unité(s)")).toBeVisible();
});
