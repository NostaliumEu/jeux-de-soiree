'use client'

import { useEffect, useState } from 'react'

/**
 * Compte à rebours vers une date limite serveur.
 *
 * Quand elle expire, `surExpiration` est appelé une seule fois : c'est ce qui
 * déclenche l'action `timeout` côté serveur, sans avoir besoin d'un worker de
 * fond. Le serveur revérifie la date avant d'appliquer quoi que ce soit, donc
 * un client pressé ne peut pas précipiter la manche.
 */
export function Minuteur({
  echeance,
  decalage,
  surExpiration,
  className = '',
}: {
  echeance: number | null
  decalage: number
  surExpiration?: () => void
  className?: string
}) {
  const [restant, setRestant] = useState<number | null>(null)

  useEffect(() => {
    if (echeance === null) {
      setRestant(null)
      return
    }

    let declenche = false

    const battre = () => {
      const reste = echeance - (Date.now() + decalage)
      setRestant(Math.max(0, reste))
      if (reste <= 0 && !declenche) {
        declenche = true
        surExpiration?.()
      }
    }

    battre()
    const timer = setInterval(battre, 200)
    return () => clearInterval(timer)
  }, [echeance, decalage, surExpiration])

  if (restant === null) return null

  const secondes = Math.ceil(restant / 1000)
  const urgent = secondes <= 5

  return (
    <span
      className={[
        'chiffre text-sm font-bold tabular-nums transition-colors',
        urgent ? 'text-rose' : 'text-brume',
        className,
      ].join(' ')}
    >
      {secondes}s
    </span>
  )
}
