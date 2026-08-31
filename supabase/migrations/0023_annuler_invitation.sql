-- ============================================================
-- StockFlow — 0023_annuler_invitation.sql
-- Retirer une invitation qui n'a pas servi.
-- ============================================================
-- Une invitation reste en base tant qu'aucun compte n'a été créé avec son
-- adresse : c'est ce qui permet de reprendre une création interrompue entre la
-- première et la seconde étape. Mais rien ne permettait de la retirer, et
-- l'écran Vendeurs affichait alors indéfiniment un avertissement sur une
-- invitation devenue sans objet.
--
-- LA GARDE EST PLUS FAIBLE QUE POUR LA CRÉATION, et c'est délibéré.
--
-- `inviter_utilisateur` appelle `exiger_gestion_de(p_role)` : on ne peut
-- inviter qu'un niveau strictement inférieur au sien. Reprendre cette règle
-- ici rendrait une invitation `dev` indestructible — aucun niveau n'est
-- supérieur à 3 — alors que c'est précisément celle de l'amorçage, celle qui
-- traîne le plus souvent.
--
-- L'asymétrie se justifie par ce que chaque geste produit : créer une
-- invitation OUVRE un accès futur, la retirer le FERME. Retirer ne peut donc
-- élever personne, dans aucun scénario. Seule la garde `est_admin()` reste
-- nécessaire, pour qu'un vendeur ne puisse pas saboter l'arrivée d'un collègue.
--
-- Une invitation DÉJÀ CONSOMMÉE est refusée : elle est la trace de l'origine
-- d'un compte, et le trigger d'inscription ne la relit jamais. L'effacer ne
-- libérerait rien et perdrait une information.
-- ------------------------------------------------------------

create or replace function annuler_invitation(p_email text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_util  boolean;
begin
  if not est_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select utilisee into v_util from invitations where email = v_email;
  if not found then
    raise exception 'Invitation introuvable.' using errcode = '02000';
  end if;

  if v_util then
    raise exception
      'Cette invitation a déjà servi à créer un compte : elle ne se retire pas.'
      using errcode = '23514';
  end if;

  delete from invitations where email = v_email;
end $$;

comment on function annuler_invitation(text) is
  'Retire une invitation NON consommée. Garde volontairement plus faible que inviter_utilisateur : retirer ne peut élever personne.';

grant execute on function annuler_invitation(text) to authenticated;
