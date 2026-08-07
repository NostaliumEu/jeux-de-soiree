# Jeux de soirée V1 — Plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE : utiliser `superpowers:subagent-driven-development` ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes utilisent la syntaxe case à cocher (`- [ ]`).

**Objectif :** livrer une application web où l'on rejoint une soirée par un lien ou un code à 4 caractères, et où l'on joue à quatre mini-jeux à boire, en mode libre ou sur un plateau en boucle à la Mario Party.

**Architecture :** une seule app Next.js 15 (App Router) sur Vercel, Supabase pour Postgres et Realtime. Toute la logique de règles vit dans des **fonctions pures sans dépendance** (`machine.ts`), appelées exclusivement par des Route Handlers Node qui détiennent l'autorité. Le navigateur ne peut que lire, et jamais l'état secret, garanti par RLS.

**Stack :** Next.js 15, React 19, TypeScript strict, Tailwind CSS 4, Supabase JS v2, Zod, Vitest.

**Spec de référence :** `docs/superpowers/specs/2026-08-07-jeux-de-soiree-design.md`

---

## Carte des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/engine/types.ts` | Contrats partagés : `GameDefinition`, `GameMachine`, `GameResult`, `PlayerId`, `GameFormat` |
| `src/engine/rng.ts` | Générateur pseudo-aléatoire déterministe à graine (mulberry32) + `shuffle` |
| `src/engine/cards.ts` | Paquet de 52 cartes, valeurs, couleurs — partagé par tout jeu de cartes |
| `src/engine/registry.ts` | Table des jeux inscrits. **Seul fichier touché à l'ajout d'un jeu** |
| `src/engine/session.ts` | Génération du code, sélection du mini-jeu et des participants |
| `src/games/purple/{definition,machine,Screen}.ts(x)` | Purple |
| `src/games/faux-depart/{definition,machine,Screen}.ts(x)` | Le Faux Départ |
| `src/games/gardien/{definition,machine,Screen}.ts(x)` | Le Gardien |
| `src/games/tu-preferes/{definition,machine,Screen}.ts(x)` + `content/questions.fr.json` | Tu préfères |
| `src/modes/board/machine.ts` | Plateau : anneau, déplacements, cases, étoile, paris, fin |
| `src/modes/board/cells.ts` | Composition figée des 24 cases |
| `src/server/supabase.ts` | Client `service_role`, serveur uniquement |
| `src/server/store.ts` | Lecture/écriture de l'état d'une manche |
| `app/api/session/route.ts` | Créer / rejoindre / quitter / lancer |
| `app/api/play/route.ts` | Appliquer une action de jeu |
| `app/api/clock/route.ts` | Synchronisation d'horloge |
| `app/page.tsx` | Accueil : créer ou rejoindre |
| `app/j/[code]/page.tsx` | Lobby et partie |
| `src/client/useSession.ts` | Abonnement Realtime, reconnexion, envoi d'actions |
| `supabase/migrations/0001_init.sql` | Schéma et RLS |

---

## Task 1 : Scaffolding

**Fichiers :** `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `app/layout.tsx`, `app/globals.css`

- [ ] **Step 1 :** créer `package.json` avec les dépendances `next@15`, `react@19`, `@supabase/supabase-js@2`, `zod@3`, et les dev-dépendances `typescript`, `vitest`, `@types/react`, `@types/node`, `tailwindcss@4`, `@tailwindcss/postcss`, `eslint`, `eslint-config-next`. Scripts : `dev`, `build`, `start`, `lint`, `test`.
- [ ] **Step 2 :** `tsconfig.json` en `strict: true`, `noUncheckedIndexedAccess: true`, alias `@/*` → `./src/*`.
- [ ] **Step 3 :** `vitest.config.ts` — environnement `node`, inclusion `src/**/*.test.ts`.
- [ ] **Step 4 :** `eslint.config.mjs` — étendre `next/core-web-vitals` et ajouter une règle `no-restricted-imports` + `no-restricted-globals` sur `src/games/**/machine.ts` et `src/modes/**/machine.ts` interdisant `Math.random`, `Date`, et tout import hors `@/engine/*` et `./content/*`. C'est le garde-fou de pureté décrit au §4.3 de la spec.
- [ ] **Step 5 :** `npm install`, puis `npx tsc --noEmit`. Attendu : aucune erreur.
- [ ] **Step 6 :** commit `chore: scaffolding Next.js + TypeScript strict + Vitest`.

---

## Task 2 : Moteur — aléa déterministe

**Fichiers :** créer `src/engine/rng.ts`, `src/engine/rng.test.ts`

- [ ] **Step 1 : test qui échoue**

```ts
import { describe, it, expect } from 'vitest'
import { createRng, shuffle } from './rng'

describe('createRng', () => {
  it('rend la même séquence pour la même graine', () => {
    const a = createRng('graine-1')
    const b = createRng('graine-1')
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('rend des séquences différentes pour des graines différentes', () => {
    expect(createRng('a').next()).not.toEqual(createRng('b').next())
  })

  it('rend des valeurs dans [0, 1)', () => {
    const rng = createRng('x')
    for (let i = 0; i < 200; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('intRange respecte les bornes incluses', () => {
    const rng = createRng('y')
    for (let i = 0; i < 200; i++) {
      const v = rng.intRange(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
    }
  })
})

describe('shuffle', () => {
  it('conserve tous les éléments', () => {
    const out = shuffle([1, 2, 3, 4, 5], createRng('s'))
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('ne mute pas le tableau source', () => {
    const src = [1, 2, 3, 4, 5]
    shuffle(src, createRng('s'))
    expect(src).toEqual([1, 2, 3, 4, 5])
  })

  it('est déterministe à graine égale', () => {
    expect(shuffle([1, 2, 3, 4, 5], createRng('k'))).toEqual(shuffle([1, 2, 3, 4, 5], createRng('k')))
  })
})
```

- [ ] **Step 2 :** `npx vitest run src/engine/rng.test.ts` → ÉCHEC, module introuvable.
- [ ] **Step 3 :** implémenter `createRng` (hachage cyrb128 de la graine → mulberry32) exposant `next()`, `intRange(min, max)`, `pick(array)`, et `shuffle(array, rng)` en Fisher-Yates non mutant.
- [ ] **Step 4 :** relancer → SUCCÈS.
- [ ] **Step 5 :** commit `feat(engine): générateur aléatoire déterministe à graine`.

---

## Task 3 : Moteur — cartes et contrats

**Fichiers :** créer `src/engine/cards.ts`, `src/engine/cards.test.ts`, `src/engine/types.ts`

- [ ] **Step 1 : test qui échoue**

```ts
import { describe, it, expect } from 'vitest'
import { buildDeck, isRed, cardValue } from './cards'

describe('buildDeck', () => {
  it('contient 52 cartes uniques', () => {
    const deck = buildDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map((c) => `${c.rank}${c.suit}`)).size).toBe(52)
  })
  it('contient 26 rouges et 26 noires', () => {
    expect(buildDeck().filter(isRed)).toHaveLength(26)
  })
})

describe('cardValue', () => {
  it('mappe As sur 1 et Roi sur 13', () => {
    expect(cardValue({ rank: 'A', suit: '♠' })).toBe(1)
    expect(cardValue({ rank: 'K', suit: '♠' })).toBe(13)
    expect(cardValue({ rank: '7', suit: '♥' })).toBe(7)
  })
})
```

- [ ] **Step 2 :** lancer → ÉCHEC.
- [ ] **Step 3 :** implémenter `Suit = '♠'|'♥'|'♦'|'♣'`, `Rank = 'A'|'2'…'10'|'J'|'Q'|'K'`, `Card`, `buildDeck()`, `isRed(card)`, `cardValue(card)`.
- [ ] **Step 4 :** écrire `src/engine/types.ts` avec exactement les interfaces du §4.1 de la spec : `PlayerId`, `GameFormat`, `GameResult`, `GameDefinition`, `GameMachine<S, A>`, `InitContext`, `ReduceContext`, `GameEvent`.
- [ ] **Step 5 :** lancer → SUCCÈS. Commit `feat(engine): paquet de cartes et contrats de jeu`.

---

## Task 4 : Jeu Purple

**Fichiers :** créer `src/games/purple/definition.ts`, `machine.ts`, `machine.test.ts`

Règles de référence : §6.1 de la spec.

- [ ] **Step 1 : tests qui échouent** — couvrir au minimum :
  - une réussite Rouge/Noir ajoute **+1** à la banque et passe au joueur suivant ;
  - une réussite Purple ajoute **+5** ;
  - un échec fait boire au fautif **exactement le contenu de la banque**, puis la remet à **0** ;
  - **l'égalité en Plus/Moins est un échec** ;
  - au premier tour, `availableBets` ne propose **ni** `higher` **ni** `lower` ;
  - une action `higher` au premier tour est **rejetée** ;
  - une action d'un joueur dont ce n'est pas le tour est **rejetée** ;
  - après un Purple, la référence est la **deuxième** carte tirée ;
  - le paquet épuisé est **remélangé** et la partie continue ;
  - en mode Plateau, la manche **se termine au 3ᵉ échec** et rend un `GameResult` ;
  - en mode libre, la manche **ne se termine pas** au 3ᵉ échec ;
  - le `ranking` trie par échecs croissants puis contributions décroissantes.
- [ ] **Step 2 :** lancer → ÉCHEC.
- [ ] **Step 3 :** implémenter. État public : `{ reference, bank, currentPlayerIndex, order, failures, contributions, drank, lastReveal }`. État secret : `{ deck, drawn }`. Actions : `{ type: 'bet', bet: 'red'|'black'|'higher'|'lower'|'purple' }`.
- [ ] **Step 4 :** lancer → SUCCÈS. Commit `feat(games): Purple avec banque centrale`.

---

## Task 5 : Jeu Le Faux Départ

**Fichiers :** créer `src/games/faux-depart/definition.ts`, `machine.ts`, `machine.test.ts`

Règles : §6.2. Au meilleur des trois essais.

- [ ] **Step 1 : tests qui échouent** — le temps de réaction le plus bas gagne l'essai ; un faux départ perd l'essai immédiatement ; **double faux départ → celui qui a tapé le premier perd** ; le premier à 2 essais gagne la manche ; le perdant boit 2 gorgées, 3 si sa défaite finale vient d'un faux départ.
- [ ] **Step 2 :** lancer → ÉCHEC.
- [ ] **Step 3 :** implémenter. L'instant du vert est calculé à l'`init` de chaque essai via `ctx.rng.intRange(2000, 7000)` ajouté à `ctx.now`, et stocké dans l'**état secret** jusqu'à l'annonce. Action : `{ type: 'tap', reactionMs: number | null }` — `null` signalant un faux départ.
- [ ] **Step 4 :** lancer → SUCCÈS. Commit `feat(games): Le Faux Départ, duel de réflexe`.

---

## Task 6 : Jeu Le Gardien

**Fichiers :** créer `src/games/gardien/definition.ts`, `machine.ts`, `machine.test.ts`

Règles : §6.3. Trois manches, choix simultanés cachés.

- [ ] **Step 1 : tests qui échouent** — les tirs dans le coin du gardien sont arrêtés, les autres sont des buts ; les choix restent dans `secret_state` avant révélation et `view()` ne les expose pas aux adversaires ; la manche se résout **uniquement** quand tous les participants ont choisi ; le gardien boit 1 gorgée par but encaissé, un tireur arrêté boit 1 gorgée ; le `ranking` trie par points décroissants sur trois manches.
- [ ] **Step 2 :** lancer → ÉCHEC.
- [ ] **Step 3 :** implémenter. Coins : `'HG'|'HD'|'BG'|'BD'|'C'`. Action : `{ type: 'choose', corner }`.
- [ ] **Step 4 :** lancer → SUCCÈS. Commit `feat(games): Le Gardien, choix simultanés cachés`.

---

## Task 7 : Jeu Tu préfères

**Fichiers :** créer `src/games/tu-preferes/definition.ts`, `machine.ts`, `machine.test.ts`, `content/questions.fr.json`

Règles : §6.4. Cinq questions par manche.

- [ ] **Step 1 : tests qui échouent** — sur une question `binaire`, la minorité boit 2 ; **égalité parfaite → tout le monde boit 1** ; ne pas voter coûte 2 ; sur une question `joueur`, le plus désigné boit autant que de votes reçus, **plafonné à 5** ; en cas d'égalité tous les ex æquo boivent ; la manche s'arrête après 5 questions.
- [ ] **Step 2 :** lancer → ÉCHEC.
- [ ] **Step 3 :** écrire `content/questions.fr.json` — au moins 40 entrées `binaire` et 25 entrées `joueur` — puis implémenter la machine.
- [ ] **Step 4 :** lancer → SUCCÈS. Commit `feat(games): Tu préfères et Qui est le plus susceptible`.

---

## Task 8 : Mode Plateau

**Fichiers :** créer `src/modes/board/cells.ts`, `machine.ts`, `machine.test.ts`

Règles : §7.

- [ ] **Step 1 : tests qui échouent** — les 24 cases se répartissent **exactement** en 12 neutres, 4 gages, 3 tournées, 3 duels, 2 téléportations ; le 1ᵉʳ du `ranking` avance de 3, le 2ᵉ de 2, le 3ᵉ de 1, les autres de 0 ; un pari juste avance d'une case, un pari faux coûte une gorgée ; le déplacement **boucle** modulo 24 ; un joueur qui **atteint ou dépasse** la case-étoile la ramasse et l'étoile réapparaît ailleurs ; la partie se termine après `totalRounds` manches ; le classement final trie par étoiles puis par distance parcourue.
- [ ] **Step 2 :** lancer → ÉCHEC.
- [ ] **Step 3 :** implémenter. La machine du plateau consomme un `GameResult` — elle **n'importe aucun jeu**.
- [ ] **Step 4 :** lancer → SUCCÈS. Commit `feat(modes): plateau en boucle avec étoile et paris`.

---

## Task 9 : Registre et sélection

**Fichiers :** créer `src/engine/registry.ts`, `src/engine/session.ts`, `src/engine/session.test.ts`

- [ ] **Step 1 : tests qui échouent** — `generateCode()` ne produit que des caractères de l'alphabet sans ambiguïté et fait 4 signes ; `pickGame` ne retire jamais le même jeu deux fois de suite ; `pickParticipants` privilégie ceux qui ont le moins participé ; un jeu dont `minPlayers` dépasse l'effectif n'est jamais sélectionné.
- [ ] **Step 2 :** lancer → ÉCHEC.
- [ ] **Step 3 :** implémenter, en inscrivant les quatre jeux dans le registre.
- [ ] **Step 4 :** lancer → SUCCÈS. Commit `feat(engine): registre des jeux et sélection équitable`.

---

## Task 10 : Base de données

**Fichiers :** créer `supabase/migrations/0001_init.sql`

- [ ] **Step 1 :** écrire les huit tables du §5 de la spec.
- [ ] **Step 2 :** activer RLS sur **toutes** les tables. Aucune politique d'écriture pour le rôle `anon`. Aucune politique de lecture sur `secret_state` ni sur `actions`. Exposer `public_state` via une **vue** `round_public` qui ne sélectionne pas la colonne secrète — c'est plus sûr que de compter sur une politique au niveau colonne.
- [ ] **Step 3 :** ajouter la publication Realtime sur `sessions`, `players`, `rounds`, `round_public`, `board_state`, `tally`, `player_views`.
- [ ] **Step 4 :** commit `feat(db): schéma initial et politiques RLS`.

---

## Task 11 : Route Handlers

**Fichiers :** créer `src/server/supabase.ts`, `src/server/store.ts`, `app/api/session/route.ts`, `app/api/play/route.ts`, `app/api/clock/route.ts`

- [ ] **Step 1 :** `src/server/supabase.ts` — client construit avec `SUPABASE_SERVICE_ROLE_KEY`, avec un garde qui **jette une erreur si le module est importé côté client**.
- [ ] **Step 2 :** `app/api/session/route.ts` — actions `create`, `join`, `leave`, `start`, `next`. Toute entrée validée par Zod. `create` génère un code unique parmi les sessions actives.
- [ ] **Step 3 :** `app/api/play/route.ts` — charge la manche, refuse une action dont l'auteur n'est pas participant, appelle `machine.reduce`, persiste, écrit les `player_views`, journalise dans `actions`.
- [ ] **Step 4 :** `app/api/clock/route.ts` — rend `{ serverTime }` pour la synchronisation du Faux Départ.
- [ ] **Step 5 :** commit `feat(api): route handlers avec autorité serveur`.

---

## Task 12 : Client et temps réel

**Fichiers :** créer `src/client/useSession.ts`, `src/client/api.ts`, `app/page.tsx`, `app/j/[code]/page.tsx`, `app/layout.tsx`, les quatre `Screen.tsx`, `src/modes/board/BoardView.tsx`, `src/ui/*`

- [ ] **Step 1 :** `src/client/api.ts` — appels typés vers les Route Handlers.
- [ ] **Step 2 :** `src/client/useSession.ts` — identité en `localStorage`, abonnement Realtime, resynchronisation complète à la reconnexion, mesure du décalage d'horloge (médiane de 5 allers-retours).
- [ ] **Step 3 :** `app/page.tsx` — créer une session ou rejoindre par code.
- [ ] **Step 4 :** `app/j/[code]/page.tsx` — saisie du pseudo, lobby avec la liste des joueurs et le lien à partager, puis aiguillage vers le mode choisi.
- [ ] **Step 5 :** les quatre `Screen.tsx` et `BoardView.tsx`, pensés **mobile d'abord** : cibles tactiles larges, lisibles dans une pièce sombre.
- [ ] **Step 6 :** commit `feat(ui): lobby, écrans de jeu et plateau`.

---

## Task 13 : Vérification

- [ ] **Step 1 :** `npm run lint` → aucune erreur.
- [ ] **Step 2 :** `npm test` → tous les tests au vert.
- [ ] **Step 3 :** `npx tsc --noEmit` → aucune erreur.
- [ ] **Step 4 :** `npm run build` → build réussi.
- [ ] **Step 5 :** rédiger `README.md` : ce que c'est, comment lancer en local, comment configurer Supabase, **comment ajouter un jeu en deux étapes**.
- [ ] **Step 6 :** commit `docs: README`.

---

## Revue du plan

**Couverture de la spec.** §1 → Tasks 1, 12. §2 → Task 1. §3 (autorité, secrets, aléa) → Tasks 2, 10, 11. §4 (contrat) → Tasks 3, 9. §5 (données) → Task 10. §6 (les 4 jeux) → Tasks 4 à 7. §7 (Plateau) → Task 8. §8 (structure) → carte des fichiers. §9 (tests) → chaque task, plus Task 13. §10 (risques) : la latence est traitée en Task 5 et 12 step 2, le joueur AFK par les délais de phase en Task 11, le transfert d'hôte en Task 11 step 2, la pureté par la règle ESLint en Task 1 step 4, le plafond de 30 joueurs en Task 11 step 2.

**Cohérence de nommage.** `GameResult.ranking` et `GameResult.sips` sont employés à l'identique dans les Tasks 4 à 8. `machine.reduce` et `machine.view` conservent la signature du §4.1 partout.
