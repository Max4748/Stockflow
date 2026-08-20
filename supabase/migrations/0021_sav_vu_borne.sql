-- ============================================================
-- StockFlow — 0021_sav_vu_borne.sql
-- Les pastilles SAV marquent « vu jusqu'à », plus « vu maintenant ».
-- ============================================================
-- Les deux fonctions de marquage posaient `now()`. Or elles sont appelées
-- depuis un effet de montage, donc APRÈS que la page a été rendue — et le
-- rendu est ce qui a réellement montré les dossiers. Entre les deux, il y a
-- une fenêtre :
--
--   t0  la page lit dossiers_sav() et affiche ce qu'elle a lu
--   t1  un vendeur déclare un SAV        ← jamais affiché
--   t2  l'effet se déclenche : vu_le = now() = t2 > t1
--
-- Le dossier de t1 est réputé vu alors que personne ne l'a affiché, et sa
-- pastille ne s'allumera jamais. La fenêtre dure le temps de l'hydratation :
-- courte, mais c'est exactement le moment où les dossiers arrivent, puisque
-- c'est le gérant qui ouvre l'écran parce qu'il y en a.
--
-- Le correctif ne change pas la mécanique, seulement l'horodatage retenu :
-- l'appelant transmet la borne de ce qu'il a AFFICHÉ, et c'est elle qui est
-- enregistrée. Un dossier arrivé après le rendu reste donc non vu.
--
-- Deux bornes encadrent le paramètre, parce qu'il vient du navigateur :
--   greatest(...) — une marque ne recule jamais. Deux onglets ouverts, celui
--                   qui poste la borne la plus ancienne ne rallume rien.
--   least(..., now()) — une borne dans le futur est ramenée à maintenant.
--                   Sans ça, un appelant s'aveuglerait définitivement.
--
-- `drop` obligatoire avant le `create` : ajouter un paramètre à défaut ne
-- remplace pas l'ancienne signature, il en ajoute une seconde, et
-- `marquer_sav_vu()` deviendrait un appel ambigu.
-- ------------------------------------------------------------

drop function if exists marquer_sav_vu();
drop function if exists marquer_sav_gestion_vu();

create or replace function marquer_sav_vu(p_vu_jusqu_a timestamptz default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  update profils
     set sav_vu_le = greatest(coalesce(sav_vu_le, '-infinity'::timestamptz),
                              least(coalesce(p_vu_jusqu_a, now()), now()))
   where id = auth.uid();
end $$;

create or replace function marquer_sav_gestion_vu(p_vu_jusqu_a timestamptz default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  update profils
     set sav_gestion_vu_le = greatest(coalesce(sav_gestion_vu_le, '-infinity'::timestamptz),
                                      least(coalesce(p_vu_jusqu_a, now()), now()))
   where id = auth.uid();
end $$;

grant execute on function marquer_sav_vu(timestamptz) to authenticated;
grant execute on function marquer_sav_gestion_vu(timestamptz) to authenticated;
