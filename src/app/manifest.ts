import type { MetadataRoute } from "next";

/**
 * Rend l'application installable sur l'écran d'accueil.
 *
 * `display: standalone` retire la barre d'URL : l'espace vendeur est utilisé
 * debout, sur un téléphone, et chaque pixel rendu au contenu compte.
 * `orientation: portrait` parce qu'aucun écran n'est conçu pour le paysage —
 * les tableaux basculent en cartes sous `md`, pas l'inverse.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StockFlow — Gestion de stock",
    short_name: "StockFlow",
    description: "Stock, ventes et créances multi-vendeurs",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // Identiques au fond du thème sombre (oklch(0.185 0 0)) : l'écran de
    // démarrage doit être celui de l'application, pas un blanc qui flashe.
    background_color: "#1b1b1b",
    theme_color: "#1b1b1b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
