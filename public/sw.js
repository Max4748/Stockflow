// Service worker minimal : il existe pour rendre l'application installable
// (icône sur l'écran d'accueil, ouverture en plein écran), rien de plus.
//
// AUCUNE page ni appel serveur n'est mis en cache, et c'est délibéré. Chaque
// écran de StockFlow reflète un stock et une dette calculés à l'instant : un
// mode hors-ligne servirait à un vendeur un stock qui n'existe plus ou une
// dette déjà réglée. Le registre de mouvements est la vérité, pas un cache.
//
// Seules les icônes sont mises en cache : leur contenu ne change jamais sans
// que le nom de cache change avec (voir scripts/generate-icons.mjs).

const CACHE = "stockflow-statique-v1";

const ASSETS_STATIQUES = [
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS_STATIQUES)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cles) =>
        Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (ASSETS_STATIQUES.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((reponse) => reponse ?? fetch(event.request)),
    );
    return;
  }

  // Tout le reste part au réseau, sans interception : pages, Server Actions,
  // appels Supabase. C'est ce qui garantit qu'un écran affiché est un écran à
  // jour.
});
