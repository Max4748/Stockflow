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
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "..", "public");
const SOURCE = readFileSync(join(DIR, "icon-source.svg"));

// Fond du SVG source. Repris ici pour que le rembourrage des icônes
// « maskable » soit du même noir, et non transparent.
const FOND = "#1957d2";

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

// `src/app/favicon.ico` : Next le sert d'office à la racine, et c'est lui que
// demandent les navigateurs qui ignorent `<link rel="icon">`. Il restait celui
// du gabarit Next. Un .ico est un petit conteneur qui accepte un PNG tel quel
// (depuis Windows Vista) : six octets d'en-tête, seize de répertoire, puis
// l'image. Pas besoin d'un encodeur.
async function favicon() {
  const png = await sharp(SOURCE).resize(48, 48).png().toBuffer();
  const entete = Buffer.alloc(22);
  entete.writeUInt16LE(1, 2); // type : icône
  entete.writeUInt16LE(1, 4); // une image
  entete.writeUInt8(48, 6); // largeur
  entete.writeUInt8(48, 7); // hauteur
  entete.writeUInt16LE(1, 10); // plans
  entete.writeUInt16LE(32, 12); // bits par pixel
  entete.writeUInt32LE(png.length, 14);
  entete.writeUInt32LE(22, 18); // décalage de l'image
  writeFileSync(join(DIR, "..", "src", "app", "favicon.ico"), Buffer.concat([entete, png]));
  console.log("  src/app/favicon.ico (48×48)");
}
console.log("Favicon :");
await favicon();

console.log("terminé");
