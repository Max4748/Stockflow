-- ============================================================
-- StockFlow — Vues de lecture et triggers
-- ============================================================
-- Après la couche 20 : `v_lignes_vente` appelle `est_admin()`, et le trigger
-- `on_auth_user_created` appelle `gerer_nouvel_utilisateur()`. Le corps d'une
-- vue comme la fonction d'un trigger sont résolus à la création.
-- ------------------------------------------------------------

-- ============================================================
-- Les agrégats ne comptent QUE les dossiers validés.
--
-- Un dossier en attente n'a produit aucun effet : le compter ferait baisser un
-- chiffre d'affaires sur la foi d'une simple demande.
-- ============================================================

create or replace view v_comptes_vendeurs as
select
  pr.id                                       as vendeur_id,
  pr.nom,
  pr.role,
  pr.actif,
  pr.commission_unitaire,
  coalesce(v.ca, 0)::numeric(12,2)            as ca,
  coalesce(v.nb_ventes, 0)::int               as nb_ventes,
  coalesce(v.qte_vendue, 0)::int              as qte_vendue,
  coalesce(c.commissions, 0)::numeric(12,2)   as commissions,
  coalesce(ve.verse, 0)::numeric(12,2)        as verse,
  coalesce(sv.rembourse, 0)::numeric(12,2)    as rembourse,
  case when pr.role <> 'vendeur' then 0::numeric(12,2)
       else (coalesce(v.ca, 0) - coalesce(c.commissions, 0)
             - coalesce(ve.verse, 0) - coalesce(sv.rembourse, 0))::numeric(12,2)
  end                                         as reste_a_verser
from profils pr
left join (
  select vendeur_id,
         sum(montant_total)   as ca,
         count(*)             as nb_ventes,
         sum(quantite_totale) as qte_vendue
    from ventes group by vendeur_id
) v on v.vendeur_id = pr.id
left join (
  select ve2.vendeur_id,
         sum(vl.quantite * vl.commission_unitaire) as commissions
    from ventes ve2
    join vente_lignes vl on vl.vente_id = ve2.id
   group by ve2.vendeur_id
) c on c.vendeur_id = pr.id
left join (
  select vendeur_id, sum(montant) as verse
    from versements group by vendeur_id
) ve on ve.vendeur_id = pr.id
left join (
  select v3.vendeur_id, sum(s.montant_rembourse) as rembourse
    from sav s join ventes v3 on v3.id = s.vente_id
   where s.statut = 'valide'
   group by v3.vendeur_id
) sv on sv.vendeur_id = pr.id;

-- ============================================================
-- Lectures : stock, tableau de bord, journal comptable.
-- ============================================================
-- Toutes les agrégations sont faites en SQL. PostgREST tronque à
-- PGRST_DB_MAX_ROWS (1000) : un total reconstitué côté client depuis une
-- réponse tronquée serait FAUX SANS AUCUNE ERREUR.

-- ------------------------------------------------------------
-- Lignes de vente visibles par un vendeur.
--
-- ⚠️⚠️ NE JAMAIS AJOUTER cout_unitaire NI AUCUN CALCUL DE MARGE ICI. ⚠️⚠️
-- Cette vue est le seul accès des vendeurs au détail de leurs ventes. Y
-- ajouter une colonne de coût livrerait la marge de l'entreprise à tous les
-- vendeurs, sans erreur, sans alerte et sans que rien ne casse.
-- ------------------------------------------------------------
create or replace view v_lignes_vente as
select vl.id, vl.vente_id, v.vendeur_id, v.date, v.client,
       vl.produit_id, p.nom as produit,
       vl.quantite, vl.prix_vente_unitaire,
       vl.commission_unitaire,
       (vl.quantite * vl.prix_vente_unitaire)::numeric(12,2) as montant_ligne,
       (vl.quantite * vl.commission_unitaire)::numeric(12,2) as commission_ligne
  from vente_lignes vl
  join ventes   v on v.id = vl.vente_id
  join produits p on p.id = vl.produit_id
 -- Filtre INDISPENSABLE : cette vue appartient à postgres et contourne donc
 -- la RLS de vente_lignes. Sans cette clause, un vendeur lirait le détail des
 -- ventes de tous ses collègues. Ce n'est pas une commodité, c'est la seule
 -- barrière d'isolation de la vue.
 where v.vendeur_id = auth.uid() or est_admin();

-- ------------------------------------------------------------
-- Vues de stock. FERMÉES à authenticated/anon en couche 40 : elles ignorent la
-- notion d'appelant, l'accès public passe par les fonctions à garde.
-- ------------------------------------------------------------
create or replace view v_stock_detenteur as
select detenteur_id, produit_id, sum(quantite)::int as quantite
  from mouvements_stock
 group by detenteur_id, produit_id;

create or replace view v_stock_produit as
select p.id as produit_id, p.nom, p.actif, p.seuil_alerte,
       coalesce(sum(m.quantite) filter (where m.detenteur_id is null), 0)::int     as stock_entrepot,
       coalesce(sum(m.quantite) filter (where m.detenteur_id is not null), 0)::int as stock_distribue,
       coalesce(sum(m.quantite), 0)::int                                           as stock_total
  from produits p
  left join mouvements_stock m on m.produit_id = p.id
 group by p.id, p.nom, p.actif, p.seuil_alerte;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function gerer_nouvel_utilisateur();
