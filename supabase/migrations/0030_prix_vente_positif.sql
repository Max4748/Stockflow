-- ============================================================
-- StockFlow — 0030_prix_vente_positif.sql
-- Une vente à 0 € n'est pas une vente.
-- ============================================================
-- La contrainte d'origine (0003) autorisait `prix_vente_unitaire >= 0`, et le
-- garde-fou applicatif testait `p < 0`. Un champ de prix laissé vide donnait
-- `Number("") === 0`, qui franchissait les deux.
--
-- Ce n'était pas anodin : le chiffre d'affaires restait nul, mais la
-- commission du vendeur, elle, était figée à la ligne. Sa dette
-- (`ca - commissions - versements - remboursements`) passait donc NÉGATIVE,
-- c'est-à-dire que la maison lui devait de l'argent pour une vente qui n'avait
-- rien rapporté. Aucun invariant ne le signalait, `verifier_coherence_stock()`
-- ne regardant que le stock.
--
-- La règle appartient à la base, comme les autres : le contrôle applicatif
-- donne un message propre, la contrainte est ce qui tient. Donner de la
-- marchandise reste possible, mais par un ajustement de stock motivé, où le
-- geste est nommé au lieu d'être déguisé en vente.
-- ------------------------------------------------------------

alter table vente_lignes drop constraint if exists vente_lignes_prix_vente_unitaire_check;
alter table vente_lignes add constraint vente_lignes_prix_vente_unitaire_check
  check (prix_vente_unitaire > 0);
