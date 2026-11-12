import { expect, test } from "@playwright/test";

import { connecter, GERANT, VENDEUR } from "./session";

const FICHE = `/gestion/vendeurs/${VENDEUR}`;

test.describe("accès", () => {
  test("sans session, la gestion renvoie à la connexion", async ({ page }) => {
    await page.goto("/gestion");
    await expect(page).toHaveURL(/\/login/);
  });

  test("un vendeur est refoulé de la gestion", async ({ page, context }) => {
    await connecter(context, VENDEUR);
    await page.goto("/gestion");
    await expect(page).toHaveURL(/\/vendeur$/);
  });

  test("un vendeur n'obtient pas l'export des créances", async ({ page, context }) => {
    await connecter(context, VENDEUR);
    const reponse = await page.request.get("/gestion/vendeurs/export", {
      maxRedirects: 0,
    });
    expect(reponse.status()).toBe(307);
  });
});

test.describe("gestion", () => {
  test.beforeEach(async ({ context }) => {
    await connecter(context, GERANT);
  });

  test("le Bilan compare la période à la précédente", async ({ page }) => {
    await page.goto("/gestion?periode=30j");
    await expect(page.getByRole("heading", { name: "Bilan" })).toBeVisible();
    // La légende n'existe que lorsqu'il y a deux courbes.
    await expect(
      page.getByRole("listitem").filter({ hasText: "Période précédente" }),
    ).toBeVisible();
    // L'écart des indicateurs, dans son libellé accessible.
    await expect(
      page.getByText("par rapport à la période précédente").first(),
    ).toBeAttached();
    await expect(page.getByText("Meilleures ventes")).toBeVisible();
    await expect(page.getByText("Marge par produit")).toBeVisible();
  });

  test("sur « Tout », rien n'est comparé", async ({ page }) => {
    await page.goto("/gestion");
    await expect(page.getByRole("heading", { name: "Bilan" })).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Période précédente" }),
    ).toHaveCount(0);
  });

  test("le tri d'un tableau passe par l'URL et s'inverse au second clic", async ({ page }) => {
    await page.goto(FICHE);
    const entete = page.getByRole("columnheader", { name: "Montant" });
    await entete.getByRole("link").click();
    await expect(page).toHaveURL(/tri=montant/);
    await expect(entete).toHaveAttribute("aria-sort", "ascending");

    await entete.getByRole("link").click();
    await expect(page).toHaveURL(/ordre=desc/);
    await expect(entete).toHaveAttribute("aria-sort", "descending");
  });

  test("les ventes d'un vendeur sont paginées", async ({ page }) => {
    await page.goto(FICHE);
    // Deux listes paginées sur l'écran : on vise celle des ventes.
    const ventes = page
      .locator("[data-slot=card]")
      .filter({ hasText: "Ses ventes" });
    await expect(ventes.getByText("Page 1 sur 3")).toBeVisible();
    await ventes.getByRole("link", { name: "Page suivante" }).click();
    await expect(ventes.getByText("Page 2 sur 3")).toBeVisible();
    await expect(page).toHaveURL(/[?&]page=2/);
  });

  test("la recherche porte sur toutes les pages, et % n'est pas un joker", async ({ page }) => {
    await page.goto(FICHE);
    const champ = page.getByRole("searchbox", { name: "Rechercher un client" });
    await champ.fill("100%");
    await champ.press("Enter");
    await expect(page).toHaveURL(/q=100/);
    const lignes = page
      .locator("[data-slot=card]")
      .filter({ hasText: "Ses ventes" })
      .locator("tbody tr");
    // 57 ventes, 8 clients à tour de rôle : 7 portent ce nom, sur trois pages.
    await expect(lignes).toHaveCount(7);
    for (const ligne of await lignes.all()) {
      await expect(ligne).toContainText("100% coton");
    }
  });

  test("l'export CSV neutralise les formules", async ({ page }) => {
    const reponse = await page.request.get("/gestion/comptabilite/export");
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()["content-type"]).toContain("text/csv");
    const csv = await reponse.text();
    expect(csv).toContain("Mme Roche");
    // Une cellule qui COMMENCE par « = » est précédée d'une apostrophe : Excel
    // l'affiche au lieu de l'exécuter. Au milieu d'un texte, « = » est inoffensif.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|;)"?=HYPERLINK/m);
  });

  test("Ctrl+K mène à la fiche d'un vendeur", async ({ page }) => {
    await page.goto("/gestion");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Rechercher" }).fill("yan");
    await expect(page.getByRole("option", { name: /Yanis Morel/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${FICHE}$`));
  });

  test("la suggestion de réassort suit la période choisie", async ({ page }) => {
    await page.goto("/gestion/stock");
    const carte = page
      .locator("[data-slot=card]")
      // Le titre porte le total : lui seul distingue la carte des cartes de
      // ligne qu'elle contient sur téléphone.
      .filter({ hasText: /À commander \(\d+ u\)/ });
    await expect(carte).toBeVisible();
    await carte.getByRole("link", { name: "60 j" }).click();
    await expect(page).toHaveURL(/jours=60/);
    await expect(carte.getByText("60 jours de plus")).toBeVisible();

    // Le dialogue d'achat s'ouvre pré-rempli des quantités proposées.
    await carte.getByRole("button", { name: "Préparer le restock" }).click();
    const dialogue = page.getByRole("dialog");
    await expect(dialogue).toBeVisible();
    await expect(dialogue.locator('input[type="number"][value]:not([value=""])').first()).toBeVisible();
  });

  test("un versement a son reçu imprimable", async ({ page }) => {
    await page.goto(FICHE);
    await page.getByRole("link", { name: "Reçu" }).first().click();
    await expect(page.getByRole("heading", { name: "Reçu de versement" })).toBeVisible();
    await expect(page.getByText("Montant reçu")).toBeVisible();
    await expect(page.getByText("Reste à verser")).toBeVisible();
    await expect(page.getByRole("button", { name: /Imprimer/ })).toBeVisible();
  });

  test("la déconnexion demande confirmation", async ({ page }) => {
    await page.goto("/gestion");
    await page.getByRole("button", { name: /Menu du compte/ }).click();
    await page.getByRole("menuitem", { name: "Déconnexion" }).click();
    await expect(page.getByRole("heading", { name: "Se déconnecter ?" })).toBeVisible();
    await page.getByRole("button", { name: "Rester connecté" }).click();
    await expect(page).toHaveURL(/\/gestion$/);
  });
});
