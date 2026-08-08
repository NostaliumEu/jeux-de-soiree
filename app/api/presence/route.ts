import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fail } from '@/server/http'
import { authenticate, markSeen } from '@/server/store'

export const dynamic = 'force-dynamic'

const schema = z.object({
  playerId: z.string().uuid(),
  token: z.string().min(8),
})

/**
 * Signal de présence.
 *
 * Le navigateur de l'hôte passe ici régulièrement. Son silence prolongé est ce
 * qui permet de refermer une soirée qu'il a quittée — sans confondre un départ
 * avec un simple rechargement de page, contrairement à `pagehide`.
 *
 * Cette route met à jour la présence du JOUEUR, jamais l'activité de la
 * SOIRÉE : sinon un onglet oublié ouvert toute la nuit empêcherait à jamais
 * l'expiration pour inactivité.
 */
export async function POST(request: NextRequest) {
  try {
    const { playerId, token } = schema.parse(await request.json())
    await authenticate(playerId, token)
    await markSeen(playerId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error)
  }
}
