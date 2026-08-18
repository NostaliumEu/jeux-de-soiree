/**
 * Cycle de vie d'une manche : c'est ici que le moteur, les jeux et les modes
 * sont assemblés. Aucune règle de jeu n'est écrite dans ce fichier — il se
 * contente d'appeler les machines et de persister leur sortie.
 */

import { after } from 'next/server'
import { createRng } from '@/engine/rng'
import { getGame } from '@/engine/registry'
import { pickFormat, pickGame, pickParticipants } from '@/engine/session'
import {
  InvalidActionError,
  type GameFormat,
  type GameResult,
  type GameState,
  type PlayerId,
} from '@/engine/types'
import {
  applyRound,
  initBoard,
  resolveDuel,
  resolveTournee,
  type BoardState,
} from '@/modes/board/machine'
import { serviceClient } from './supabase'
import {
  ForbiddenError,
  addSips,
  getBoardState,
  getPlayers,
  getRound,
  getRoundState,
  logAction,
  markSeen,
  saveBoardState,
  savePlayerViews,
  saveRoundState,
  saveRoundStateSi,
  touchSession,
  type PlayerRow,
  type RoundRow,
  type SessionRow,
} from './store'

/**
 * Nombre de tentatives d écriture avant d abandonner. Une collision est rare
 * et se résout au premier réessai ; au-dela, c est que la table s emballe.
 */
const MAX_REESSAIS = 5

/** Fenêtre laissée aux spectateurs pour parier, en mode Plateau. */
export const BET_WINDOW_MS = 15_000

export interface StartRoundOptions {
  /** Imposé en mode libre, ignoré en mode Plateau. */
  gameKey?: string
}

function seedRng(seed: string, salt: string | number) {
  return createRng(`${seed}:${salt}`)
}

function participationMap(players: PlayerRow[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {}
  for (const p of players) out[p.id] = p.participations
  return out
}

export async function startRound(
  session: SessionRow,
  options: StartRoundOptions = {},
): Promise<RoundRow> {
  const db = serviceClient()
  const players = await getPlayers(session.id)
  if (players.length < 2) {
    throw new InvalidActionError('Il faut au moins deux joueurs pour lancer une manche.')
  }

  const ids = players.map((p) => p.id)
  const seed = crypto.randomUUID()
  const rng = seedRng(seed, 'setup')

  let gameKey: string
  let format: GameFormat
  let participants: PlayerId[]

  let board: BoardState | null = null

  if (session.mode === 'board') {
    board = (await getBoardState(session.id)) as BoardState | null

    // Première manche : c'est ici qu'on pose l'anneau, pas à la création de la
    // soirée — à ce moment-là l'hôte était seul et le plateau n'aurait eu
    // aucun sens.
    if (!board) {
      board = initBoard(ids, session.settings.totalRounds ?? 15, seedRng(seed, 'plateau'))
      await saveBoardState(session.id, board)
    } else {
      let modifie = false
      let courant = board

      // Un joueur n'a jamais répondu à sa Tournée ou à son Duel. Une soirée ne
      // doit jamais se bloquer sur quelqu'un parti aux toilettes : on abandonne
      // l'effet et on le dit.
      if (courant.pendings.length > 0) {
        const abandonnes = courant.pendings.map((p) => p.kind).join(', ')
        courant = {
          ...courant,
          pendings: [],
          log: [...courant.log, `Effet de case abandonné faute de réponse : ${abandonnes}.`],
        }
        modifie = true
      }

      // Les gens arrivent en cours de soirée : ils entrent sur le plateau au
      // départ plutôt que de rester sans pion pour le reste de la partie.
      const connus = new Set(courant.players.map((p) => p.id))
      const nouveaux = ids.filter((id) => !connus.has(id))
      if (nouveaux.length > 0) {
        courant = {
          ...courant,
          players: [
            ...courant.players,
            ...nouveaux.map((id) => ({ id, position: 0, stars: 0, distance: 0 })),
          ],
          sips: { ...Object.fromEntries(nouveaux.map((id) => [id, 0])), ...courant.sips },
          log: [...courant.log, `${nouveaux.length} joueur(s) entrent sur le plateau.`],
        }
        modifie = true
      }

      if (modifie) {
        board = { ...courant, log: courant.log.slice(-40) }
        await saveBoardState(session.id, board)
      }
    }
  }

  if (board?.forcedDuel) {
    // Une case Duel a programmé un affrontement : il prime sur le tirage.
    const duel = getGame('faux-depart')
    gameKey = duel.definition.key
    format = 'duel'
    participants = [...board.forcedDuel]
  } else if (session.mode === 'free') {
    if (!options.gameKey) throw new InvalidActionError('Choisis un jeu.')
    const jeu = getGame(options.gameKey)
    if (ids.length < jeu.definition.minPlayers) {
      throw new InvalidActionError(
        `${jeu.definition.name} demande au moins ${jeu.definition.minPlayers} joueurs.`,
      )
    }
    gameKey = jeu.definition.key
    format = jeu.definition.formats[0] as GameFormat
    participants = pickParticipants(ids, format, jeu.definition, participationMap(players), rng)
  } else {
    const jeu = pickGame(ids.length, session.last_game_key, rng, true)
    gameKey = jeu.definition.key
    format = pickFormat(jeu.definition, rng)
    participants = pickParticipants(ids, format, jeu.definition, participationMap(players), rng)
  }

  const jeu = getGame(gameKey)
  const state = jeu.machine.init({
    participants,
    rng: seedRng(seed, 'init'),
    now: Date.now(),
    mode: session.mode,
  })

  const spectateurs = ids.filter((id) => !participants.includes(id))
  // On ne fait patienter la table pour les paris que s'il y a des spectateurs.
  const status = session.mode === 'board' && spectateurs.length > 0 ? 'betting' : 'playing'

  const { data, error } = await db
    .from('rounds')
    .insert({
      session_id: session.id,
      game_key: gameKey,
      format,
      participants,
      status,
      seed,
      bets: {},
    })
    .select('*')
    .single()

  if (error) throw error
  const round = data as RoundRow

  await saveRoundState(round.id, state.public, state.secret, 0)
  await writeViews(round.id, jeu.machine, state, participants)

  await Promise.all([
    db
      .from('sessions')
      .update({
        current_round_id: round.id,
        status: 'playing',
        last_game_key: gameKey,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', session.id),
    ...participants.map((id) => {
      const joueur = players.find((p) => p.id === id)
      return db
        .from('players')
        .update({ participations: (joueur?.participations ?? 0) + 1 })
        .eq('id', id)
    }),
  ])

  if (board?.forcedDuel) {
    await saveBoardState(session.id, { ...board, forcedDuel: null })
  }

  return round
}

async function writeViews(
  roundId: string,
  machine: ReturnType<typeof getGame>['machine'],
  state: GameState,
  participants: readonly PlayerId[],
): Promise<void> {
  await savePlayerViews(
    roundId,
    participants.map((playerId) => ({
      playerId,
      payload: machine.view(state, playerId).privateView,
    })),
  )
}

export async function placeBet(
  round: RoundRow,
  actor: PlayerId,
  target: PlayerId,
): Promise<void> {
  if (round.status !== 'betting') {
    throw new InvalidActionError('Les paris sont fermés.')
  }
  if (round.participants.includes(actor)) {
    throw new InvalidActionError('Tu joues cette manche : tu ne peux pas parier.')
  }
  if (!round.participants.includes(target)) {
    throw new InvalidActionError('Il faut parier sur un joueur de la manche.')
  }
  if (round.bets[actor]) {
    throw new InvalidActionError('Tu as déjà parié.')
  }

  const bets = { ...round.bets, [actor]: target }
  const players = await getPlayers(round.session_id)
  const spectateurs = players.filter((p) => !round.participants.includes(p.id))
  const tousOntParie = spectateurs.every((p) => bets[p.id] !== undefined)

  const { error } = await serviceClient()
    .from('rounds')
    .update({ bets, status: tousOntParie ? 'playing' : 'betting' })
    .eq('id', round.id)

  if (error) throw error
}

/** Ouvre la manche même si tout le monde n'a pas parié, une fois le délai passé. */
export async function closeBetting(round: RoundRow): Promise<void> {
  if (round.status !== 'betting') return

  const echeance = new Date(round.started_at).getTime() + BET_WINDOW_MS
  if (Date.now() < echeance) {
    throw new InvalidActionError('Les paris sont encore ouverts.')
  }

  const { error } = await serviceClient()
    .from('rounds')
    .update({ status: 'playing' })
    .eq('id', round.id)

  if (error) throw error
}

export interface CoupApplique {
  etat: unknown
  /** Version de l'état après écriture : le client refuse ce qui est plus ancien. */
  version: number
}

export async function applyGameAction(
  session: SessionRow,
  round: RoundRow,
  actor: PlayerId,
  payload: unknown,
): Promise<CoupApplique> {
  if (round.status !== 'playing') {
    throw new InvalidActionError(
      round.status === 'betting' ? 'La manche n’a pas encore commencé.' : 'Manche terminée.',
    )
  }

  const jeu = getGame(round.game_key)
  const action = jeu.machine.parseAction(payload)
  const estTimeout = typeof action === 'object' && action !== null && 'type' in action
    ? (action as { type: string }).type === 'timeout'
    : false

  // N'importe qui peut réclamer l'expiration d'une phase — la machine revérifie
  // la date. L'hôte passe aussi, pour pouvoir clore une manche libre. Ce n'est
  // pas un trou : chaque machine valide elle-même l'auteur de l'action, donc
  // l'hôte ne peut pas jouer le tour d'un autre.
  const estHote = actor === session.host_player_id
  if (!estTimeout && !estHote && !round.participants.includes(actor)) {
    throw new ForbiddenError('Tu ne participes pas à cette manche.')
  }

  // Lire, appliquer, écrire — mais l'écriture n'aboutit que si personne n'a
  // touché à l'état entre-temps. Sinon on recommence sur la version fraîche.
  // C'est ce qui empêche deux joueurs simultanés de s'effacer l'un l'autre.
  let outcome: ReturnType<typeof jeu.machine.reduce> | null = null
  let versionEcrite = 0

  for (let essai = 0; essai < MAX_REESSAIS; essai++) {
    const { publicState, secretState, version } = await getRoundState(round.id)
    // L'état revient de Postgres en JSON opaque : c'est la machine du jeu qui
    // en connaît la forme, pas le serveur.
    const state = { public: publicState, secret: secretState } as unknown as GameState

    outcome = jeu.machine.reduce(state, action, {
      rng: seedRng(round.seed, version),
      now: Date.now(),
      mode: session.mode,
      actor,
    })

    const ecrit = await saveRoundStateSi(
      round.id,
      outcome.state.public,
      outcome.state.secret,
      version,
    )
    if (ecrit) {
      versionEcrite = version
      break
    }

    outcome = null
  }

  if (!outcome) {
    throw new InvalidActionError('Ça bouscule un peu, réessaie.')
  }

  await writeViews(round.id, jeu.machine, outcome.state, round.participants)

  if (outcome.result) {
    await finishRound(session, round, outcome.result)
  }

  // Le journal et l'horodatage n'intéressent pas le joueur qui attend sa carte :
  // ils partent après l'envoi de la réponse plutôt que devant elle.
  after(async () => {
    await Promise.all([
      logAction(round.id, actor, payload),
      markSeen(actor),
      ...(outcome.result ? [] : [touchSession(session.id)]),
    ])
  })

  // Rendu à l'appelant pour qu'il affiche le résultat immédiatement, sans
  // attendre l'aller-retour du temps réel. La version accompagne l'état :
  // sans elle, le client ne saurait pas si ce qu'il reçoit est plus récent
  // que ce qu'il affiche déjà.
  return { etat: outcome.state.public, version: versionEcrite + 1 }
}

function deltaSips(
  avant: Record<PlayerId, number>,
  apres: Record<PlayerId, number>,
): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {}
  for (const [id, valeur] of Object.entries(apres)) {
    const ecart = valeur - (avant[id] ?? 0)
    if (ecart > 0) out[id] = ecart
  }
  return out
}

export async function finishRound(
  session: SessionRow,
  round: RoundRow,
  result: GameResult,
): Promise<void> {
  const db = serviceClient()

  await db
    .from('rounds')
    .update({ status: 'done', result, ended_at: new Date().toISOString() })
    .eq('id', round.id)

  if (session.mode === 'board') {
    const avant = (await getBoardState(session.id)) as BoardState | null
    if (!avant) throw new Error('Plateau introuvable.')

    const apres = applyRound(
      avant,
      { participants: round.participants, result, bets: round.bets },
      seedRng(round.seed, 'board'),
    )

    await saveBoardState(session.id, apres)
    // `applyRound` a déjà intégré les gorgées du mini-jeu : on ne compte donc
    // que l'écart, sans quoi elles seraient enregistrées deux fois.
    await addSips(session.id, deltaSips(avant.sips, apres.sips))

    await db
      .from('sessions')
      .update({
        status: apres.finished ? 'finished' : 'results',
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', session.id)
  } else {
    await addSips(session.id, result.sips)
    await db
      .from('sessions')
      .update({ status: 'results', last_activity_at: new Date().toISOString() })
      .eq('id', session.id)
  }
}

export type BoardPendingPayload =
  | { kind: 'tournee'; distribution: Record<PlayerId, number> }
  | { kind: 'duel'; opponent: PlayerId }

/** Résout une case Tournée ou Duel restée en attente d'une décision humaine. */
export async function resolveBoardPending(
  session: SessionRow,
  actor: PlayerId,
  payload: BoardPendingPayload,
): Promise<void> {
  if (session.mode !== 'board') {
    throw new InvalidActionError('Ces effets n’existent qu’en mode Plateau.')
  }

  const avant = (await getBoardState(session.id)) as BoardState | null
  if (!avant) throw new Error('Plateau introuvable.')

  const apres =
    payload.kind === 'tournee'
      ? resolveTournee(avant, actor, payload.distribution)
      : resolveDuel(avant, actor, payload.opponent)

  await saveBoardState(session.id, apres)
  await addSips(session.id, deltaSips(avant.sips, apres.sips))
  await touchSession(session.id)
}

export async function backToLobby(session: SessionRow): Promise<void> {
  await serviceClient()
    .from('sessions')
    .update({
      status: 'lobby',
      current_round_id: null,
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', session.id)
}

export async function loadRoundForSession(session: SessionRow): Promise<RoundRow | null> {
  if (!session.current_round_id) return null
  return getRound(session.current_round_id)
}
