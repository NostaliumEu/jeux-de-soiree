import { definition as purple } from '@/games/purple/definition'
import { definition as fauxDepart } from '@/games/faux-depart/definition'
import { definition as gardien } from '@/games/gardien/definition'
import { definition as tuPreferes } from '@/games/tu-preferes/definition'
import { definition as imposteur } from '@/games/imposteur/definition'
import { definition as bombe } from '@/games/bombe/definition'
import { definition as sprint } from '@/games/sprint/definition'
import type { GameDefinition } from '@/engine/types'

/**
 * Catalogue destiné au navigateur. Il n'importe que les fiches descriptives,
 * jamais les machines : les règles n'ont rien à faire dans le bundle client.
 */
export const CATALOGUE: readonly GameDefinition[] = [
  purple,
  fauxDepart,
  gardien,
  tuPreferes,
  imposteur,
  bombe,
  sprint,
]

export function ficheDe(key: string): GameDefinition | undefined {
  return CATALOGUE.find((d) => d.key === key)
}
