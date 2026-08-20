# Tests SQL

```bash
./supabase/tests/lancer.sh        # tout
./supabase/tests/lancer.sh 03     # un fichier
```

Sortie au format TAP, code de sortie non nul dès qu'une assertion échoue ou
qu'une erreur SQL survient.

## Ce qui est testé, et pourquoi seulement ça

La logique métier de StockFlow vit en SQL. Trois règles y sont à la fois
irréversibles, monétaires et impossibles à deviner en lisant l'interface.
Ce sont celles qui sont couvertes :

| Fichier | Règle |
| --- | --- |
| `01_gardes_roles.sql` | on ne gère qu'un niveau **strictement** inférieur au sien, et le rôle seul ne suffit jamais : il faut être actif |
| `02_dette.sql` | commission figée à la vente, SAV compté seulement une fois validé, remboursement intégral qui laisse un solde négatif |
| `03_versements.sql` | borne anti-surversement, et son échappatoire explicite |
| `04_sav.sql` | échange validé d'office / remboursement arbitré, et la révocation qui rend l'unité à son détenteur |

Il n'y a **aucun test d'interface**. Le choix est délibéré : les Server Actions
ne font que relayer, et un test qui clique sur un bouton ne dirait rien de plus
que les assertions ci-dessus, pour dix fois le coût d'entretien.

## Comment ça tourne

Chaque fichier est exécuté dans **une transaction annulée à la fin**. Il n'y a
donc ni base de test, ni jeu de données figé à maintenir : les tests tournent
contre le schéma réel, migrations comprises, et ne laissent rien derrière eux,
pas même l'extension pgtap, qui est créée puis annulée à chaque passe.

Deux conséquences à connaître avant d'écrire un test :

- **Rien ne peut être affirmé sur l'état global.** Une assertion du type « il y
  a 3 vendeurs » serait vraie sur une base et fausse sur une autre. Toute
  assertion porte sur les identifiants créés par le fichier lui-même.
- **`t_agir()` bascule aussi le rôle Postgres** en `authenticated`, sans quoi
  les tests tourneraient en superutilisateur et traverseraient la RLS sans la
  voir. Pour revenir créer des fixtures, écrire `reset role;` : un compte
  `authenticated` ne peut pas le faire lui-même.

Les fixtures passent par le **vrai chemin d'inscription** : `t_compte()` écrit
une invitation puis insère dans `auth.users`, et laisse le trigger
`on_auth_user_created` fabriquer le profil. Insérer directement dans `profils`
testerait un état que l'application ne sait pas produire.

## Gotchas

| Symptôme | Cause |
| --- | --- |
| `permission denied for view v_comptes_vendeurs` | une lecture d'observation faite sous une identité `authenticated`. Passer par `t_du()`, qui est `security definer` pour cette raison |
| `ERROR: permission denied for schema public` après un `t_agir()` | il manque un `reset role;` avant de créer une fixture |
| Un test passe seul et échoue dans la suite | impossible ici : chaque fichier a sa transaction. Si ça arrive, c'est que le test s'appuie sur l'état global |
| Un compteur « non vus » reste à 0 alors que le dossier vient d'être créé | `now()` est figé à l'ouverture de la transaction : la marque « vu » et le dossier portent le même horodatage, et la comparaison est stricte. Poser la marque une seconde en arrière (voir `04_sav.sql`) |
| pgtap apparaît dans l'inventaire de `appliquer-migrations.sh` | une transaction de test a été committée. pgtap pose ~1000 fonctions dans `public` |
