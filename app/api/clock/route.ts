import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Horloge de référence.
 *
 * Le Faux Départ compare des temps de réaction, pas des heures d'arrivée
 * réseau. Pour cela chaque client doit connaître son décalage avec le serveur :
 * il appelle cette route plusieurs fois et garde la médiane des écarts.
 */
export function GET() {
  return NextResponse.json({ serverTime: Date.now() })
}
