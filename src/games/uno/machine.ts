/**
 * UNO.
 *
 * Le point qui demande le plus d'attention est le cumul des pioches :
 *
 *   — un +2 peut être posé sur un +2, la chaîne grossit ;
 *   — un +4 peut être posé sur un +2, la chaîne grossit et se durcit ;
 *   — un +2 ne peut PAS être posé sur un +4.
 *
 * Autrement dit la chaîne ne redescend jamais en gamme : une fois qu'un +4 est
 * tombé, seuls des +4 peuvent poursuivre. Celui qui ne peut ou ne veut pas
 * surenchérir ramasse tout, et boit autant de gorgées qu'il y avait de cartes
 * empilées — ce qui rend la surenchère aussi tentante que dangereuse.
 *
 * Les mains restent dans l'état secret : `view` ne rend à chaque joueur que la
 * sienne. Le public ne voit que le NOMBRE de cartes de chacun.
 */

import { z } from 'zod'
import { shuffle, type Rng } from '@/engine/rng'
import {
  InvalidActionError,
  type BasePublicState,
  type GameMachine,
  type GameResult,
  type GameState,
  type PlayerId,
  type ReduceOutcome,
} from '@/engine/types'
import {
  COULEURS,
  construireJeu,
  estJoker,
  estPioche,
  type CarteUno,
  type Couleur,
} from './cartes'
import {
  UNO_MAIN_DEPART,
  UNO_PENALITE_UNO_CARTES,
  UNO_PENALITE_UNO_SIPS,
  UNO_SIPS_MAX_CHAINE,
  UNO_SIPS_MAX_FIN,
  UNO_TOUR_TIMEOUT_MS,
} from './definition'

export interface UnoPublic extends BasePublicState {
  phase: 'tour' | 'apres-pioche' | 'over'
  order: PlayerId[]
  currentIndex: number
  /** 1 = ordre des places, -1 = sens inverse. */
  sens: 1 | -1
  dessus: CarteUno
  /** Couleur en vigueur : diffère de celle du dessus après un joker. */
  couleur: Couleur
  /** Nombre de cartes en main. Leur contenu, lui, reste privé. */
  mains: Record<PlayerId, number>
  /** Cartes que devra ramasser celui qui ne surenchérit pas. */
  pileEnAttente: number
  /** Nombre de cartes empilées : c'est lui qui fixe les gorgées. */
  chaine: number
  /** La chaîne comporte-t-elle un +4 ? Si oui, un +2 ne peut plus la poursuivre. */
  chaineEstPlus4: boolean
  gagnant: PlayerId | null
  sips: Record<PlayerId, number>
  cartesAuTalon: number
  journal: string[]
}

export interface UnoSecret {
  mains: Record<PlayerId, CarteUno[]>
  talon: CarteUno[]
  defausse: CarteUno[]
  /** Carte tout juste piochée, en attente de décision. */
  piochee: CarteUno | null
}

export type UnoState = GameState<UnoPublic, UnoSecret>

const couleurSchema = z.enum(['rouge', 'jaune', 'vert', 'bleu'])

export const unoActionSchema = z.union([
  z.object({
    type: z.literal('play'),
    index: z.number().int().min(0).max(200),
    couleur: couleurSchema.optional(),
    uno: z.boolean().optional(),
  }),
  z.object({ type: z.literal('draw') }),
  z.object({
    type: z.literal('play-piochee'),
    couleur: couleurSchema.optional(),
    uno: z.boolean().optional(),
  }),
  z.object({ type: z.literal('passer') }),
  z.object({ type: z.literal('timeout') }),
])

export type UnoAction = z.infer<typeof unoActionSchema>

const LIMITE_JOURNAL = 12

/* ------------------------------------------------------------- utilitaires */

function joueurCourant(pub: UnoPublic): PlayerId {
  const id = pub.order[pub.currentIndex]
  if (id === undefined) throw new Error('Index de tour invalide')
  return id
}

function indexSuivant(pub: UnoPublic, sauts = 1): number {
  const n = pub.order.length
  return (((pub.currentIndex + pub.sens * sauts) % n) + n) % n
}

/**
 * Une carte est-elle posable ?
 *
 * Quand une chaîne de pioches est en cours, plus rien d'autre ne passe : il
 * faut surenchérir ou ramasser.
 */
export function estJouable(
  carte: CarteUno,
  couleur: Couleur,
  dessus: CarteUno,
  pileEnAttente: number,
  chaineEstPlus4: boolean,
): boolean {
  if (pileEnAttente > 0) {
    if (carte.valeur === 'plus4') return true
    // Le cœur de la règle : un +2 ne relève pas un +4.
    if (carte.valeur === 'plus2') return !chaineEstPlus4
    return false
  }

  if (estJoker(carte)) return true
  if (carte.couleur === couleur) return true
  return carte.valeur === dessus.valeur
}

/** Pioche `combien` cartes, en remélangeant la défausse si le talon s'épuise. */
function piocher(
  secret: UnoSecret,
  combien: number,
  rng: Rng,
): { cartes: CarteUno[]; talon: CarteUno[]; defausse: CarteUno[] } {
  let talon = [...secret.talon]
  let defausse = [...secret.defausse]
  const cartes: CarteUno[] = []

  for (let i = 0; i < combien; i++) {
    if (talon.length === 0) {
      if (defausse.length === 0) break // plus une seule carte disponible
      talon = shuffle(defausse, rng)
      defausse = []
    }
    const carte = talon.shift()
    if (carte === undefined) break
    cartes.push(carte)
  }

  return { cartes, talon, defausse }
}

function compterMains(mains: Record<PlayerId, CarteUno[]>): Record<PlayerId, number> {
  return Object.fromEntries(Object.entries(mains).map(([id, cartes]) => [id, cartes.length]))
}

function buildResult(pub: UnoPublic): GameResult {
  // Le moins de cartes en main l'emporte ; le vainqueur en a zéro.
  const groupes = new Map<number, PlayerId[]>()
  for (const id of pub.order) {
    const n = pub.mains[id] ?? 0
    groupes.set(n, [...(groupes.get(n) ?? []), id])
  }

  return {
    ranking: [...groupes.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids),
    sips: { ...pub.sips },
  }
}

function avecJournal(pub: UnoPublic, ligne: string): string[] {
  return [...pub.journal, ligne].slice(-LIMITE_JOURNAL)
}

/* ------------------------------------------------------- effets des cartes */

interface Application {
  pub: UnoPublic
  secret: UnoSecret
}

/** Applique une carte posée : effet, couleur, avancement du tour. */
function poser(
  pub: UnoPublic,
  secret: UnoSecret,
  joueur: PlayerId,
  carte: CarteUno,
  couleurChoisie: Couleur | undefined,
  mainRestante: CarteUno[],
): Application {
  const mains = { ...secret.mains, [joueur]: mainRestante }

  let sens = pub.sens
  let sauts = 1
  let pileEnAttente = pub.pileEnAttente
  let chaine = pub.chaine
  let chaineEstPlus4 = pub.chaineEstPlus4
  let couleur = estJoker(carte) ? (couleurChoisie ?? pub.couleur) : (carte.couleur as Couleur)

  switch (carte.valeur) {
    case 'passe':
      sauts = 2
      break

    case 'inversion':
      // À deux, inverser revient à sauter : sans ça, on rejouerait à l'infini.
      if (pub.order.length === 2) sauts = 2
      else sens = (pub.sens * -1) as 1 | -1
      break

    case 'plus2':
      pileEnAttente += 2
      chaine += 1
      chaineEstPlus4 = false
      break

    case 'plus4':
      pileEnAttente += 4
      chaine += 1
      chaineEstPlus4 = true
      break

    default:
      break
  }

  if (!estJoker(carte)) couleur = carte.couleur as Couleur

  const intermediaire: UnoPublic = { ...pub, sens }

  return {
    pub: {
      ...intermediaire,
      currentIndex: indexSuivant(intermediaire, sauts),
      dessus: carte,
      couleur,
      mains: compterMains(mains),
      pileEnAttente,
      chaine,
      chaineEstPlus4,
    },
    secret: { ...secret, mains, defausse: [...secret.defausse, pub.dessus], piochee: null },
  }
}

/* ------------------------------------------------------------- la machine  */

export const unoMachine: GameMachine<UnoState, UnoAction> = {
  init(ctx) {
    const order = [...ctx.participants]
    if (order.length < 2) throw new Error('Le UNO exige au moins deux joueurs.')

    let paquet = shuffle(construireJeu(), ctx.rng)

    const mains: Record<PlayerId, CarteUno[]> = {}
    for (const id of order) {
      mains[id] = paquet.slice(0, UNO_MAIN_DEPART)
      paquet = paquet.slice(UNO_MAIN_DEPART)
    }

    // La première carte retournée doit être un chiffre : démarrer sur un +4 ou
    // une inversion obligerait à traiter des cas particuliers qui n'apportent
    // rien, et personne autour d'une table ne joue autrement.
    let depart = paquet.shift()
    const ecartees: CarteUno[] = []
    while (depart && (estJoker(depart) || estPioche(depart) || depart.valeur === 'passe' || depart.valeur === 'inversion')) {
      ecartees.push(depart)
      depart = paquet.shift()
    }
    if (!depart) throw new Error('Impossible de constituer une carte de départ')

    return {
      public: {
        phase: 'tour',
        deadlineAt: ctx.now + UNO_TOUR_TIMEOUT_MS,
        order,
        currentIndex: 0,
        sens: 1,
        dessus: depart,
        couleur: depart.couleur as Couleur,
        mains: compterMains(mains),
        pileEnAttente: 0,
        chaine: 0,
        chaineEstPlus4: false,
        gagnant: null,
        sips: Object.fromEntries(order.map((id) => [id, 0])),
        cartesAuTalon: paquet.length + ecartees.length,
        journal: [],
      },
      secret: {
        mains,
        talon: [...paquet, ...shuffle(ecartees, ctx.rng)],
        defausse: [],
        piochee: null,
      },
    }
  },

  parseAction(raw) {
    return unoActionSchema.parse(raw)
  },

  reduce(state, action, ctx): ReduceOutcome<UnoState> {
    const pub = state.public

    if (pub.phase === 'over') {
      throw new InvalidActionError('La partie est terminée.')
    }

    const tour = joueurCourant(pub)

    if (action.type === 'timeout') {
      if (pub.deadlineAt === null || ctx.now < pub.deadlineAt) {
        throw new InvalidActionError('Le tour n’a pas encore expiré.')
      }
      // Un joueur absent ramasse : la partie ne s'arrête pas pour lui.
      return appliquerPioche(state, tour, ctx, true)
    }

    if (ctx.actor !== tour) {
      throw new InvalidActionError('Ce n’est pas ton tour.')
    }

    /* ------------------------------------------- décision après une pioche */
    if (pub.phase === 'apres-pioche') {
      if (action.type === 'passer') {
        return finDeTour(
          { ...pub, phase: 'tour', currentIndex: indexSuivant(pub) },
          { ...state.secret, piochee: null },
          ctx,
          `${tour} passe son tour.`,
        )
      }

      if (action.type !== 'play-piochee') {
        throw new InvalidActionError('Tu viens de piocher : joue cette carte ou passe.')
      }

      const carte = state.secret.piochee
      if (!carte) throw new InvalidActionError('Aucune carte piochée.')
      if (!estJouable(carte, pub.couleur, pub.dessus, pub.pileEnAttente, pub.chaineEstPlus4)) {
        throw new InvalidActionError('Cette carte n’est pas jouable.')
      }
      if (estJoker(carte) && !action.couleur) {
        throw new InvalidActionError('Choisis une couleur.')
      }

      const main = [...(state.secret.mains[tour] ?? [])]
      const position = main.findIndex((c) => c.couleur === carte.couleur && c.valeur === carte.valeur)
      if (position >= 0) main.splice(position, 1)

      const applique = poser(
        { ...pub, phase: 'tour' },
        { ...state.secret, piochee: null },
        tour,
        carte,
        action.couleur,
        main,
      )
      return conclure(applique, tour, carte, action.uno === true, ctx)
    }

    /* ---------------------------------------------------------- pioche     */
    if (action.type === 'draw') {
      return appliquerPioche(state, tour, ctx, false)
    }

    if (action.type === 'passer' || action.type === 'play-piochee') {
      throw new InvalidActionError('Tu n’as pas encore pioché.')
    }

    /* ---------------------------------------------------------- pose       */
    const main = [...(state.secret.mains[tour] ?? [])]
    const carte = main[action.index]
    if (!carte) throw new InvalidActionError('Cette carte n’est pas dans ta main.')

    if (!estJouable(carte, pub.couleur, pub.dessus, pub.pileEnAttente, pub.chaineEstPlus4)) {
      throw new InvalidActionError(
        pub.pileEnAttente > 0
          ? pub.chaineEstPlus4
            ? 'Seul un +4 peut relever un +4. Sinon, ramasse.'
            : 'Il faut surenchérir avec un +2 ou un +4, ou ramasser.'
          : 'Cette carte ne va ni avec la couleur ni avec le symbole.',
      )
    }
    if (estJoker(carte) && !action.couleur) {
      throw new InvalidActionError('Choisis une couleur.')
    }

    main.splice(action.index, 1)
    const applique = poser(pub, state.secret, tour, carte, action.couleur, main)
    return conclure(applique, tour, carte, action.uno === true, ctx)
  },

  view(state, viewer) {
    return {
      publicView: state.public,
      // Chacun ne voit QUE sa main. Le public n'a droit qu'aux effectifs.
      privateView: {
        main: state.secret.mains[viewer] ?? [],
        piochee: state.public.phase === 'apres-pioche' ? state.secret.piochee : null,
      },
    }
  },
}

/* --------------------------------------------------- suites d'un coup joué */

/** Referme le tour : sanction du UNO oublié, victoire, ou passage au suivant. */
function conclure(
  applique: Application,
  joueur: PlayerId,
  carte: CarteUno,
  aDitUno: boolean,
  ctx: { now: number; rng: Rng },
): ReduceOutcome<UnoState> {
  let { pub, secret } = applique
  const restantes = secret.mains[joueur]?.length ?? 0

  // Victoire.
  if (restantes === 0) {
    const sips = { ...pub.sips }
    for (const id of pub.order) {
      if (id === joueur) continue
      sips[id] = (sips[id] ?? 0) + Math.min(pub.mains[id] ?? 0, UNO_SIPS_MAX_FIN)
    }
    const final: UnoPublic = {
      ...pub,
      phase: 'over',
      deadlineAt: null,
      gagnant: joueur,
      sips,
      journal: avecJournal(pub, `${joueur} pose sa dernière carte et gagne.`),
    }
    return {
      state: { public: final, secret },
      events: [{ type: 'victoire', player: joueur }],
      result: buildResult(final),
    }
  }

  // UNO oublié : il reste une carte et l'annonce n'a pas été faite.
  if (restantes === 1 && !aDitUno) {
    const tirage = piocher(secret, UNO_PENALITE_UNO_CARTES, ctx.rng)
    const main = [...(secret.mains[joueur] ?? []), ...tirage.cartes]
    secret = { ...secret, mains: { ...secret.mains, [joueur]: main }, talon: tirage.talon, defausse: tirage.defausse }
    pub = {
      ...pub,
      mains: compterMains(secret.mains),
      sips: { ...pub.sips, [joueur]: (pub.sips[joueur] ?? 0) + UNO_PENALITE_UNO_SIPS },
      cartesAuTalon: tirage.talon.length,
      journal: avecJournal(pub, `${joueur} a oublié d’annoncer UNO : +2 cartes, ${UNO_PENALITE_UNO_SIPS} gorgées.`),
    }
  } else if (restantes === 1) {
    pub = { ...pub, journal: avecJournal(pub, `${joueur} annonce UNO !`) }
  }

  return finDeTour(pub, secret, ctx, null, carte, joueur)
}

/** Pose la nouvelle échéance et emballe la sortie. */
function finDeTour(
  pub: UnoPublic,
  secret: UnoSecret,
  ctx: { now: number },
  ligne: string | null,
  carte?: CarteUno,
  joueur?: PlayerId,
): ReduceOutcome<UnoState> {
  const journal = ligne ? avecJournal(pub, ligne) : pub.journal

  return {
    state: {
      public: { ...pub, journal, deadlineAt: ctx.now + UNO_TOUR_TIMEOUT_MS },
      secret,
    },
    events: carte && joueur ? [{ type: 'pose', player: joueur, carte }] : [],
  }
}

/**
 * Le joueur pioche.
 *
 * Deux situations très différentes : soit une chaîne l'attend et il ramasse
 * tout puis saute son tour, soit il prend une carte et peut la jouer dans la
 * foulée si elle passe.
 */
function appliquerPioche(
  state: UnoState,
  joueur: PlayerId,
  ctx: { now: number; rng: Rng },
  force: boolean,
): ReduceOutcome<UnoState> {
  const pub = state.public

  if (pub.pileEnAttente > 0) {
    const tirage = piocher(state.secret, pub.pileEnAttente, ctx.rng)
    const main = [...(state.secret.mains[joueur] ?? []), ...tirage.cartes]
    const gorgees = Math.min(pub.chaine, UNO_SIPS_MAX_CHAINE)

    const secret: UnoSecret = {
      ...state.secret,
      mains: { ...state.secret.mains, [joueur]: main },
      talon: tirage.talon,
      defausse: tirage.defausse,
      piochee: null,
    }

    const suivant: UnoPublic = {
      ...pub,
      phase: 'tour',
      currentIndex: indexSuivant(pub),
      mains: compterMains(secret.mains),
      pileEnAttente: 0,
      chaine: 0,
      chaineEstPlus4: false,
      sips: { ...pub.sips, [joueur]: (pub.sips[joueur] ?? 0) + gorgees },
      cartesAuTalon: tirage.talon.length,
      journal: avecJournal(
        pub,
        `${joueur} ramasse ${tirage.cartes.length} cartes et boit ${gorgees}.`,
      ),
    }

    return {
      state: { public: { ...suivant, deadlineAt: ctx.now + UNO_TOUR_TIMEOUT_MS }, secret },
      events: [{ type: 'ramasse', player: joueur, cartes: tirage.cartes.length, gorgees }],
    }
  }

  const tirage = piocher(state.secret, 1, ctx.rng)
  const piochee = tirage.cartes[0] ?? null
  const main = [...(state.secret.mains[joueur] ?? []), ...(piochee ? [piochee] : [])]

  const secret: UnoSecret = {
    ...state.secret,
    mains: { ...state.secret.mains, [joueur]: main },
    talon: tirage.talon,
    defausse: tirage.defausse,
    piochee,
  }

  const jouable =
    piochee !== null &&
    !force &&
    estJouable(piochee, pub.couleur, pub.dessus, pub.pileEnAttente, pub.chaineEstPlus4)

  const suivant: UnoPublic = {
    ...pub,
    phase: jouable ? 'apres-pioche' : 'tour',
    currentIndex: jouable ? pub.currentIndex : indexSuivant(pub),
    mains: compterMains(secret.mains),
    cartesAuTalon: tirage.talon.length,
    deadlineAt: ctx.now + UNO_TOUR_TIMEOUT_MS,
    journal: avecJournal(pub, `${joueur} pioche.`),
  }

  return {
    state: { public: suivant, secret: jouable ? secret : { ...secret, piochee: null } },
    events: [{ type: 'pioche', player: joueur }],
  }
}

export { COULEURS }
