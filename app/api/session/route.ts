import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createRng } from '@/engine/rng'
import { InvalidActionError } from '@/engine/types'
import { MAX_PLAYERS_PER_SESSION, generateCode } from '@/engine/session'
import { isAvatar } from '@/shared/avatars'
import { fail } from '@/server/http'
import { serviceClient } from '@/server/supabase'
import {
  authenticate,
  getPlayers,
  getSession,
  getSessionByCode,
  requireActive,
  requireHost,
  type SessionRow,
} from '@/server/store'
import {
  backToLobby,
  closeBetting,
  loadRoundForSession,
  startRound,
} from '@/server/orchestrator'

export const dynamic = 'force-dynamic'

const pseudo = z.string().trim().min(1, 'Il faut un pseudo').max(20)
const avatar = z.string().refine(isAvatar, 'Avatar inconnu')

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    nickname: pseudo,
    avatar,
    mode: z.enum(['free', 'board']),
    totalRounds: z.number().int().min(5).max(30).optional(),
  }),
  z.object({
    action: z.literal('join'),
    code: z.string().trim().length(4),
    nickname: pseudo,
    avatar,
  }),
  z.object({
    action: z.enum(['start', 'next', 'lobby', 'close-bets', 'leave']),
    sessionId: z.string().uuid(),
    playerId: z.string().uuid(),
    token: z.string().min(8),
    gameKey: z.string().optional(),
  }),
])

async function createPlayer(
  sessionId: string,
  nickname: string,
  avatarChoisi: string,
): Promise<{ playerId: string; token: string }> {
  const db = serviceClient()

  const { data, error } = await db
    .from('players')
    .insert({ session_id: sessionId, nickname, avatar: avatarChoisi })
    .select('id')
    .single()

  if (error) throw error

  const token = crypto.randomUUID()
  const { error: secretError } = await db
    .from('player_secrets')
    .insert({ player_id: data.id as string, token })

  if (secretError) throw secretError

  return { playerId: data.id as string, token }
}

/** Insère la session en retentant sur collision de code. */
async function createSession(mode: 'free' | 'board'): Promise<SessionRow> {
  const db = serviceClient()

  for (let essai = 0; essai < 12; essai++) {
    const code = generateCode(createRng(crypto.randomUUID()))
    const { data, error } = await db
      .from('sessions')
      .insert({ code, mode })
      .select('*')
      .single()

    if (!error) return data as SessionRow
    // 23505 = violation de contrainte d'unicité : le code était déjà pris.
    if (error.code !== '23505') throw error
  }

  throw new Error('Impossible de générer un code d’invitation libre.')
}

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json())
    const db = serviceClient()

    if (body.action === 'create') {
      const session = await createSession(body.mode)
      const { playerId, token } = await createPlayer(session.id, body.nickname, body.avatar)

      // Le plateau n'est PAS créé ici : à cet instant l'hôte est seul, et un
      // plateau à un joueur n'a aucun sens. On mémorise seulement le nombre de
      // manches ; l'anneau sera posé au lancement, quand la table est complète.
      await db
        .from('sessions')
        .update({
          host_player_id: playerId,
          ...(body.mode === 'board' ? { settings: { totalRounds: body.totalRounds ?? 15 } } : {}),
        })
        .eq('id', session.id)

      return NextResponse.json({ sessionId: session.id, code: session.code, playerId, token })
    }

    if (body.action === 'join') {
      const session = await getSessionByCode(body.code)
      requireActive(session)
      const joueurs = await getPlayers(session.id)

      if (joueurs.length >= MAX_PLAYERS_PER_SESSION) {
        throw new InvalidActionError(
          `Cette soirée est pleine (${MAX_PLAYERS_PER_SESSION} joueurs).`,
        )
      }

      const { playerId, token } = await createPlayer(session.id, body.nickname, body.avatar)

      // Une arrivée est une activité : sans ça, une soirée où les gens
      // continuent d'affluer pourrait expirer pendant qu'elle se remplit.
      await db
        .from('sessions')
        .update({
          last_activity_at: new Date().toISOString(),
          ...(session.host_player_id ? {} : { host_player_id: playerId }),
        })
        .eq('id', session.id)

      return NextResponse.json({ sessionId: session.id, code: session.code, playerId, token })
    }

    // À partir d'ici, toute action exige une identité vérifiée. Les deux
    // lectures sont indépendantes : on ne les enchaîne pas.
    const [joueur, session] = await Promise.all([
      authenticate(body.playerId, body.token),
      getSession(body.sessionId),
    ])

    if (joueur.session_id !== session.id) {
      throw new InvalidActionError('Tu n’appartiens pas à cette soirée.')
    }

    // Quitter reste possible sur une soirée close ; relancer une manche non.
    if (body.action !== 'leave') requireActive(session)

    switch (body.action) {
      case 'leave': {
        const estHote = session.host_player_id === joueur.id
        await db.from('players').delete().eq('id', joueur.id)

        // Quand l'hôte s'en va, la soirée ferme pour tout le monde plutôt que
        // de continuer sans celui qui la menait. Les autres voient un message
        // explicite au lieu d'un salon qui ne répond plus.
        if (estHote) {
          await db
            .from('sessions')
            .update({ status: 'closed', last_activity_at: new Date().toISOString() })
            .eq('id', session.id)
        }

        return NextResponse.json({ ok: true, ferme: estHote })
      }

      case 'close-bets': {
        const round = await loadRoundForSession(session)
        if (!round) throw new InvalidActionError('Aucune manche en cours.')
        await closeBetting(round)
        return NextResponse.json({ ok: true })
      }

      case 'start': {
        await requireHost(session, joueur.id)
        const round = await startRound(session, { gameKey: body.gameKey })
        return NextResponse.json({ roundId: round.id })
      }

      case 'next': {
        await requireHost(session, joueur.id)
        if (session.mode === 'board') {
          const round = await startRound(session)
          return NextResponse.json({ roundId: round.id })
        }
        await backToLobby(session)
        return NextResponse.json({ ok: true })
      }

      case 'lobby': {
        await requireHost(session, joueur.id)
        await backToLobby(session)
        return NextResponse.json({ ok: true })
      }
    }
  } catch (error) {
    return fail(error)
  }
}
