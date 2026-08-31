-- ============================================================
-- StockFlow — Blocage d'adresse IP
-- ============================================================

-- ============================================================
-- Blocage d'adresse IP : persistant, croissant, jamais définitif d'office.
-- ============================================================
-- Les deux premiers paliers de l'anti-bourrage vivent en mémoire du processus
-- Next : ils ne font que ralentir, et un attaquant ne provoque pas de
-- redémarrage. Le troisième, lui, doit survivre à `docker compose up --build`,
-- qui a lieu plusieurs fois par jour. D'où la base.
--
-- DÉCLENCHEUR : cinq adresses e-mail DISTINCTES échouées depuis la même IP.
-- Pas « beaucoup d'échecs ». Bloquer une IP bloque tout le monde derrière
-- elle, or les vendeurs sont sur téléphone, donc derrière le NAT d'un
-- opérateur. Compter les échecs mettrait un vendeur dehors parce qu'un inconnu
-- du même opérateur a tapé à côté. Compter les adresses essayées est la
-- signature du bourrage d'identifiants, qu'un utilisateur légitime ne peut pas
-- produire : il n'a qu'une adresse.
--
-- DURÉE CROISSANTE, jamais définitive d'office. Une IP n'est pas une identité :
-- les adresses résidentielles changent au redémarrage de la box, celles des
-- opérateurs mobiles tournent en permanence. Celle qui attaque aujourd'hui
-- appartiendra à quelqu'un d'autre dans trois semaines, et un blocage définitif
-- accumulerait des interdictions sur des adresses redevenues légitimes. La
-- panne arriverait des mois plus tard, silencieuse.
--
--   1ʳᵉ fois  15 minutes      3ᵉ fois  24 heures
--   2ᵉ fois    1 heure        4ᵉ et +   7 jours
--
-- Une adresse réellement hostile finit à sept jours renouvelés, ce qui équivaut
-- à un blocage. Une adresse recyclée se libère seule.
--
-- Le définitif existe, mais comme GESTE HUMAIN : `bloquer_ip_definitivement()`,
-- déclenchée depuis l'écran, visible et réversible.
-- ------------------------------------------------------------

create table if not exists ip_bloquees (
  ip         text primary key,
  bloquee_le timestamptz not null default now(),
  -- NULL = définitif, posé à la main. Toute valeur non nulle est une échéance
  -- que `ip_est_bloquee` fait respecter sans intervention.
  jusqu_a    timestamptz,
  recidive   int not null default 1 check (recidive > 0),
  motif      text,
  posee_par  uuid references profils(id) on delete set null
);

alter table ip_bloquees enable row level security;
