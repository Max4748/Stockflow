# Sécurité

## Le modèle de menace, en une phrase

La clé anon est **publique par construction** : elle voyage dans le bundle de
toute application Supabase classique, et même ici où elle n'est jamais exposée
au navigateur, il faut concevoir _comme si_ un attaquant l'avait. Un vendeur
authentifié peut donc attaquer PostgREST directement (`curl`, console du
navigateur), sans jamais passer par l'interface.

**Conséquence unique et absolue : l'interface n'est jamais une barrière de
sécurité, seulement du confort.** Toute règle qui compte est vérifiée en base.

## Les quatre couches, dans l'ordre où elles interviennent

### 1. RLS : qui voit quelle _ligne_

20 politiques. Le motif qui revient partout :

```sql
create policy ventes_select on ventes for select
  using (vendeur_id = auth.uid() or est_admin());
```

`est_admin()` est `security definer stable`, avec `set search_path = public,
pg_temp`. Appelée depuis une politique **sur `profils` elle-même**, une lecture
normale y redéclencherait la politique et boucle à l'infini ; en `definer` elle
lit la table sans repasser par la RLS.

### 2. GRANT / REVOKE : qui peut faire quelle _opération_

C'est la barrière qui protège les tables comptables, **indépendamment de la
RLS** :

```sql
revoke insert, update, delete on ventes, vente_lignes, profils, invitations,
  versements, restocks, restock_lignes, mouvements_stock
  from authenticated, anon;
```

Vérifié à l'exécution (`information_schema.role_table_grants`) : le rôle
`authenticated` n'a que `SELECT` sur ces tables. Toute écriture passe donc **par
une fonction**, jamais par une requête directe.

### 3. Garde en première ligne de chaque fonction

```sql
create or replace function creer_restock_fournisseur(...) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then
    raise exception 'Réservé aux gérants.' using errcode = '42501';
  end if;
  ...
```

`security definer` fait tourner la fonction avec les droits de son
propriétaire, pas de l'appelant, d'où l'obligation absolue de vérifier le rôle
**avant toute écriture**, en première ligne.

### 4. La garde applicative, rappelée dans chaque Server Action

```ts
export async function creerVendeur(_etat, formData) {
  await exigerAdmin();   // pas seulement dans le layout
  ...
```

Elle **ne protège rien par elle-même** : les trois couches SQL suffiraient. Son
rôle est de donner un message d'erreur propre plutôt qu'un échec brut, et
d'éviter l'appel réseau inutile. C'est pourquoi elle est répétée dans chaque
Server Action qui touche une donnée, plutôt que posée une seule fois au
layout : un layout ne protège que le _rendu_ d'une page, jamais l'appel direct
d'une Server Action, qui reste une URL comme une autre.

**Trois actions n'appellent aucun `exiger*`, et c'est voulu**. Ce sont celles
qui vivent avant l'autorisation :

| Action | Pourquoi |
| --- | --- |
| `seConnecter`, `seDeconnecter` | par définition sans session à exiger |
| `changerMotDePasse` | `exigerProfil()` **redirige vers `/changer-mot-de-passe`** quand `doit_changer_mdp` est levé : l'appeler ici ferait boucler la redirection sur elle-même |

`changerMotDePasse` n'est pas pour autant ouverte. Elle porte sa garde en clair,
un cran plus bas que les helpers :

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { erreur: "Session expirée. Se reconnecter." };
```

C'est le seul endroit du projet où la garde applicative est écrite à la main.
La raison tient à la hiérarchie de `auth.ts` : `exigerDev` appelle
`exigerAdmin`, qui appelle `exigerProfil`, qui redirige. Une action dont le rôle
est précisément de **lever** le drapeau ne peut pas passer par la fonction qui
s'en sert pour rediriger.

## Étude de cas : la faille trouvée et fermée

Avant la migration `0011`, `grant update on profils` était accordé et rien ne
protégeait spécifiquement la colonne `role`. Un `PATCH` PostgREST suffisait :

```
PATCH /rest/v1/profils?id=eq.<un-vendeur>  {"role":"admin"}   → RÉUSSI
```

Inoffensif tant qu'`admin` était le sommet de la hiérarchie. Un admin qui nomme
un admin reste dans ses prérogatives. Devenu une **escalade de privilèges** dès
qu'un niveau `dev` a été ajouté au-dessus : un gérant se serait fait `dev` en une
requête.

**Correctif**, appliquant le même principe que pour les ventes :

```sql
revoke insert, update, delete on profils, invitations from authenticated, anon;
```

Puis cinq fonctions (`inviter_utilisateur`, `modifier_compte`, `changer_actif`,
`changer_role`, `exiger_changement_mdp`) appliquant **une seule règle** :

> On ne gère jamais qu'un niveau **strictement inférieur** au sien.

```sql
create or replace function exiger_gestion_de(p_role text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_cible int := niveau_de(p_role);
begin
  if v_cible >= niveau_courant() then
    raise exception 'Interdit : on ne peut gérer qu''un niveau inférieur au sien (cible « % »).', p_role
      using errcode = '42501';
  end if;
end $$;
```

Conséquence assumée : **un dev ne peut pas créer un second dev depuis
l'application.** Un second propriétaire technique se crée en SQL, par un geste
conscient, l'application ne l'autorise structurellement pas.

Testé après coup en rejouant exactement le `PATCH` initial : `permission denied
for table profils`. Et le champ `role` d'un formulaire, trafiqué côté client
pour demander `dev`, est rejeté **en base** avec le message ci-dessus, jamais
un succès silencieux.

## Le cookie de bascule d'espace ne porte aucune autorisation

Un gérant vend aussi : un bouton bascule entre `/gestion` et `/vendeur`, et un
cookie `sf-espace` retient son choix pour la connexion suivante.

**Ce cookie ne dit pas ce qu'un compte a le droit de faire, seulement où il
aimerait atterrir.** Il n'est lu qu'à un seul endroit (la page `/`, qui choisit
une redirection) et jamais consulté par une garde.

Le test qui le prouve, à rejouer après toute modification : forger
`sf-espace=gestion` sur la session d'un vendeur.

```bash
curl -s -o /dev/null -w '%{redirect_url}\n' \
  -H "Cookie: $SESSION_VENDEUR; sf-espace=gestion" http://127.0.0.1:3002/
# → /vendeur   (et non /gestion)
```

Vérifié : `/` redirige vers `/vendeur`, `/gestion` aussi (`exigerAdmin()`), et
l'appel direct de la Server Action de bascule renvoie un vendeur sur `/vendeur`
**sans poser le cookie**. Le cookie est `httpOnly`, pas parce qu'il serait
sensible, mais parce qu'aucun code client n'a de raison de le lire.

## Le SAV : un pouvoir donné au vendeur, et sa borne

Le vendeur peut déclarer un SAV : il est le seul face au client. Mais un SAV
touche à **son** stock et à **sa** dette, ce qui en fait la fonctionnalité la
plus sensible ouverte à un non-gérant. Deux régimes, décidés **en base** :

```sql
-- declarer_sav(), migration 0015. Le régime n'est PAS un paramètre.
v_statut := case
              when v_admin then 'valide'
              when p_resolution = 'echange' then 'valide'
              else 'en_attente'
            end;
```

Un paramètre serait une porte ouverte : une Server Action est une URL, rien
n'empêche un appelant de la viser directement avec les champs de son choix.
Ici, un vendeur qui forgerait la requête obtiendrait exactement ce que
l'interface lui propose.

| Ce qu'un vendeur peut                             | Ce qu'il ne peut pas                                      |
| ------------------------------------------------- | --------------------------------------------------------- |
| ouvrir un dossier sur **ses** ventes              | ouvrir un dossier sur la vente d'un collègue              |
| faire sortir une unité de **son** stock (échange) | puiser dans l'entrepôt — le paramètre est ignoré pour lui |
| demander un remboursement                         | se rembourser : sa dette ne bouge qu'après validation     |
| retirer sa demande tant qu'elle est en attente    | retirer un dossier déjà tranché                           |
| marquer ses SAV comme consultés (`sav_vu_le`)     | écrire quoi que ce soit d'autre sur son profil            |

**Cloisonnement de l'espace vendeur** (migration `0018`) : `dossiers_sav()` et
`ventes_savables()` prennent un drapeau `p_les_miennes`, que l'espace vendeur
passe à `true`. Un gérant en mode vendeur ne voit et ne déclare alors que sur
SES ventes. La bascule de mode promet exactement cela. Le paramètre ne peut que
**restreindre** : pour un vendeur `est_admin()` vaut déjà faux, le passer à
`false` ne lui ouvre rien. C'est ce qui permet de l'exposer à un appelant qui
choisit sa valeur.

**Faille assumée et bornée** : un vendeur peut déclarer un faux échange pour
couvrir un manquant. L'arbitrage est explicite : un stock qui ment jusqu'au
passage du gérant, contre un stock qu'un vendeur peut faire baisser sous
surveillance. C'est le second qui a été retenu, parce que le vendeur a
réellement remis l'unité au client dans le cas normal.

Ce que « sous surveillance » veut dire concrètement, et ce qui a dû être ajouté
en `0019` pour que ce soit vrai :

| Borne | Depuis |
| --- | --- |
| La quantité ne dépasse pas ce que la vente contenait, cumul des dossiers compris | `0015` |
| Le dossier est nominatif, daté, motivé, et le motif est obligatoire | `0014` |
| **Le gérant est averti** : une pastille compte les dossiers validés qu'il n'a pas encore regardés | `0019` |
| **Le recours conserve la preuve** : révoquer rend l'unité au stock et garde le dossier au statut refusé, avec le motif du gérant | `0019` |

Les deux dernières lignes corrigent un défaut de conception, et il vaut d'être
énoncé : le recours du gérant existait depuis `0014` (`supprimer_sav()`), mais
il était inopérant en pratique. Rien ne l'avertissait (`sav_non_vus()` filtre
sur les ventes de l'appelant, c'est la pastille du **vendeur**), et son seul
outil était un `delete`, qui rendait bien l'unité au stock mais effaçait le
dossier avec son motif et son auteur.

Or ce qui caractérise un abus n'est pas un incident isolé, c'est un **motif
répété**. Un recours qui détruit sa propre trace laisse le premier faux échange
indiscernable du dixième : plus le gérant faisait son travail, moins il lui
restait de quoi constater une habitude. `supprimer_sav()` demeure, pour la
saisie franchement erronée qu'on ne veut pas voir traîner ; `revoquer_sav()` est
ce qu'on emploie face à un désaccord.

## `clientAdmin()` : le point le plus dangereux du code

```ts
// src/lib/supabase/admin.ts
export function clientAdmin() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

La clé service_role **contourne toute la RLS et tous les GRANT/REVOKE**. Ce
client n'a qu'un usage légitime : `auth.admin.createUser` et
`auth.admin.updateUserById`, l'API d'administration des comptes, inaccessible
autrement.

**Règle absolue, à vérifier à chaque nouvel usage** : ce client ne lit ni
n'écrit jamais de donnée métier. `clientAdmin().from("ventes").select()`
renverrait les ventes de tout le monde, sans la moindre erreur pour le
signaler. C'est le seul endroit du code où une inattention annule
silencieusement toutes les autres couches.

```bash
# Contrôle : les deux seuls appels légitimes.
grep -rn 'clientAdmin()\.' src/
#   src/app/gestion/actions.ts: clientAdmin().auth.admin.createUser(...)
#   src/app/gestion/actions.ts: clientAdmin().auth.admin.updateUserById(...)
```

## Mots de passe provisoires

Aucun SMTP n'est configuré sur le serveur. Un mot de passe provisoire est
**généré aléatoirement et affiché une seule fois**, jamais stocké, jamais
envoyé par courriel. Le transmettre de la main à la main. Le compte porte
`doit_changer_mdp = true`, qui force son remplacement à la prochaine connexion
avant tout accès (`exigerProfil()` redirige vers `/changer-mot-de-passe`).

## `v_lignes_vente` : piège de maintenance documenté dans le SQL

```sql
-- ⚠️⚠️ NE JAMAIS AJOUTER cout_unitaire NI AUCUN CALCUL DE MARGE ICI. ⚠️⚠️
-- Cette vue est le seul accès des vendeurs au détail de leurs ventes. Y
-- ajouter une colonne de coût livrerait la marge de l'entreprise à tous les
-- vendeurs, sans erreur, sans alerte et sans que rien ne casse.
create or replace view v_lignes_vente as ...
 where v.vendeur_id = auth.uid() or est_admin();
```

Deux dangers distincts sur cette seule vue : ajouter une colonne de coût (fuite
de marge), et **oublier la clause `where`** : la vue appartient à `postgres` et
contourne donc d'elle-même la RLS de `vente_lignes` ; sans ce filtre explicite,
un vendeur lirait le détail des ventes de tous ses collègues. Ce n'est pas une
commodité, c'est la seule barrière d'isolation de la vue.

## Composants shadcn modifiés

Trois fichiers de `src/components/ui/` divergent du registre officiel, chacun
avec un avertissement en tête de fichier :

| Fichier      | Modification                                 | Pourquoi                                                                                |
| ------------ | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `button.tsx` | variante `outline` → `--bordure-interactive` | la bordure d'origine (`--border`) ne contrastait qu'à 1,26:1 sur fond blanc — invisible |
| `dialog.tsx` | voile → `dark:bg-black/60`                   | à 10 %, du noir sur fond déjà sombre ne se voit pas                                     |
| `sheet.tsx`  | idem                                         | même raison, tiroir de navigation                                                       |

Un `npx shadcn add button --overwrite` (ou `dialog`, `sheet`) écraserait ces
correctifs sans avertissement autre que le commentaire perdu. À vérifier après
toute mise à jour du registre.

## Résumé : ce qu'il faut vérifier avant de faire confiance à un nouvel écran

- [ ] La table est-elle en RLS activée ? Le fichier de référence reste
      `0009_rls_privileges.sql`, mais une table créée après lui porte sa propre
      RLS et ses propres policies dans SA migration (c'est le cas de `sav`).
      L'inventaire du script de migration affiche « tables SANS RLS », qui doit
      valoir 0.
- [ ] Si c'est une écriture : passe-t-elle par une fonction, jamais par
      `.insert()` / `.update()` direct sur une table sensible ?
- [ ] La fonction vérifie-t-elle le rôle **en première ligne**, avant toute
      lecture ou écriture ?
- [ ] Si elle touche au stock : prend-elle le verrou **avant** de lire le
      stock disponible ?
- [ ] La Server Action rappelle-t-elle la garde (`exigerProfil` / `exigerAdmin`
      / `exigerDev`), même si le layout la porte déjà ?
- [ ] `clientAdmin()` n'est-il utilisé que pour `auth.admin.*` ?
