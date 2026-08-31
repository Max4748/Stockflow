-- ============================================================
-- StockFlow — Journaux
-- ============================================================

-- ============================================================
-- Qui a fait quoi sur les comptes.
-- ============================================================
-- Les sept fonctions qui touchent un compte n'écrivaient aucune trace. Créer
-- un accès, changer un rôle, désactiver quelqu'un : rien ne restait de qui
-- l'avait fait ni de ce qu'il y avait avant. Sur un dispositif à plusieurs
-- gérants, c'est l'angle mort qui rend un désaccord insoluble.
--
-- DEUX PROPRIÉTÉS, et elles se tiennent :
--
--   La trace est écrite DANS LA MÊME TRANSACTION que l'action. Si l'insertion
--   échoue, l'action échoue avec elle. Une trace « au mieux » est une trace
--   absente le jour où elle compte.
--
--   La valeur AVANT est relevée avant l'`update`, sans quoi elle est déjà
--   perdue. C'est le seul point délicat des sept, et la raison pour laquelle
--   chaque fonction est réécrite plutôt qu'enveloppée dans un trigger : un
--   trigger sur `profils` verrait le changement, mais pas l'INTENTION (quelle
--   fonction, quel motif), ni les actions qui n'écrivent pas dans `profils`,
--   comme l'invitation.
--
-- Lecture réservée au dev : la liste dit qui surveille qui, et n'a rien à
-- faire sous les yeux d'un gérant surveillé.
-- ------------------------------------------------------------

create table if not exists journal_admin (
  id        uuid primary key default gen_random_uuid(),
  cree_le   timestamptz not null default now(),
  -- `set null` et non `restrict` : retirer un compte ne doit pas être empêché
  -- par les traces qu'il a laissées, et une trace sans acteur reste lisible
  -- grâce à `acteur_nom`.
  acteur    uuid references profils(id) on delete set null,
  acteur_nom text,
  cible     uuid references profils(id) on delete set null,
  cible_nom text,
  action    text not null,
  avant     jsonb,
  apres     jsonb
);

-- ============================================================
-- Ce qui est supprimé laisse une trace.
-- ============================================================
-- Le journal comptable est DÉRIVÉ de l'état courant : il lit `ventes`,
-- `restocks`, `versements`, `sav`. Conséquence directe, tout ce qu'une
-- suppression retire disparaît aussi du journal. Un achat de 345 € annulé, un
-- versement effacé, un SAV supprimé : le total change et rien n'explique
-- pourquoi.
--
-- Les ventes annulées avaient déjà leur réponse (`ventes_annulees`), mais
-- elle était propre aux ventes. Six autres opérations restaient muettes.
--
-- POURQUOI UNE TABLE PLUTÔT QU'UNE ARCHIVE PAR ENTITÉ. Archiver chaque type
-- supprimé demanderait une table jumelle par table, et six de plus à tenir à
-- jour. Ici on n'archive pas l'entité, on enregistre le GESTE : qui, quoi,
-- quand, et de quoi il s'agissait. C'est ce que le journal a besoin d'afficher,
-- et ça ne dépend pas de la forme de l'entité.
--
-- POURQUOI PAS `journal_admin`. Celui-là est réservé au dev, parce qu'il dit
-- qui surveille qui. Un achat annulé regarde tout l'encadrement : c'est une
-- opération comptable, pas une action d'administration. D'où deux tables, deux
-- portées, et deux écrans.
-- ------------------------------------------------------------

create table if not exists journal_operations (
  id        uuid primary key default gen_random_uuid(),
  cree_le   timestamptz not null default now(),
  acteur    uuid references profils(id) on delete set null,
  acteur_nom text,
  -- Le type d'entité et son identifiant d'ORIGINE. L'entité n'existe
  -- généralement plus : l'identifiant sert à relier la trace aux mouvements de
  -- stock, qui le citent dans leur motif.
  entite    text not null,
  entite_id uuid,
  action    text not null,
  -- Rédigé au moment du geste, quand l'entité existe encore. Le reconstruire
  -- après coup serait impossible, c'est tout l'objet de cette table.
  libelle   text not null,
  quantite  int,
  montant   numeric(12,2),
  detail    jsonb
);

create index if not exists idx_journal_admin_date on journal_admin (cree_le desc);

create index if not exists idx_journal_operations_date
  on journal_operations (cree_le desc);

alter table journal_admin enable row level security;

alter table journal_operations enable row level security;
