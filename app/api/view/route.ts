import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fail } from '@/server/http'
import { authenticate, getPlayerView } from '@/server/store'

export const dynamic = 'force-dynamic'

/**
 * Vue personnelle d'un joueur pour la manche en cours : son propre choix, son
 * propre vote. Elle ne transite pas par le temps réel — sans quoi tout le monde
 * la recevrait — mais par cette route, contre présentation du jeton.
 */

const schema = z.object({
  roundId: z.string().uuid(),
  playerId: z.string().uuid(),
  token: z.string().min(8),
})

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const { roundId, playerId, token } = schema.parse({
      roundId: params.get('roundId'),
      playerId: params.get('playerId'),
      token: params.get('token'),
    })

    await authenticate(playerId, token)
    return NextResponse.json({ view: await getPlayerView(roundId, playerId) })
  } catch (error) {
    return fail(error)
  }
}
