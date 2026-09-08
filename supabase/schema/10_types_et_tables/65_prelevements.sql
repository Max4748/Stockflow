-- ============================================================
-- StockFlow — Prélèvements personnels
-- ============================================================
-- Un vendeur repart avec de la marchandise pour lui, à un prix convenu. Il n'a
-- encaissé aucun client : il DOIT donc ce prix à la maison, exactement comme le
-- reliquat d'une vente. `v_comptes_vendeurs` l'ajoute à `reste_a_verser`.
--
-- CE N'EST PAS UNE VENTE, et c'est pour ça que ces lignes ne vivent pas dans
-- `ventes`. Le chiffre d'affaires doit rester ce que des clients ont payé :
-- mélanger la consommation interne fausserait le CA, la marge, et le nombre de
-- ventes affiché à tout le monde. La dette, elle, ne fait pas la différence —
-- de l'argent dû est de l'argent dû.
--
-- LE PRIX EST UN COUPLE (vendeur, MODÈLE) : tous les parfums d'un modèle se
-- prélèvent au même tarif. Le prix par défaut vaut
-- `prix_vente_conseille - commission_unitaire` : c'est très exactement ce qu'un
-- vendeur devrait à la maison s'il avait vendu l'unité au prix conseillé. Un
-- prélèvement au tarif par défaut ne lui coûte donc ni plus ni moins que de
-- vendre puis racheter. `prix_preleve()` calcule ce repli ; la table ci-dessous
-- ne contient QUE les exceptions.
-- ------------------------------------------------------------

-- `modele_id` et la clé primaire sont posées plus bas, pour la même raison que
-- sur `produits` : une base convertie ne peut pas placer la colonne ailleurs
-- qu'en fin de table.
create table if not exists prix_preleves (
  vendeur_id uuid not null references profils(id) on delete cascade,
  prix       numeric(10,2) not null check (prix >= 0),
  defini_le  timestamptz not null default now(),
  defini_par uuid references profils(id) on delete set null
);

-- ------------------------------------------------------------
-- REPRISE : le tarif était par couple (vendeur, PARFUM).
--
-- Un modèle, un tarif : régler 5 modèles vaut mieux que 40 parfums. Sans effet
-- sur une base neuve, où `produit_id` n'a jamais existé.
-- ------------------------------------------------------------
alter table prix_preleves
  add column if not exists modele_id uuid references modeles(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'prix_preleves'
       and column_name = 'produit_id'
  ) then
    return;
  end if;

  execute 'update prix_preleves pp
              set modele_id = p.modele_id
             from produits p
            where p.id = pp.produit_id and pp.modele_id is null';

  -- Deux parfums d'un même modèle pouvaient porter deux tarifs distincts : ils
  -- entrent en collision sur la nouvelle clé. Le plus récent l'emporte, faute
  -- de règle métier pour départager.
  execute 'delete from prix_preleves a
            using prix_preleves b
            where a.vendeur_id = b.vendeur_id
              and a.modele_id  = b.modele_id
              and a.produit_id is distinct from b.produit_id
              and (a.defini_le, a.produit_id) < (b.defini_le, b.produit_id)';

  alter table prix_preleves drop constraint if exists prix_preleves_pkey;
  alter table prix_preleves drop column if exists produit_id;
end $$;

alter table prix_preleves alter column modele_id set not null;

-- Clé primaire posée à part et idempotente : la reprise l'a peut-être déjà
-- retirée, une base neuve ne l'a jamais eue.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'prix_preleves_pkey') then
    alter table prix_preleves add primary key (vendeur_id, modele_id);
  end if;
end $$;

comment on table prix_preleves is
  'Exceptions au tarif de prélèvement, PAR MODÈLE. Sans ligne, le repli est prix_vente_conseille - commission_unitaire.';

-- `restrict` sur le produit, comme `vente_lignes` : un produit qui a été
-- prélevé porte une trace comptable, le supprimer effacerait la contrepartie
-- d'une dette. `retirer_produit()` le désactive alors au lieu de le supprimer.
create table if not exists prelevements (
  id            uuid primary key default gen_random_uuid(),
  vendeur_id    uuid not null references profils(id) on delete restrict,
  produit_id    uuid not null references produits(id) on delete restrict,
  quantite      int not null check (quantite > 0),
  -- Figé à la prise, comme la commission d'une vente : changer le tarif plus
  -- tard ne doit pas réécrire une dette déjà constituée.
  prix_unitaire numeric(10,2) not null check (prix_unitaire >= 0),
  cree_le       timestamptz not null default now(),
  cree_par      uuid references profils(id) on delete set null
);

comment on table prelevements is
  'Marchandise reprise par un vendeur pour lui-même. Pèse sur sa dette, jamais sur le chiffre d''affaires.';

create index if not exists prelevements_vendeur_idx on prelevements (vendeur_id, cree_le desc);
create index if not exists prelevements_produit_idx on prelevements (produit_id);

alter table prix_preleves enable row level security;
alter table prelevements  enable row level security;
