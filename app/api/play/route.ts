import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { InvalidActionError } from '@/engine/types'
import { fail } from '@/server/http'
import { authenticate, getRound, getSession, requireActive } from '@/server/store'
import {
  applyGameAction,
  placeBet,
  resolveBoardPending,
  type BoardPendingPayload,
} from '@/server/orchestrator'

export const dynamic = 'force-dynamic'

const identite = {
  playerId: z.string().uuid(),
  token: z.string().min(8),
  sessionId: z.string().uuid(),
}

const schema = z.discriminatedUnion('scope', [
  z.object({
    ...identite,
    scope: z.literal('game'),
    roundId: z.string().uuid(),
    /** Charge utile propre au jeu : c'est sa machine qui la valide. */
    payload: z.unknown(),
  }),
  z.object({
    ...identite,
    scope: z.literal('bet'),
    roundId: z.string().uuid(),
    target: z.string().uuid(),
  }),
  z.object({
    ...identite,
    scope: z.literal('board'),
    payload: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('tournee'),
        distribution: z.record(z.string().uuid(), z.number().int().min(0).max(10)),
      }),
      z.object({ kind: z.literal('duel'), opponent: z.string().uuid() }),
    ]),
  }),
])

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json())

    // Ces trois lectures ne dépendent pas les unes des autres. Les enchaîner
    // coûtait deux allers-retours de plus sur chaque coup joué.
    const [joueur, session, round] = await Promise.all([
      authenticate(body.playerId, body.token),
      getSession(body.sessionId),
      body.scope === 'board' ? Promise.resolve(null) : getRound(body.roundId),
    ])

    requireActive(session)

    if (joueur.session_id !== session.id) {
      throw new InvalidActionError('Tu n’appartiens pas à cette soirée.')
    }

    if (body.scope === 'board') {
      await resolveBoardPending(session, joueur.id, body.payload as BoardPendingPayload)
      return NextResponse.json({ ok: true })
    }

    if (!round || round.session_id !== session.id) {
      throw new InvalidActionError('Cette manche appartient à une autre soirée.')
    }

    if (body.scope === 'bet') {
      await placeBet(round, joueur.id, body.target)
      return NextResponse.json({ ok: true })
    }

    // Le nouvel état part avec la réponse : celui qui joue voit sa carte
    // immédiatement, sans attendre le retour du temps réel.
    const etat = await applyGameAction(session, round, joueur.id, body.payload)
    return NextResponse.json({ ok: true, etat })
  } catch (error) {
    return fail(error)
  }
}
