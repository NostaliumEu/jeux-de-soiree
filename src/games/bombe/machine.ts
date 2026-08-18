/**
 * Bombe Party — le jeu de syllabes.
 *
 * Une syllabe s'affiche, celui qui tient la bombe doit trouver un mot qui la
 * contient. Mot valide : la bombe passe au suivant avec une nouvelle syllabe.
 * Mot refusé : rien ne se passe, et la mèche continue de brûler.
 *
 * Le point de règle qui fait tout le sel : **la mèche ne se rallume qu'à
 * l'explosion**. Répondre vite ne remet pas le compteur à zéro, ça refile
 * simplement une bombe déjà bien entamée au voisin. C'est ce qui transforme un
 * exercice de vocabulaire en jeu de nerfs.
 *
 * Le dictionnaire — 263 000 mots — est importé ici et nulle part ailleurs.
 * L'écran passe par `./types`, ce qui garantit qu'il ne descend jamais dans le
 * navigateur.
 */

import {
  InvalidActionError,
  type GameMachine,
  type GameResult,
  type GameState,
  type PlayerId,
  type ReduceOutcome,
} from '@/engine/types'
import type { Rng } from '@/engine/rng'
import dictionnaire from './content/mots.fr.json'
import listeSyllabes from './content/syllabes.fr.json'
import type { BombeAction, BombePublic, CoupBombe } from './types'
import {
  BOMBE_HISTORIQUE,
  BOMBE_MAX_MS,
  BOMBE_MIN_MS,
  BOMBE_MOT_MAX,
  BOMBE_MOT_MIN,
  BOMBE_SIPS_ELIMINATION,
  BOMBE_SIPS_EXPLOSION,
  BOMBE_VIES,
} from './definition'

/** Construit une seule fois, puis réutilisé par toutes les manches du serveur. */
const MOTS: ReadonlySet<string> = new Set(dictionnaire.mots.split(' '))
const SYLLABES: readonly string[] = listeSyllabes.syllabes

export interface BombeSecret {
  /** Tous les mots déjà employés : on ne rejoue pas deux fois le même. */
  utilises: string[]
}

export type BombeState = GameState<BombePublic, BombeSecret>

/** Minuscules, sans accent : on n'exige pas d'un joueur pressé qu'il tape « à ». */
export function normaliser(mot: string): string {
  return mot
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function existe(mot: string): boolean {
  return MOTS.has(mot)
}

export function tirerSyllabe(rng: Rng): string {
  return rng.pick(SYLLABES)
}

function zeroed(ids: readonly PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]))
}

function estVivant(pub: BombePublic, id: PlayerId): boolean {
  return (pub.vies[id] ?? 0) > 0
}

function vivants(pub: BombePublic): PlayerId[] {
  return pub.order.filter((id) => estVivant(pub, id))
}

function joueurCourant(pub: BombePublic): PlayerId {
  const id = pub.order[pub.currentIndex]
  if (id === undefined) throw new Error('Index de tour invalide')
  return id
}

/** Prochain joueur encore en vie, en tournant dans l'ordre de table. */
function indexSuivantVivant(pub: BombePublic, depuis: number): number {
  const n = pub.order.length
  for (let pas = 1; pas <= n; pas++) {
    const i = (depuis + pas) % n
    const id = pub.order[i]
    if (id !== undefined && estVivant(pub, id)) return i
  }
  return depuis
}

function allumerMeche(now: number, rng: Rng): { mecheAllumeeA: number; deadlineAt: number } {
  return { mecheAllumeeA: now, deadlineAt: now + rng.intRange(BOMBE_MIN_MS, BOMBE_MAX_MS) }
}

function buildResult(pub: BombePublic): GameResult {
  // Le survivant devant, puis les éliminés du dernier sorti au premier.
  const restants = pub.order.filter((id) => estVivant(pub, id))
  const ranking: PlayerId[][] = [
    ...(restants.length > 0 ? [restants] : []),
    ...[...pub.ordreElimination].reverse().map((id) => [id]),
  ]
  return { ranking, sips: { ...pub.sips } }
}

export const bombeMachine: GameMachine<BombeState, BombeAction> = {
  init(ctx) {
    const order = [...ctx.participants]
    if (order.length < 2) throw new Error('Bombe Party exige au moins deux joueurs.')

    const meche = allumerMeche(ctx.now, ctx.rng)

    return {
      public: {
        phase: 'jeu',
        ...meche,
        order,
        currentIndex: 0,
        vies: Object.fromEntries(order.map((id) => [id, BOMBE_VIES])),
        ordreElimination: [],
        syllabe: tirerSyllabe(ctx.rng),
        motsRecents: [],
        explosions: zeroed(order),
        sips: zeroed(order),
        gagnant: null,
        dernierCoup: null,
      },
      secret: { utilises: [] },
    }
  },

  parseAction(raw) {
    if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
      throw new Error('Action malformée')
    }
    const brut = raw as { type: unknown; mot?: unknown }
    if (brut.type === 'timeout') return { type: 'timeout' }
    if (brut.type === 'mot') {
      if (typeof brut.mot !== 'string' || brut.mot.length === 0 || brut.mot.length > 40) {
        throw new Error('Mot malformé')
      }
      return { type: 'mot', mot: brut.mot }
    }
    throw new Error('Action inconnue')
  },

  reduce(state, action, ctx): ReduceOutcome<BombeState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La partie est terminée.')
    }

    const tenant = joueurCourant(pub)

    /* -------------------------------------------------------- l'explosion */
    if (action.type === 'timeout') {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('La mèche brûle encore.')
      }

      const viesRestantes = Math.max(0, (pub.vies[tenant] ?? 0) - 1)
      const elimine = viesRestantes === 0

      const apres: BombePublic = {
        ...pub,
        vies: { ...pub.vies, [tenant]: viesRestantes },
        sips: {
          ...pub.sips,
          [tenant]:
            (pub.sips[tenant] ?? 0) +
            BOMBE_SIPS_EXPLOSION +
            (elimine ? BOMBE_SIPS_ELIMINATION : 0),
        },
        explosions: { ...pub.explosions, [tenant]: (pub.explosions[tenant] ?? 0) + 1 },
        ordreElimination: elimine ? [...pub.ordreElimination, tenant] : pub.ordreElimination,
        dernierCoup: { player: tenant, mot: '', valide: false, raison: 'La bombe a explosé.' },
      }

      const encoreLa = vivants(apres)

      if (encoreLa.length <= 1) {
        const final: BombePublic = {
          ...apres,
          phase: 'over',
          deadlineAt: null,
          gagnant: encoreLa[0] ?? null,
        }
        return {
          state: { public: final, secret: state.secret },
          events: [{ type: 'fin', gagnant: final.gagnant }],
          result: buildResult(final),
        }
      }

      // Nouvelle mèche, nouvelle syllabe, et la main passe au suivant.
      const suivant: BombePublic = {
        ...apres,
        ...allumerMeche(ctx.now, ctx.rng),
        currentIndex: indexSuivantVivant(apres, pub.currentIndex),
        syllabe: tirerSyllabe(ctx.rng),
      }

      return {
        state: { public: suivant, secret: state.secret },
        events: [{ type: 'explosion', player: tenant, elimine }],
      }
    }

    /* ------------------------------------------------------------- un mot */
    if (ctx.actor !== tenant) {
      throw new InvalidActionError('Ce n’est pas ton tour.')
    }

    const mot = normaliser(action.mot)

    if (mot.length < BOMBE_MOT_MIN) {
      throw new InvalidActionError(`Trop court : ${BOMBE_MOT_MIN} lettres minimum.`)
    }
    if (mot.length > BOMBE_MOT_MAX) {
      throw new InvalidActionError(`Trop long : ${BOMBE_MOT_MAX} lettres maximum.`)
    }
    if (!/^[a-z]+$/.test(mot)) {
      throw new InvalidActionError('Des lettres, rien d’autre.')
    }
    if (!mot.includes(pub.syllabe)) {
      throw new InvalidActionError(`Il faut « ${pub.syllabe} » dedans.`)
    }
    if (state.secret.utilises.includes(mot)) {
      throw new InvalidActionError('Déjà joué.')
    }
    if (!existe(mot)) {
      throw new InvalidActionError('Inconnu au dictionnaire.')
    }

    const coup: CoupBombe = { player: tenant, mot, valide: true }

    // La mèche N'EST PAS rallumée : le suivant hérite du temps restant.
    const suivant: BombePublic = {
      ...pub,
      currentIndex: indexSuivantVivant(pub, pub.currentIndex),
      syllabe: tirerSyllabe(ctx.rng),
      motsRecents: [mot, ...pub.motsRecents].slice(0, BOMBE_HISTORIQUE),
      dernierCoup: coup,
    }

    return {
      state: {
        public: suivant,
        secret: { utilises: [...state.secret.utilises, mot] },
      },
      events: [{ type: 'mot', player: tenant, mot }],
    }
  },

  view(state) {
    // Rien de personnel : tout le monde voit la même syllabe et la même mèche.
    return { publicView: state.public, privateView: null }
  },
}
