/**
 * Couleur d'une pastille de statut, pour les demandes de réassort comme pour
 * les dossiers SAV.
 *
 * Quatre écrans tenaient chacun leur table, en noir, gris et rouge : « en
 * attente » et « annulé » étaient deux gris, « approuvé » et « validé » un
 * aplat noir sans rapport avec une bonne nouvelle. Une seule table, et une
 * couleur par SENS :
 *
 *   • alerte      : quelqu'un doit encore trancher ;
 *   • succes      : accordé en entier ;
 *   • info        : accordé en partie, ni une bonne ni une mauvaise nouvelle ;
 *   • destructive : refusé ;
 *   • outline     : annulé, sans effet, donc sans couleur.
 *
 * La couleur ne porte jamais l'information seule : le libellé est toujours
 * écrit dans la pastille.
 */
export type VarianteStatut =
  "alerte" | "succes" | "info" | "destructive" | "outline";

export const VARIANTE_STATUT: Record<string, VarianteStatut> = {
  en_attente: "alerte",
  approuvee: "succes",
  valide: "succes",
  partielle: "info",
  refusee: "destructive",
  refuse: "destructive",
  annulee: "outline",
  annule: "outline",
};
