'use client'

import { useEffect, useRef, useState } from 'react'
import { Bloc, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import { BOMBE_MAX_MS, BOMBE_ROUNDS } from './definition'
import type { BombePublic } from './machine'

export function BombeEcran({ etat, moi, joueurs, decalage, envoyer }: EcranProps<BombePublic>) {
  const [enCours, setEnCours] = useState(false)
  const [tension, setTension] = useState(0)
  const dernierArme = useRef(etat.armedAt)

  const porteur = etat.order[etat.holderIndex]
  const jeLaTiens = porteur === moi && etat.phase === 'passe'

  // Jauge de tension : elle monte vers la borne haute connue. Elle ne dit rien
  // de l'instant réel de l'explosion — personne ne le connaît — mais elle
  // installe le compte à rebours qui fait tout le sel du jeu.
  useEffect(() => {
    if (etat.phase === 'over') return
    dernierArme.current = etat.armedAt

    const battre = () => {
      const ecoule = Date.now() + decalage - etat.armedAt
      setTension(Math.min(1, Math.max(0, ecoule / BOMBE_MAX_MS)))
    }

    battre()
    const timer = setInterval(battre, 100)
    return () => clearInterval(timer)
  }, [etat.armedAt, etat.phase, decalage])

  const passer = async () => {
    if (!jeLaTiens || enCours) return
    setEnCours(true)
    try {
      await envoyer({ type: 'pass' })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Bloc className="flex items-center justify-between">
        <div>
          <Surtitre>
            Explosion {Math.min(etat.round, BOMBE_ROUNDS)} sur {BOMBE_ROUNDS}
          </Surtitre>
          <p className="titre text-lg">
            {jeLaTiens ? 'Tu l’as !' : `${nomDe(joueurs, porteur ?? '')} l’a`}
          </p>
        </div>
        <span className="text-3xl">{avatarDe(joueurs, porteur ?? '')}</span>
      </Bloc>

      {/* Jauge de tension, commune à toute la table. */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-nuit-700">
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{
            width: `${tension * 100}%`,
            backgroundColor:
              tension > 0.75 ? 'var(--color-rose)' : tension > 0.4 ? 'var(--color-or)' : 'var(--color-acide)',
          }}
        />
      </div>

      {etat.phase === 'passe' &&
        (jeLaTiens ? (
          <button
            type="button"
            onPointerDown={() => void passer()}
            disabled={enCours}
            className="animate-pulsation grid min-h-[46vh] w-full touch-manipulation select-none place-items-center rounded-3xl border-4 border-rose bg-rose/20 active:scale-95"
          >
            <span className="flex flex-col items-center gap-2">
              <span className="text-7xl">💣</span>
              <span className="titre text-5xl uppercase text-rose">Passe !</span>
            </span>
          </button>
        ) : (
          <div className="grid min-h-[46vh] w-full place-items-center rounded-3xl border-2 border-nuit-600 bg-nuit-800/60">
            <span className="flex flex-col items-center gap-3 text-center">
              <span className="text-5xl opacity-40">💣</span>
              <span className="titre text-2xl text-brume">
                Chez {nomDe(joueurs, porteur ?? '')}
              </span>
              <span className="text-xs text-brume/70">Prépare-toi, ça arrive</span>
            </span>
          </div>
        ))}

      <div className="flex flex-wrap justify-center gap-2">
        {etat.order.map((id) => (
          <span
            key={id}
            className={[
              'flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs',
              id === porteur ? 'border-rose bg-rose/15 text-craie' : 'border-nuit-600 text-brume',
            ].join(' ')}
          >
            <span className="text-base leading-none">{avatarDe(joueurs, id)}</span>
            <span className="max-w-16 truncate">{nomDe(joueurs, id)}</span>
            {(etat.explosions[id] ?? 0) > 0 && (
              <span className="text-rose">{'💥'.repeat(etat.explosions[id] ?? 0)}</span>
            )}
          </span>
        ))}
      </div>

      {etat.history.length > 0 && (
        <Bloc>
          <Surtitre>Dégâts</Surtitre>
          <ul className="flex flex-col gap-1 text-sm">
            {etat.history.map((boum, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-brume">Explosion {boum.round}</span>
                <span>
                  {nomDe(joueurs, boum.victim)} ·{' '}
                  <strong className="text-rose">{boum.amount} gorgées</strong>
                </span>
              </li>
            ))}
          </ul>
        </Bloc>
      )}
    </div>
  )
}
