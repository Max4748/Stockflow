-- ============================================================
-- StockFlow — Catalogue : modèles et parfums
-- ============================================================
-- Le catalogue a DEUX niveaux, et un seul des deux est une unité de stock.
--
-- Un modèle (« JNR Falcon X 18K ») existe en plusieurs parfums. Le stock se
-- compte PAR PARFUM — « 3 mangue, 5 menthe », jamais « 8 Falcon X ». Le parfum
-- est donc l'unité de stock, et c'est `produits` qui le porte : les 219
-- références à `produit_id` réparties sur dix tables et vues — mouvements,
-- ventes, SAV, prélèvements, réassorts — ne bougent pas d'une ligne. Le CUMP et
-- la comptabilité ne savent même pas que les modèles existent.
--
-- CE QUI MONTE AU MODÈLE, et pourquoi une colonne texte `modele` sur `produits`
-- n'aurait pas suffi : trois attributs appartiennent au modèle, pas au parfum.
-- Sur une colonne texte ils seraient recopiés sur chaque parfum — huit copies du
-- prix pour huit parfums, sans autorité sur celle qui fait foi — et rien
-- n'empêcherait « Falcon X » et « falcon x » de devenir deux modèles distincts
-- en silence. Une table donne une clé étrangère, donc une seule vérité.
-- ------------------------------------------------------------

create table if not exists modeles (
  id                   uuid primary key default gen_random_uuid(),
  nom                  text not null,
  -- Prix indicatif proposé au vendeur à la saisie, PARTAGÉ par tous les parfums
  -- du modèle. Le prix réellement pratiqué reste figé par ligne de vente : ce
  -- champ n'a aucune valeur comptable, le modifier ne change aucun historique.
  prix_vente_conseille numeric(10,2) not null default 0 check (prix_vente_conseille >= 0),
  -- Seuil évalué PARFUM PAR PARFUM : savoir que la mangue est morte même quand
  -- la menthe est pleine.
  seuil_parfum         integer not null default 3 check (seuil_parfum >= 0),
  -- Seuil évalué sur le TOTAL du modèle, tous parfums confondus. Les deux
  -- répondent à deux questions différentes : « quel parfum manque » et « ce
  -- modèle est-il en train de s'éteindre ».
  --
  -- 0 = alerte désactivée, et c'est le défaut : un catalogue repris ne doit pas
  -- se mettre à crier au premier déploiement.
  seuil_modele         integer not null default 0 check (seuil_modele >= 0),
  actif                boolean not null default true,
  cree_le              timestamptz not null default now()
);

comment on table modeles is
  'Famille de produits partageant un prix conseillé et deux seuils d''alerte. Ce n''est PAS une unité de stock.';

-- Unicité insensible à la casse, même motif que les produits : « Falcon X » et
-- « falcon x » sont le même modèle.
create unique index if not exists idx_modeles_nom on modeles (lower(nom));

alter table modeles enable row level security;

-- ------------------------------------------------------------
-- Les parfums. `nom` ne porte que le parfum (« Mangue ») : l'affichage
-- concatène avec le modèle.
-- ------------------------------------------------------------
create table if not exists produits (
  id        uuid primary key default gen_random_uuid(),
  modele_id uuid not null references modeles(id) on delete restrict,
  nom       text not null,
  sku       text,
  actif     boolean not null default true,
  cree_le   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- REPRISE D'UNE BASE ANTÉRIEURE AUX MODÈLES.
--
-- Sans effet sur une base neuve : la colonne existe déjà, et les colonnes
-- montées n'ont jamais existé. Les instructions qui les lisent passent par
-- `execute`, donc elles ne sont analysées que si la branche est prise — un
-- `select prix_vente_conseille` écrit en clair ferait échouer le bloc à
-- l'analyse sur une base neuve, où la colonne n'existe pas.
-- ------------------------------------------------------------
alter table produits
  add column if not exists modele_id uuid references modeles(id) on delete restrict;

do $$
declare
  v_ancien record;
  v_modele uuid;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'produits'
       and column_name = 'prix_vente_conseille'
  ) then
    return;
  end if;

  -- Chaque produit d'avant devient un modèle à un seul parfum, portant son
  -- propre nom, son prix et son seuil. Le gérant regroupera ensuite à la main :
  -- deviner qu'« Falcon X Mangue » et « Falcon X Menthe » sont un même modèle
  -- serait une supposition sur ses données, pas une conversion.
  for v_ancien in
    execute 'select id, nom, prix_vente_conseille, seuil_alerte
               from produits where modele_id is null'
  loop
    select id into v_modele from modeles where lower(nom) = lower(v_ancien.nom);
    if v_modele is null then
      insert into modeles (nom, prix_vente_conseille, seuil_parfum)
      values (v_ancien.nom, v_ancien.prix_vente_conseille, v_ancien.seuil_alerte)
      returning id into v_modele;
    end if;
    update produits set modele_id = v_modele where id = v_ancien.id;
  end loop;
end $$;

-- Échoue bruyamment si un parfum est resté orphelin, ce qui est le comportement
-- voulu : mieux vaut un déploiement qui s'arrête qu'un catalogue à moitié converti.
alter table produits alter column modele_id set not null;

-- `v_stock_produit` lit `seuil_alerte` et `prix_preleve` lit
-- `prix_vente_conseille` — cette dernière est en `language sql`, donc son corps
-- est suivi par le catalogue et bloquerait la suppression. Les deux sont
-- recréées par les couches 20 et 30.
drop view if exists v_stock_produit;
drop function if exists prix_preleve(uuid, uuid);

alter table produits drop column if exists prix_vente_conseille;
alter table produits drop column if exists seuil_alerte;

-- L'unicité change de PORTÉE : un parfum est unique dans son modèle, pas dans
-- tout le catalogue. Sans ça, deux modèles ne pourraient pas avoir « Mangue ».
drop index if exists idx_produits_nom;
create unique index if not exists idx_produits_modele_nom
  on produits (modele_id, lower(nom));

-- Le SKU reste unique GLOBALEMENT : c'est une référence commerciale, elle ne se
-- réutilise pas d'un modèle à l'autre.
create unique index if not exists idx_produits_sku on produits (lower(sku))
  where sku is not null;

alter table produits enable row level security;
