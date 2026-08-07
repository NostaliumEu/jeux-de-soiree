# 🍻 Jeux de soirée

Des mini-jeux à boire en multijoueur. On ouvre un lien ou on tape un code à quatre lettres, et tout le monde joue sur son propre téléphone. Aucune inscription, aucune installation.

Deux façons de jouer :

- **Sélection libre** — le groupe choisit un jeu, y joue, revient au menu.
- **Plateau** — un parcours en boucle à la Mario Party où les résultats des mini-jeux font avancer les pions.

## Les jeux

| | Jeu | Format | Principe |
|---|---|---|---|
| 🟣 | **Purple** | Tour par tour | Rouge/noir, plus haut/plus bas, ou le **Purple** — parier que les deux prochaines cartes seront de couleurs différentes. Chaque réussite met **+1** dans une banque commune (**+5** pour un Purple, qui est un cul sec). Le premier qui se trompe **boit toute la banque**. Impossible de passer son tour. |
| ⚡ | **Le Faux Départ** | Duel 1v1 | L'écran passe au vert à un instant imprévisible. Le premier qui tape gagne ; une milliseconde trop tôt et l'essai est perdu. Au meilleur des trois. |
| 🥅 | **Le Gardien** | 1 contre 2 à 5 | Les tireurs choisissent secrètement un coin, le gardien choisit où plonger, révélation simultanée. Trois manches. |
| 🗳️ | **Tu préfères** | Tous | Cinq questions, tout le monde vote en même temps, la minorité trinque. Contient aussi les questions « qui est le plus susceptible de… ». |

## Démarrer en local

```bash
npm install
```

Il faut ensuite un projet [Supabase](https://supabase.com) (l'offre gratuite suffit largement) :

1. Créer un projet, puis exécuter `supabase/migrations/0001_init.sql` dans l'éditeur SQL.
2. Copier `.env.example` vers `.env.local` et renseigner les trois valeurs (Project Settings → API).

```bash
cp .env.example .env.local
npm run dev
```

⚠️ `SUPABASE_SERVICE_ROLE_KEY` ne doit **jamais** être préfixée par `NEXT_PUBLIC_`. Elle contourne toutes les règles de sécurité : exposée au navigateur, elle donnerait à n'importe quel joueur l'accès au paquet de cartes.

## Ajouter un jeu

C'est le point sur lequel tout le projet est construit. Un jeu vit dans son dossier et n'exige **aucune migration, aucun changement dans le moteur, aucun changement dans un mode** :

```
src/games/mon-jeu/
  definition.ts    # fiche : nom, formats, nombre de joueurs, durée
  machine.ts       # les règles — fonction PURE
  machine.test.ts  # tests, sans réseau ni base
  Screen.tsx       # le rendu sur le téléphone
```

Puis **deux lignes** à ajouter :

```ts
// src/engine/registry.ts
register(monJeuDefinition, monJeuMachine),

// src/ui/ecrans.tsx
'mon-jeu': adapter(MonJeuEcran),
```

### La règle non négociable

`machine.ts` est une **fonction pure sans dépendance** : pas de réseau, pas de base, pas de `Date.now()`, pas de `Math.random()`. Le temps et l'aléa arrivent par `ctx`. Ce n'est pas une convention : une règle ESLint dédiée refuse le commit.

Deux conséquences valent le détour :

- chaque jeu se teste en millisecondes, sans lancer de serveur ;
- une partie est **rejouable à l'identique** depuis sa graine et son journal d'actions, ce qui rend le débogage d'un bug de règles trivial.

Un jeu ignore aussi totalement dans quel mode il tourne. Il reçoit des participants et rend un résultat normalisé :

```ts
interface GameResult {
  ranking: PlayerId[][]            // du meilleur au moins bon, ex æquo groupés
  sips: Record<PlayerId, number>   // gorgées bues
}
```

Le mode libre l'affiche, le mode Plateau le convertit en déplacements et en étoiles. Ajouter un mode ne touchera jamais au code d'un jeu.

## Architecture

- **Next.js 15** (App Router) + **Supabase** (Postgres et Realtime).
- **Autorité entièrement serveur.** Le navigateur ne peut rien écrire : sa clé n'a que des droits de lecture, restreints par RLS. Toutes les mutations passent par les Route Handlers.
- **Le secret est protégé par la base, pas par le client.** Le paquet mélangé, les choix cachés et les jetons joueurs vivent dans des tables où RLS est activé **sans aucune policy** — ce qui, en Postgres, interdit tout accès au rôle anonyme. Ouvrir l'inspecteur ne donne aucun avantage : la carte suivante n'a jamais quitté le serveur.
- **Le Faux Départ utilise un rendez-vous horaire.** Chaque client mesure son décalage d'horloge, le serveur annonce l'instant du vert, chaque téléphone l'affiche localement et mesure son propre temps de réaction. On compare des réflexes, jamais des latences réseau.

```
app/            pages et route handlers
src/engine/     contrats, aléa déterministe, cartes, registre
src/games/      un dossier par jeu
src/modes/      libre et plateau
src/server/     accès base et orchestration des manches
src/client/     temps réel, identité, horloge
supabase/       migrations et RLS
docs/           spec de design et plan d'implémentation
```

## Vérifications

```bash
npm test
```

```bash
npm run lint && npm run typecheck && npm run build
```

150 tests unitaires couvrent les règles des quatre jeux et du plateau, y compris les cas limites : égalité en plus/moins, paquet épuisé, double faux départ, égalité de vote, franchissement de l'étoile, bouclage de l'anneau.

### Tests de bout en bout

Ils exigent un serveur en marche (`npm run dev`) et un `.env.local` renseigné, parce qu'ils jouent contre une vraie base.

```bash
npm run test:e2e
```

Cycle de vie d'une soirée, lancement d'une manche, un coup de Purple — et surtout l'**étanchéité RLS** : le paquet de cartes, les jetons joueurs et le journal d'actions doivent rester inaccessibles depuis un navigateur, et la clé publique ne doit permettre aucune écriture.

```bash
npm run test:plateau
```

Quatre joueurs automatiques jouent une partie de plateau complète, quel que soit le mini-jeu tiré, en pariant et en résolvant les cases Tournée et Duel. La comptabilité est réconciliée à la fin : les gorgées du plateau doivent correspondre au total consolidé en base.

Pour viser un déploiement plutôt que le serveur local :

```bash
E2E_BASE=https://mon-app.vercel.app npm run test:e2e
```

Ces deux scripts ont trouvé trois bugs que les tests unitaires ne pouvaient pas voir : une manche de Purple qui ne démarrait pas, un mode Plateau qui ne s'initialisait jamais, et une fonction SQL exposée publiquement. Il faut une vraie base pour les attraper.

## Déploiement

Importer le dépôt sur [Vercel](https://vercel.com), renseigner les trois variables d'environnement, déployer. Le lien de la soirée est directement partageable.

## Ce que ce projet n'est pas

Pas de compte, pas de statistiques entre soirées, pas d'application native, pas de message de prévention. C'est un jeu à boire entre amis, et c'est assumé.
