-- ============================================================
-- Modèles et parfums : deux niveaux, un seul est une unité de stock.
-- ============================================================
-- Le stock se compte PAR PARFUM. Le modèle ne porte que ce qui lui appartient
-- vraiment : le prix conseillé et les deux seuils. Ce fichier vérifie les trois
-- propriétés qu'une simple colonne texte `modele` n'aurait pas données —
-- l'intégrité du rattachement, l'unicité scopée, et le tarif unique par modèle.
-- ------------------------------------------------------------

select plan(12);

select t_compte('m-dev@test.invalid',     'M-Dev',     'dev')        as dev     \gset
select t_compte('m-gerant@test.invalid',  'M-Gérant',  'gerant')     as gerant  \gset
select t_compte('m-vendeur@test.invalid', 'M-Vendeur', 'vendeur', 5) as vendeur \gset

reset role;
insert into modeles (nom, prix_vente_conseille, seuil_parfum, seuil_modele)
values ('M-Falcon', 14, 3, 10) returning id as falcon \gset
insert into modeles (nom, prix_vente_conseille, seuil_parfum, seuil_modele)
values ('M-Crystal', 9, 2, 0) returning id as crystal \gset

-- ---------- Le rattachement est obligatoire ----------
-- C'est ce qu'une colonne texte n'aurait pas donné : rien n'aurait empêché un
-- parfum sans modèle, ni « Falcon » et « falcon » de devenir deux familles.
select throws_ok(
  $$ insert into produits (nom) values ('Orphelin') $$,
  '23502', null, 'un parfum ne peut pas exister sans modèle');

select throws_ok(
  $$ insert into modeles (nom, prix_vente_conseille) values ('m-falcon', 1) $$,
  '23505', null, 'et deux modèles ne peuvent pas différer par la seule casse');

-- ---------- L'unicité du parfum est SCOPÉE au modèle ----------
insert into produits (modele_id, nom) values (:'falcon', 'Mangue') returning id as f_mangue \gset
insert into produits (modele_id, nom) values (:'falcon', 'Menthe') returning id as f_menthe \gset

select lives_ok(
  format($$ insert into produits (modele_id, nom) values (%L, 'Mangue') $$, :'crystal'),
  'deux modèles peuvent porter un parfum du même nom');

select throws_ok(
  format($$ insert into produits (modele_id, nom) values (%L, 'mangue') $$, :'falcon'),
  '23505', null, 'mais un modèle refuse deux fois le même, casse comprise');

-- ---------- Le tarif de prélèvement est PAR MODÈLE ----------
-- Un tarif posé une fois vaut pour tous les parfums : c'est le gain qui
-- justifie le modèle. Sur une colonne texte il aurait fallu le poser huit fois.
select t_agir(:'gerant') as _ \gset
select definir_prix_preleve(:'vendeur', :'falcon', 11) as _ \gset
reset role;

select is(prix_preleve(:'vendeur', :'f_mangue'), 11.00::numeric,
          'le tarif du modèle s''applique à un de ses parfums');
select is(prix_preleve(:'vendeur', :'f_menthe'), 11.00::numeric,
          'et au suivant, sans qu''on l''ait posé deux fois');

-- Le repli reste « prix du MODÈLE moins la commission » : 9 − 5 = 4.
insert into produits (modele_id, nom) values (:'crystal', 'Fraise') returning id as c_fraise \gset
select is(prix_preleve(:'vendeur', :'c_fraise'), 4.00::numeric,
          'sans tarif posé, le repli prend le prix du modèle moins la commission');

select t_agir(:'gerant') as _ \gset
select is((select nb_parfums from tarifs_preleves(:'vendeur') where modele_id = :'falcon'), 2,
          'l''écran de tarification compte les parfums de chaque modèle');
reset role;

-- ---------- Retrait ----------
select t_agir(:'dev') as _ \gset
insert into modeles (nom) values ('M-Vide') returning id as vide \gset
select lives_ok(format($$ select retirer_modele(%L) $$, :'vide'),
                'un modèle sans parfum est supprimé');
reset role;
select is((select count(*)::int from modeles where id = :'vide'), 0,
          'et il ne reste rien de lui');

-- Désactiver un modèle désactive ses parfums : le prix vit sur lui, un parfum
-- sans prix n'est pas vendable.
select t_agir(:'dev') as _ \gset
select retirer_modele(:'falcon') as _ \gset
reset role;
select is((select actif from modeles where id = :'falcon'), false,
          'un modèle avec parfums est désactivé, pas supprimé');
select is((select bool_and(not actif) from produits where modele_id = :'falcon'), true,
          'et ses parfums le suivent, faute de prix pour être vendus');
