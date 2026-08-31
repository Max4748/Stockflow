/**
 * Génère les icônes PWA dans public/ à partir de scripts/icon-source.svg.
 *
 *     node scripts/generate-icons.mjs
 *
 * Les PNG produits sont COMMITÉS, jamais régénérés au build : `sharp` est une
 * dépendance de développement, elle n'a pas à exister sur le serveur. Après
 * toute modification du SVG source, relancer cette commande ET incrémenter le
 * nom de cache dans public/sw.js, sinon les navigateurs qui ont déjà installé
 * l'application garderont les anciennes icônes.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "..", "public");
const SOURCE = readFileSync(join(DIR, "icon-source.svg"));

// Fond du SVG source. Repris ici pour que le rembourrage des icônes
// « maskable » soit du même noir, et non transparent.
const FOND = "#1b1b1b";

async function standard(nom, taille) {
  await sharp(SOURCE).resize(taille, taille).png().toFile(join(OUT, nom));
  console.log(`  ${nom} (${taille}×${taille})`);
}

async function maskable(nom, taille) {
  // Android rogne les icônes « maskable » selon un masque qui peut être
  // circulaire : tout ce qui sort d'une zone de sécurité centrale disparaît.
  // Le motif est donc réduit à 72 % et centré sur un canevas plein.
  const contenu = Math.round(taille * 0.72);
  const motif = await sharp(SOURCE).resize(contenu, contenu).png().toBuffer();
  await sharp({ create: { width: taille, height: taille, channels: 4, background: FOND } })
    .composite([{ input: motif, gravity: "center" }])
    .png()
    .toFile(join(OUT, nom));
  console.log(`  ${nom} (${taille}×${taille}, motif à ${contenu}px)`);
}

console.log("Icônes standard :");
await standard("icon-192.png", 192);
await standard("icon-512.png", 512);
await standard("apple-touch-icon.png", 180);
await standard("favicon-32.png", 32);

console.log("Icônes maskable :");
await maskable("icon-maskable-192.png", 192);
await maskable("icon-maskable-512.png", 512);

console.log("terminé");
