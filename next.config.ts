import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Sortie autonome, pour l'image Docker.
   *
   * `next build` trace les fichiers réellement atteints et produit
   * `.next/standalone` : un `server.js` et les seules dépendances utilisées.
   * Sans cette option, l'image devrait embarquer tout `node_modules` et le code
   * source pour démarrer — voir le Dockerfile.
   */
  output: "standalone",
};

export default nextConfig;
