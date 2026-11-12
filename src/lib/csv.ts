/**
 * Fabrication d'un CSV lisible par Excel en français, sans dépendance.
 *
 * Quatre choix, chacun pour une raison qu'on ne retrouve pas en lisant le
 * fichier produit :
 *
 *   • séparateur `;` et décimales à VIRGULE : un Excel réglé en français lit
 *     la virgule comme séparateur décimal. Avec des `,` entre les colonnes et
 *     des `.` dans les montants, il met tout dans la première colonne ou prend
 *     12.50 pour du texte ;
 *   • BOM UTF-8 en tête : sans lui, Excel ouvre le fichier en Windows-1252 et
 *     « Inès » devient « InÃ¨s » ;
 *   • fins de ligne CRLF, comme le demande la RFC 4180 ;
 *   • NEUTRALISATION DES FORMULES. Un nom de client ou un motif de SAV est une
 *     saisie libre : une cellule qui commence par `=`, `+`, `-` ou `@` est
 *     exécutée comme une formule à l'ouverture. On la préfixe d'une apostrophe,
 *     qu'Excel traite comme « ceci est du texte ». Les NOMBRES ne passent pas
 *     par là : un montant négatif doit rester un nombre.
 */

export type CelluleCsv = string | number | null | undefined;

const DANGEREUX = /^[=+\-@\t\r]/;

export function celluleCsv(v: CelluleCsv): string {
  if (v === null || v === undefined) return "";

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // Pas de séparateur de milliers : Excel le lirait comme du texte.
    return String(v).replace(".", ",");
  }

  const texte = DANGEREUX.test(v) ? `'${v}` : v;
  // Guillemets dès que la cellule contient le séparateur, un guillemet ou un
  // saut de ligne ; un guillemet se double.
  return /[";\r\n]/.test(texte) ? `"${texte.replaceAll('"', '""')}"` : texte;
}

export function versCsv(entetes: string[], lignes: CelluleCsv[][]): string {
  const corps = [entetes, ...lignes]
    .map((ligne) => ligne.map(celluleCsv).join(";"))
    .join("\r\n");
  return `﻿${corps}\r\n`;
}
