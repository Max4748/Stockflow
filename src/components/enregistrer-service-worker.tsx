"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker, ce qui rend l'application installable.
 *
 * L'échec est volontairement silencieux : sans service worker StockFlow
 * fonctionne exactement pareil, seule la proposition d'installation sur
 * l'écran d'accueil disparaît. Faire remonter une erreur ici alarmerait un
 * vendeur sur un navigateur qui ne les prend pas en charge, pour rien.
 */
export function EnregistrerServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
