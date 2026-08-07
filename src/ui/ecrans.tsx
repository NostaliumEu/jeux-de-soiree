'use client'

import type { ComponentType } from 'react'
import { PurpleEcran } from '@/games/purple/Screen'
import { FauxDepartEcran } from '@/games/faux-depart/Screen'
import { GardienEcran } from '@/games/gardien/Screen'
import { TuPreferesEcran } from '@/games/tu-preferes/Screen'
import type { EcranProps } from '@/client/types'

/**
 * Correspondance clé de jeu → écran. Pendant du registre serveur : ajouter un
 * jeu au projet, c'est une ligne dans `src/engine/registry.ts` et une ligne ici.
 */

type Ecran = ComponentType<EcranProps<never>>

function adapter<E>(composant: ComponentType<EcranProps<E>>): Ecran {
  // Le serveur transmet l'état sous forme JSON opaque ; c'est l'écran du jeu
  // qui en connaît la forme, exactement comme sa machine côté serveur.
  return composant as unknown as Ecran
}

export const ECRANS: Record<string, Ecran> = {
  purple: adapter(PurpleEcran),
  'faux-depart': adapter(FauxDepartEcran),
  gardien: adapter(GardienEcran),
  'tu-preferes': adapter(TuPreferesEcran),
}
