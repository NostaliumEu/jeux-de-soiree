'use client'

import { useEffect, useState } from 'react'

/**
 * Décalage entre l'horloge du téléphone et celle du serveur.
 *
 * Le Faux Départ en dépend entièrement : le serveur annonce « le vert s'allume
 * à l'instant serveur T », et chaque téléphone doit convertir ce T en heure
 * locale. On mesure plusieurs allers-retours et on garde la MÉDIANE, parce
 * qu'une seule mesure attrapée pendant un pic de latence fausserait tout.
 */
export function useHorloge(): number {
  const [decalage, setDecalage] = useState(0)

  useEffect(() => {
    let annule = false

    const mesurer = async () => {
      const ecarts: number[] = []

      for (let i = 0; i < 5; i++) {
        const depart = Date.now()
        try {
          const reponse = await fetch('/api/clock', { cache: 'no-store' })
          const { serverTime } = (await reponse.json()) as { serverTime: number }
          const arrivee = Date.now()
          // On suppose l'aller et le retour symétriques : le serveur était à
          // `serverTime` au milieu du trajet.
          ecarts.push(serverTime - (depart + arrivee) / 2)
        } catch {
          // Une mesure ratée n'est pas grave, les autres suffisent.
        }
      }

      if (annule || ecarts.length === 0) return
      ecarts.sort((a, b) => a - b)
      setDecalage(ecarts[Math.floor(ecarts.length / 2)] ?? 0)
    }

    void mesurer()
    return () => {
      annule = true
    }
  }, [])

  return decalage
}

/** Instant serveur estimé, maintenant. */
export function maintenantServeur(decalage: number): number {
  return Date.now() + decalage
}
