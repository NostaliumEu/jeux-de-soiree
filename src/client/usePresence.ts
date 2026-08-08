'use client'

import { useEffect } from 'react'
import { api } from './api'
import type { Identite } from './types'

/** Le serveur referme une soirée après 10 minutes de silence de son hôte. */
export const PRESENCE_INTERVAL_MS = 30_000

/**
 * Signal de présence de l'hôte.
 *
 * C'est ce qui remplace l'ancienne détection par `pagehide` : celle-ci se
 * déclenchait aussi sur un rechargement de page, si bien qu'un F5 éjectait
 * l'hôte et refermait la soirée de toute la table.
 *
 * Ici, on ne cherche plus à surprendre l'instant du départ, on constate le
 * silence. Un rechargement, une coupure de réseau ou un passage sous tunnel ne
 * coûtent que quelques secondes d'interruption, très loin du seuil de quatre
 * minutes ; fermer l'onglet pour de bon, en revanche, arrête le signal
 * définitivement.
 */
export function useSignalDePresence(identite: Identite | null, actif: boolean): void {
  useEffect(() => {
    if (!identite || !actif) return

    // On bat aussi en arrière-plan.
    //
    // Se taire dès que l'onglet perd le premier plan reviendrait à refermer la
    // soirée de quelqu'un parti lire un message : sur téléphone, on quitte
    // l'application dix fois par soirée sans quitter la partie. Les navigateurs
    // ralentissent ces minuteries en arrière-plan, ce qui suffit largement face
    // à un seuil de dix minutes.
    const signaler = () => {
      void api.presence(identite).catch(() => {})
    }

    signaler()
    const timer = setInterval(signaler, PRESENCE_INTERVAL_MS)
    document.addEventListener('visibilitychange', signaler)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', signaler)
    }
  }, [identite, actif])
}
