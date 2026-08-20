-- ============================================================
-- StockFlow — 0019_sav_revocation.sql
-- Le gérant voit, et révoque sans effacer.
-- ============================================================
--
-- CE QUE CE FICHIER CORRIGE. Un vendeur déclare un échange, qui prend effet
-- immédiatement (0015) : c'est le bon arbitrage, il a déjà remis l'unité au
-- client et refuser de l'écrire ferait mentir son stock. Le contrepoids annoncé
-- était « le gérant garde un recours ». Ce recours existait — `supprimer_sav()`
-- de 0014 — mais il souffrait de deux défauts qui le rendaient inopérant en
-- pratique :
--
--   1. RIEN N'AVERTISSAIT LE GÉRANT. `sav_non_vus()` (0016) filtre sur
--      `ventes.vendeur_id = auth.uid()` : c'est la pastille du VENDEUR. Côté
--      gestion, aucun signal. Le recours supposait que le gérant pense de
--      lui-même à ouvrir l'écran.
--
--   2. LE SEUL RECOURS DÉTRUISAIT LA PREUVE. `supprimer_sav()` fait un `delete`
--      sec : le stock revient, mais le dossier disparaît avec son motif, sa
--      date et son auteur. Or ce qui caractérise un abus n'est pas un incident,
--      c'est un MOTIF RÉPÉTÉ. Plus le gérant faisait son travail, moins il lui
--      restait de trace.
--
-- Le principe appliqué ici est déjà celui de 0015 pour un remboursement
-- refusé : « un refus est CONSERVÉ plutôt que supprimé, il fait partie de la
-- relation avec le vendeur ». Un échange abusif mérite le même traitement.
--
-- `supprimer_sav()` n'est pas retirée : elle garde son usage d'origine, la
-- saisie franchement erronée qu'on ne veut pas voir traîner dans l'historique.

-- ------------------------------------------------------------
-- La date de dernière consultation CÔTÉ GESTION.
--
-- Une seconde colonne plutôt que la réutilisation de `sav_vu_le` : un gérant
-- qui vend aussi (0013) utilise déjà celle-là dans son espace vendeur. Les
-- confondre éteindrait la pastille de gestion parce qu'il a consulté ses
-- propres dossiers — deux questions distinctes, deux colonnes.
-- ------------------------------------------------------------
alter table profils add column if not exists sav_gestion_vu_le timestamptz;

comment on column profils.sav_gestion_vu_le is
  'Dernière ouverture de l''écran Gestion → SAV. Sert uniquement à la pastille de nouveauté, jamais à une décision d''autorisation.';

-- ------------------------------------------------------------
-- Marquer comme vu, côté gestion.
--
-- Même nécessité qu'en 0016 : la policy `profils_admin_all` réserve l'écriture
-- aux gérants, et cette fonction n'écrit QUE `sav_gestion_vu_le`, QUE sur la
-- ligne de l'appelant.
-- ------------------------------------------------------------
create or replace function marquer_sav_gestion_vu()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  update profils set sav_gestion_vu_le = now() where id = auth.uid();
end $$;

grant execute on function marquer_sav_gestion_vu() to authenticated;

-- ------------------------------------------------------------
-- Ce qui est nouveau POUR LE GÉRANT.
--
-- Symétrique de `sav_non_vus()`, à deux différences près.
--
-- 1. AUCUN FILTRE SUR LE VENDEUR : le gérant surveille les dossiers de tout le
--    monde. C'est le manque que ce fichier corrige.
--
-- 2. SEULEMENT LES DOSSIERS VALIDÉS. L'`en_attente` est déjà compté par la
--    pastille du layout, qui répond à « qu'est-ce qui attend ma décision ? ».
--    Les deux ensembles restent ainsi DISJOINTS et leur somme est honnête ;
--    les confondre afficherait deux fois le même dossier.
--
--    Ce qui reste est exactement ce qui n'avait aucun signal : l'échange qu'un
--    vendeur a déclaré, validé d'emblée, et que personne n'a encore regardé.
--
-- La seconde condition de 0016 est reprise telle quelle, et pour la même
-- raison : un dossier que le gérant a lui-même ouvert ou arbitré ne s'annonce
-- pas à lui. Sans elle, la pastille s'allumerait sur ses propres gestes.
-- ------------------------------------------------------------
create or replace function sav_gestion_non_vus()
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_vu timestamptz;
  v_nb int;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select p.sav_gestion_vu_le into v_vu from profils p where p.id = auth.uid();

  select count(*) into v_nb
    from sav s
   where s.statut = 'valide'
     and coalesce(s.traite_le, s.cree_le) > coalesce(v_vu, '-infinity'::timestamptz)
     and coalesce(s.traite_par, s.cree_par) is distinct from auth.uid();

  return coalesce(v_nb, 0);
end $$;

grant execute on function sav_gestion_non_vus() to authenticated;

-- ------------------------------------------------------------
-- Révoquer un dossier DÉJÀ VALIDÉ, en le conservant.
--
-- `refuser_sav()` (0015) ne traite que l'`en_attente` — un remboursement qui
-- n'a encore rien produit. Ici le dossier a produit ses effets : il faut les
-- défaire, et c'est ce qui distingue les deux fonctions.
--
-- Les deux dénouements se défont différemment, et aucun des deux ne demande de
-- calcul :
--
--   ÉCHANGE       — supprimer le mouvement rend l'unité à son détenteur, par le
--                   même chemin que `supprimer_sav()` empruntait via son
--                   `on delete cascade`. Le verrou est pris AVANT, comme tout
--                   chemin d'écriture du stock (voir donnees.md).
--
--   REMBOURSEMENT — rien à défaire explicitement : tous les agrégats filtrent
--                   sur `statut = 'valide'` (0015). Le passage à `refuse`
--                   rend donc son montant au chiffre d'affaires et à la dette
--                   du vendeur, sans une seule ligne d'arithmétique ici.
--
-- Le motif est OBLIGATOIRE, contrairement à celui de `refuser_sav()` : révoquer
-- après coup un dossier sur lequel le vendeur comptait demande de s'expliquer,
-- et c'est cette trace qui rend un abus répété visible.
-- ------------------------------------------------------------
create or replace function revoquer_sav(p_sav_id uuid, p_motif text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s      sav;
  v_motif  text := nullif(trim(coalesce(p_motif, '')), '');
  v_source uuid;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  if v_motif is null then
    raise exception 'Un motif est obligatoire pour révoquer un dossier validé.'
      using errcode = '23514';
  end if;

  select * into v_s from sav where id = p_sav_id for update;
  if not found then
    raise exception 'Dossier SAV introuvable.' using errcode = '02000';
  end if;
  if v_s.statut <> 'valide' then
    raise exception 'Seul un dossier validé se révoque (statut : %).', v_s.statut
      using errcode = '23514';
  end if;

  -- L'échange a fait sortir une unité : elle revient à son détenteur d'origine,
  -- celui d'où elle était sortie — jamais à l'entrepôt.
  if v_s.resolution = 'echange' then
    v_source := (select m.detenteur_id from mouvements_stock m
                  where m.origine_sav_id = v_s.id limit 1);
    perform verrouiller_stock(v_s.produit_id, v_source);
    delete from mouvements_stock where origine_sav_id = v_s.id;
  end if;

  update sav
     set statut      = 'refuse',
         motif_refus = v_motif,
         traite_le   = now(),
         traite_par  = auth.uid()
   where id = p_sav_id;
end $$;

grant execute on function revoquer_sav(uuid, text) to authenticated;
