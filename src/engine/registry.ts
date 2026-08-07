/**
 * Registre des jeux.
 *
 * C'est le SEUL fichier à modifier pour ajouter un jeu : on crée un dossier
 * sous `src/games/`, on ajoute une ligne ici, et c'est terminé. Ni migration,
 * ni changement dans le moteur, ni changement dans un mode.
 */

import { definition as purpleDefinition } from '@/games/purple/definition'
import { purpleMachine } from '@/games/purple/machine'
import { definition as fauxDepartDefinition } from '@/games/faux-depart/definition'
import { fauxDepartMachine } from '@/games/faux-depart/machine'
import { definition as gardienDefinition } from '@/games/gardien/definition'
import { gardienMachine } from '@/games/gardien/machine'
import { definition as tuPreferesDefinition } from '@/games/tu-preferes/definition'
import { tuPreferesMachine } from '@/games/tu-preferes/machine'
import type { AnyGameModule, GameDefinition, GameMachine, GameState } from './types'

/**
 * Efface les types concrets d'une machine pour la ranger dans le registre.
 * Les jeux restent typés chez eux ; seul le serveur manipule la forme effacée.
 */
function register<S extends GameState, A>(
  definition: GameDefinition,
  machine: GameMachine<S, A>,
): AnyGameModule {
  return { definition, machine: machine as unknown as AnyGameModule['machine'] }
}

export const GAMES: readonly AnyGameModule[] = [
  register(purpleDefinition, purpleMachine),
  register(fauxDepartDefinition, fauxDepartMachine),
  register(gardienDefinition, gardienMachine),
  register(tuPreferesDefinition, tuPreferesMachine),
]

export const GAME_DEFINITIONS: readonly GameDefinition[] = GAMES.map((g) => g.definition)

export function findGame(key: string): AnyGameModule | undefined {
  return GAMES.find((g) => g.definition.key === key)
}

export function getGame(key: string): AnyGameModule {
  const module = findGame(key)
  if (!module) throw new Error(`Jeu inconnu : ${key}`)
  return module
}
