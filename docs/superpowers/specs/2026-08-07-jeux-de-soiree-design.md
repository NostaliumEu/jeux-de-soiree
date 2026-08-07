# Jeux de soirée — Document de design

- **Date** : 2026-08-07
- **Statut** : validé, prêt pour le plan d'implémentation
- **Nom de travail du paquet** : `jeux-de-soiree` (purement cosmétique, sans impact technique)

---

## 1. Objectif

Un dépôt unique regroupant des mini-jeux à boire jouables en soirée. On rejoint une session en ouvrant un lien ou en tapant un code à 4 caractères : aucun compte, aucune installation, aucun store. Chaque joueur joue sur son propre téléphone.

Deux façons de jouer, disponibles dès la V1 :

- **Mode libre** — le groupe choisit un jeu dans un menu, y joue, revient au menu.
- **Mode Plateau** — un parcours en boucle à la Mario Party où les résultats des mini-jeux font avancer les pions.

Le pari central du projet n'est pas « écrire quatre jeux » mais **écrire un moteur tel qu'ajouter le quinzième jeu coûte deux heures**. Toutes les décisions d'architecture ci-dessous découlent de cet objectif.

### Hors périmètre de la V1

- Le **mode Playlist** (suite de manches préconfigurée avec score cumulé). L'architecture le rend possible sans toucher au code des jeux ; il sera ajouté ensuite.
- Comptes utilisateurs, persistance des statistiques entre soirées, classements globaux.
- Audio, vidéo, upload de photos.
- Application native ou installable (PWA).
- Internationalisation. La V1 est en français uniquement, mais les textes de jeu vivent dans des fichiers de contenu séparés, ce qui n'interdit rien pour la suite.

---

## 2. Décisions structurantes

| Sujet | Décision | Motif |
|---|---|---|
| Front | Next.js 15 (App Router), TypeScript strict, Tailwind CSS | Déploiement Vercel en un clic, lien partageable immédiat |
| Base + temps réel | Supabase (Postgres + Realtime) | Websockets gérés, RLS pour protéger les secrets, offre gratuite suffisante |
| Logique de jeu | **Route Handlers Next.js**, pas d'Edge Functions Supabase | Un seul runtime Node, un seul dépôt, types partagés de bout en bout. Deux runtimes auraient imposé de dupliquer ou de partager péniblement le code de règles |
| Autorité | 100 % serveur | Le client propose une action, le serveur seul décide du résultat |
| Identité | Pseudo + avatar, `player_id` en `localStorage` | Zéro friction à l'entrée, reconnexion transparente |
| Validation | Zod sur toute action entrante | Le client est hostile par principe |
| Tests | Vitest (règles), Playwright (parcours multi-joueurs) | Les règles sont des fonctions pures, donc testables en millisecondes |

Le projet ne comporte **aucun message de prévention, aucune confirmation d'âge, aucun rappel d'hydratation et aucun mode sans alcool**. C'est un jeu à boire assumé, conçu pour un groupe d'amis.

---

## 3. Architecture

### 3.1 Flux d'une action

```
Client                    Route Handler (Node)              Postgres            Realtime
  |                              |                             |                    |
  |-- POST /api/play ----------->|                             |                    |
  |   { roundId, action }        |-- charge round_state ------->|                    |
  |                              |<-- public + secret ---------|                    |
  |                              |                             |                    |
  |                              | machine.reduce(...)         |                    |
  |                              |   (fonction pure)           |                    |
  |                              |                             |                    |
  |                              |-- écrit public_state ------->|                    |
  |                              |-- écrit secret_state ------->|                    |
  |                              |-- écrit player_views -------->|                    |
  |                              |-- append actions ----------->|                    |
  |<-- 200 { ok } ---------------|                             |-- change ---------->|
  |<================== nouvel état poussé à tous les joueurs ======================>|
```

Le client n'a jamais l'autorité. Il n'écrit jamais directement en base : la clé publique Supabase du navigateur ne dispose que de droits de lecture, restreints par RLS. Toutes les mutations passent par les Route Handlers, qui utilisent la clé `service_role` côté serveur uniquement.

### 3.2 Protection des secrets

L'état d'une manche est scindé en trois :

- **`public_state`** — diffusé à tous les joueurs de la session. Exemple : la carte de référence de Purple, le contenu de la banque, le score.
- **`secret_state`** — jamais lisible depuis un navigateur. Aucune politique RLS `SELECT` n'existe pour le rôle anonyme sur cette colonne. Exemple : le paquet mélangé de Purple, les coins choisis avant révélation.
- **`player_views`** — une ligne par joueur, lisible uniquement par ce joueur (`player_id = auth-de-session`). C'est le canal des informations personnelles : le mot secret de l'imposteur dans un futur jeu, la confirmation de son propre choix caché.

Conséquence pratique : ouvrir l'inspecteur du navigateur ne donne strictement aucun avantage. La carte suivante de Purple n'a jamais quitté le serveur.

### 3.3 Aléa reproductible

Aucune machine de jeu n'appelle `Math.random`. L'aléa est fourni par `ctx.rng`, un générateur déterministe alimenté par une **graine stockée en base** au démarrage de la manche. Combiné au journal `actions` (append-only), cela rend toute partie **rejouable à l'identique**. Un bug de règles signalé par un joueur se reproduit en local à partir de la graine et du journal, sans avoir à deviner ce qui s'est passé.

---

## 4. Le contrat de jeu

C'est la pièce qui décide si le projet reste extensible. Un jeu est un dossier exposant quatre fichiers :

```
src/games/purple/
  definition.ts     # métadonnées déclaratives
  machine.ts        # les règles — fonction PURE, sans aucune dépendance
  machine.test.ts   # tests unitaires, sans réseau ni base
  Screen.tsx        # le rendu sur le téléphone
  content/          # (optionnel) données éditables : questions, mots, gages
```

### 4.1 Interfaces

```ts
type PlayerId = string

type GameFormat =
  | 'duel'          // exactement 2 participants
  | 'asymetrique'   // 1 solo contre K challengers
  | 'tous'          // tous les joueurs présents, simultanément
  | 'tour-par-tour' // tous les joueurs présents, chacun son tour

interface GameDefinition {
  key: string                  // identifiant stable, ex. 'purple'
  name: string
  tagline: string
  formats: GameFormat[]
  minPlayers: number
  maxPlayers: number | null    // null = pas de limite
  estimatedSeconds: number     // sert au mode Plateau pour équilibrer le rythme
  supportsBoard: boolean       // le jeu peut-il être tiré comme mini-jeu de plateau
}

/** Résultat normalisé rendu par TOUT mini-jeu, quel que soit son format. */
interface GameResult {
  ranking: PlayerId[][]              // du meilleur au moins bon ; ex æquo groupés
  sips: Record<PlayerId, number>     // gorgées bues pendant la manche
}

interface GameMachine<S, A> {
  init(ctx: InitContext): S
  reduce(state: S, action: A, ctx: ReduceContext): {
    state: S
    events: GameEvent[]
    result?: GameResult              // présent uniquement quand la manche est finie
  }
  /** Projette l'état vers ce qu'un joueur donné a le droit de voir. */
  view(state: S, viewer: PlayerId): { publicView: unknown; privateView: unknown }
}
```

### 4.2 La règle qui rend tout possible

**Un jeu ignore totalement dans quel mode il tourne.** Il reçoit une liste de participants et rend un `GameResult`. C'est le *mode* qui interprète ce résultat :

- Le **mode libre** l'affiche tel quel.
- Le **mode Plateau** le traduit en déplacements de pions et en étoiles.
- Le futur **mode Playlist** l'accumulera en score.

Aucun de ces trois consommateurs ne touchera jamais au code d'un jeu. Symétriquement, ajouter un jeu ne touche à aucun mode.

### 4.3 Contraintes non négociables sur `machine.ts`

- Aucun import autre que les types du moteur et le contenu local du jeu.
- Aucun accès réseau, base de données, `Date.now()` ni `Math.random()`. Le temps et l'aléa arrivent par `ctx`.
- Aucun effet de bord : `reduce` rend un nouvel état, ne mute jamais l'ancien.

Ces contraintes sont vérifiées par une règle ESLint dédiée, pas seulement par convention.

### 4.4 Ajouter un jeu

1. Créer le dossier sous `src/games/`.
2. Ajouter une ligne dans `src/engine/registry.ts`.

C'est tout. Aucune migration, aucune modification du moteur, aucune modification d'un mode.

---

## 5. Modèle de données

```sql
sessions        (id, code, host_player_id, mode, status, settings jsonb, created_at, last_activity_at)
players         (id, session_id, nickname, avatar, joined_at, last_seen_at)
rounds          (id, session_id, game_key, format, participants uuid[], status, seed, started_at, ended_at)
round_state     (round_id, public_state jsonb, secret_state jsonb, version)
player_views    (round_id, player_id, payload jsonb)
actions         (id, round_id, player_id, payload jsonb, created_at)   -- append-only
board_state     (session_id, positions jsonb, stars jsonb, star_cell int, round_index int, total_rounds int)
tally           (session_id, player_id, sips_total int)
```

### Politiques RLS (rôle anonyme du navigateur)

| Table | Lecture | Écriture |
|---|---|---|
| `sessions`, `players`, `rounds`, `board_state`, `tally` | uniquement les lignes de sa propre session | interdite |
| `round_state.public_state` | uniquement sa session | interdite |
| `round_state.secret_state` | **jamais** | interdite |
| `player_views` | uniquement `player_id = le sien` | interdite |
| `actions` | interdite | interdite |

Toutes les écritures passent par les Route Handlers avec la clé `service_role`, qui n'est jamais exposée au navigateur.

### Session

- **Code** : 4 caractères tirés de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 symboles sans caractères ambigus : ni `I`/`1`, ni `O`/`0`). Soit ~1 million de combinaisons — largement suffisant, avec vérification d'unicité parmi les sessions actives à la création.
- **Lien d'invitation** : `/j/ABCD`. L'ouvrir suffit à rejoindre.
- **Hôte** : le créateur. S'il se déconnecte plus de 60 secondes, le rôle passe automatiquement au joueur connecté le plus ancien — une soirée ne doit jamais s'arrêter parce que quelqu'un a rangé son téléphone.
- **Nombre de joueurs** : aucune limite fonctionnelle. Plafond technique de **30 par session** pour maîtriser le coût Realtime, avec un message clair si on l'atteint.
- **Reconnexion** : le `player_id` est en `localStorage`. Recharger la page, verrouiller son écran ou recevoir un appel ramène exactement au même endroit.
- **Nettoyage** : les sessions sans activité depuis 24 h sont supprimées par un job `pg_cron`.

---

## 6. Les jeux de la V1

Les valeurs numériques ci-dessous vivent dans `src/games/<jeu>/definition.ts` et sont ajustables sans toucher aux règles.

### 6.1 🟣 Purple — `tour-par-tour`

Le jeu-phare. Paquet de 52 cartes, mélangé côté serveur, jamais visible du client.

**Valeurs** : As = 1, 2 à 10 = leur valeur, Valet = 11, Dame = 12, Roi = 13.

**Tour de jeu** — rotation stricte, **une seule prédiction par joueur**, puis on passe au suivant quoi qu'il arrive :

1. Une **carte de référence** (la dernière tirée) est visible de tous.
2. Le joueur dont c'est le tour **choisit lui-même** son pari. C'est là qu'est toute la stratégie : sur un As, « plus haut » est quasi certain ; sur un 7, tout est ouvert.
   - **Rouge / Noir** — la prochaine carte sera ♥♦ ou ♠♣. Toujours disponible.
   - **Plus haut / Plus bas** — strictement supérieur ou inférieur à la référence. **L'égalité est un échec.**
   - **Purple** — les **deux** prochaines cartes seront de couleurs différentes (une rouge, une noire, dans n'importe quel ordre).
3. **Passer son tour est impossible.** Un des trois paris, obligatoirement.
4. Résolution :
   - **Réussite** → **+1 gorgée** dans la banque (**+5** si c'était un Purple, parce que c'est un cul sec).
   - **Échec** → le joueur **boit l'intégralité de la banque**, puis elle repart à **0**.
5. La carte tirée devient la nouvelle référence. Après un Purple, c'est la **deuxième** carte tirée.

**Banque** : une seule, centrale, commune à toute la table. Il n'y a aucune banque individuelle et aucun échange de gorgées entre joueurs.

**Premier tour** : il n'y a pas encore de référence, donc seuls **Rouge/Noir** et **Purple** sont proposés.

**Paquet épuisé** : la défausse est remélangée avec une nouvelle graine ; la carte de référence est conservée.

**Fin de manche** :
- **Mode Plateau** — après **3 échecs cumulés** dans la manche, peu importe les quantités bues. On enchaîne alors sur le mini-jeu suivant.
- **Mode libre** — en continu, jusqu'à ce que l'hôte arrête.

**Résultat rendu au mode Plateau** :
- `ranking` — trié par nombre d'échecs croissant, puis par gorgées apportées à la banque décroissant. Autrement dit : ne jamais se planter d'abord, alimenter la banque ensuite. C'est ce qui récompense la prise de risque, notamment le Purple.
- `sips` — le total bu par chaque joueur.

**Note d'équilibrage assumée** : avec une banque centrale, réussir un Purple ne rapporte rien personnellement au joueur en mode libre — c'est un pari de panache, pas de calcul. C'est un choix délibéré. En mode Plateau, le `ranking` ci-dessus lui redonne une valeur concrète.

### 6.2 ⚡ Le Faux Départ — `duel`

Deux joueurs, **au meilleur des trois essais** (le premier à 2 victoires).

Déroulé d'un essai : compte à rebours, puis un délai aléatoire de 2 à 7 secondes, puis l'écran devient vert. Le premier qui tape gagne. **Taper avant le vert = essai perdu immédiatement.** Si les deux partent trop tôt, celui qui a tapé le premier perd l'essai.

**Le piège technique traité dès le départ.** Si le serveur envoyait le signal « vert » et que celui d'un joueur arrivait 200 ms après celui de l'autre, le duel serait décidé par la qualité du réseau, pas par les réflexes. La solution retenue est un **rendez-vous horaire** :

1. À la connexion, chaque client mesure son décalage d'horloge avec le serveur (quelques allers-retours, on garde la médiane).
2. Le serveur annonce à l'avance : « le vert s'allume à l'instant serveur T ».
3. Chaque téléphone affiche le vert localement à `T − son décalage`.
4. Chaque téléphone mesure **son propre** temps de réaction, localement, et l'envoie.
5. Le serveur compare des **temps de réaction**, jamais des heures d'arrivée réseau.

**Gorgées** : le perdant du duel boit 2 gorgées ; 3 s'il a perdu sur un faux départ.

### 6.3 🥅 Le Gardien — `asymetrique`

Un gardien contre 2 à 5 tireurs (3 par défaut). Si la session compte plus de joueurs, les participants sont tirés au sort.

**Trois manches.** À chaque manche, simultanément et en secret :
- Chaque tireur choisit un coin parmi cinq : haut-gauche, haut-droite, bas-gauche, bas-droite, centre.
- Le gardien choisit **un** coin où plonger.

Puis **révélation simultanée** : tous les tirs partis dans le coin choisi par le gardien sont arrêtés, les autres sont des buts.

Les choix vivent dans `secret_state` jusqu'à la révélation. C'est le patron réutilisable pour tous les futurs jeux à choix cachés — pierre-feuille-ciseaux, enchères, paris.

**Score** : 1 point par but pour le tireur, 1 point par arrêt pour le gardien. `ranking` = tri décroissant des points.

**Gorgées** : chaque tireur arrêté boit 1 gorgée ; le gardien boit 1 gorgée par but encaissé.

### 6.4 🗳️ Tu préfères — `tous`

**Cinq questions** par manche, tirées d'un fichier JSON versionné dans le dépôt. Deux types de questions cohabitent dans le même module :

- **`binaire`** — « Tu préfères A ou B ? » Tout le monde vote en 20 secondes. **La minorité boit 2 gorgées.** En cas d'égalité parfaite, tout le monde boit 1. Ne pas voter à temps coûte 2 gorgées.
- **`joueur`** — « Qui est le plus susceptible de… ? » Chacun vote pour un joueur. Le plus désigné boit autant de gorgées qu'il a reçu de votes, plafonné à 5. En cas d'égalité, tous les ex æquo boivent.

`ranking` : les majoritaires devant les minoritaires, cumulé sur les cinq questions.

C'est le jeu le moins cher à produire et celui qui grossit tout seul : **n'importe qui peut proposer des questions par pull request sans écrire une ligne de code.**

---

## 7. Le mode Plateau

Un anneau de **24 cases**, affiché sur tous les écrans, un pion par joueur. Pas de ligne d'arrivée puisque c'est une boucle, et **pas de dé** — c'est le mini-jeu qui fait avancer.

### 7.1 Déroulé d'une manche

1. **Tirage** — l'app choisit un mini-jeu compatible avec le nombre de joueurs présents, ainsi qu'un format parmi ceux que ce jeu déclare. Le même jeu n'est jamais tiré deux fois de suite. Pour les formats `duel` et `asymetrique`, les participants sont tirés au sort **en privilégiant ceux qui ont le moins participé**, afin que personne ne reste spectateur toute la partie.
2. **Paris** — les joueurs non sélectionnés parient sur le vainqueur en 15 secondes. **Personne ne regarde sans rien faire.** Bon pari : +1 case. Mauvais pari : 1 gorgée.
3. **Mini-jeu** — il se joue et rend son `GameResult`.
4. **Déplacements** — 1ᵉʳ du `ranking` : +3 cases. 2ᵉ : +2. 3ᵉ : +1. Les suivants : 0. Les gorgées du `GameResult` sont appliquées telles quelles.
5. **Effets de case** — chaque pion déclenche l'effet de la case où il s'arrête.

### 7.2 Les cases

| Case | Nombre | Effet |
|---|---|---|
| Neutre | 12 | Rien |
| Gage | 4 | Un défi tiré au sort, à réaliser sous peine de 3 gorgées |
| Tournée | 3 | Le joueur distribue 3 gorgées comme il l'entend |
| Duel | 3 | Duel immédiat en 1v1 contre l'adversaire de son choix |
| Téléportation | 2 | Échange de position avec un joueur au hasard |

### 7.3 L'étoile

Une **étoile** est posée sur une case aléatoire inoccupée. Le premier joueur qui l'**atteint ou la dépasse** la ramasse, puis elle réapparaît immédiatement ailleurs sur l'anneau. C'est elle qui donne un sens à la course sur un circuit fermé : sans objectif à collecter, tourner en rond n'aurait aucun enjeu.

### 7.4 Fin de partie

Le nombre de manches est **fixé au lancement** par l'hôte (10, 15 ou 20), avec un compteur visible en permanence — tout le monde sait à quelle heure ça se termine, et la tension monte naturellement sur les dernières manches.

**Classement final** : nombre d'étoiles, puis nombre de cases parcourues en départage. Le premier est sacré ; le dernier prend un gage final.

---

## 8. Structure du dépôt

```
app/
  page.tsx                    # accueil : créer une session / rejoindre par code
  j/[code]/page.tsx           # lien d'invitation → lobby ou partie en cours
  api/
    session/route.ts          # créer, rejoindre, quitter
    play/route.ts             # appliquer une action de jeu
    clock/route.ts            # synchronisation d'horloge (Le Faux Départ)
src/
  engine/
    types.ts                  # GameDefinition, GameMachine, GameResult
    registry.ts               # inscription des jeux — LE seul fichier touché à l'ajout
    session.ts                # cycle de vie d'une session
    rng.ts                    # générateur déterministe à graine
    realtime.ts               # abonnements Supabase côté client
  modes/
    free/                     # mode libre
    board/                    # mode Plateau
  games/
    purple/
    faux-depart/
    gardien/
    tu-preferes/
  ui/                         # composants partagés
supabase/
  migrations/
docs/
  superpowers/specs/
```

---

## 9. Stratégie de test

| Niveau | Outil | Portée |
|---|---|---|
| Règles | Vitest | Chaque `machine.ts`. Pures et sans dépendance, donc rapides. Couvre en particulier les cas limites : égalité en Plus/Moins, paquet épuisé, double faux départ, égalité de vote |
| Route Handlers | Vitest + Supabase local | Validation Zod, rejet des actions hors-tour, rejet des actions d'un joueur non participant |
| Parcours complet | Playwright, 2 navigateurs | Créer une session, rejoindre par lien, jouer une manche de Purple, vérifier la synchronisation des deux écrans |
| Anti-triche | Vitest | Vérifier qu'aucune requête client ne peut lire `secret_state` (test explicite contre les policies RLS) |

Le test anti-triche est traité comme un test de régression de premier rang : c'est la garantie que le jeu reste jouable honnêtement, et c'est exactement le genre de propriété qu'une refonte future casse silencieusement.

---

## 10. Risques identifiés

| Risque | Traitement |
|---|---|
| Latence Realtime perçue comme un bug sur les jeux de réflexe | Rendez-vous horaire avec synchronisation d'horloge (§6.2) ; les temps de réaction sont mesurés localement |
| Un joueur ferme son téléphone en plein tour et bloque la table | Chaque phase a un délai maximum ; à son expiration, le serveur joue une action par défaut (Purple : Rouge/Noir tiré au sort) et passe au suivant |
| L'hôte quitte la soirée | Transfert automatique du rôle après 60 s de déconnexion (§5) |
| Le moteur se déforme au fil des jeux ajoutés | Contrat `GameResult` figé + règle ESLint interdisant les dépendances dans `machine.ts` (§4.3) |
| Coût Supabase si le lien circule | Plafond de 30 joueurs par session, purge des sessions inactives à 24 h |
