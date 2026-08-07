'use client'

import { useEffect, useRef, useState } from 'react'
import { Bloc, Surtitre } from '@/ui/primitives'
import { nomDe, type EcranProps } from '@/client/types'
import type { FauxDepartPublic } from './machine'

type Etape = 'attente' | 'vert' | 'joue'

/**
 * L'instant du vert est converti en heure LOCALE grâce au décalage d'horloge,
 * puis le temps de réaction est mesuré sur ce téléphone. On n'envoie donc
 * jamais une heure d'arrivée réseau au serveur, mais un écart au vert : deux
 * joueurs sur des connexions inégales restent à armes égales.
 */
export function FauxDepartEcran({ etat, moi, joueurs, decalage, envoyer }: EcranProps<FauxDepartPublic>) {
  const [etape, setEtape] = useState<Etape>('attente')
  const dejaEnvoye = useRef(false)
  const participe = etat.duellists.includes(moi)
  const essai = etat.attempt

  useEffect(() => {
    // Nouvel essai : on réarme tout.
    dejaEnvoye.current = false
    setEtape('attente')

    const attente = etat.greenAt - (Date.now() + decalage)
    if (attente <= 0) {
      setEtape('vert')
      return
    }

    const timer = setTimeout(() => setEtape('vert'), attente)
    return () => clearTimeout(timer)
  }, [essai, etat.greenAt, decalage])

  const taper = async () => {
    if (!participe || dejaEnvoye.current || etat.phase === 'over') return
    dejaEnvoye.current = true

    const ecart = Date.now() + decalage - etat.greenAt
    setEtape('joue')
    await envoyer({ type: 'tap', offsetMs: ecart })
  }

  const [un, deux] = etat.duellists

  if (!participe) {
    return (
      <div className="flex flex-col gap-4">
        <Bloc className="text-center">
          <Surtitre>Duel en cours</Surtitre>
          <p className="titre text-2xl">
            {nomDe(joueurs, un ?? '')} <span className="text-neon">vs</span>{' '}
            {nomDe(joueurs, deux ?? '')}
          </p>
          <p className="chiffre mt-3 text-4xl">
            {etat.wins[un ?? ''] ?? 0} — {etat.wins[deux ?? ''] ?? 0}
          </p>
          <p className="mt-2 text-sm text-brume">Essai {etat.attempt} · au meilleur des trois</p>
        </Bloc>
      </div>
    )
  }

  const vert = etape === 'vert'

  return (
    <div className="flex flex-col gap-4">
      <Bloc className="flex items-center justify-between">
        <div>
          <Surtitre>Essai {etat.attempt}</Surtitre>
          <p className="text-sm text-brume">Premier à deux victoires</p>
        </div>
        <p className="chiffre text-2xl">
          {etat.wins[un ?? ''] ?? 0} — {etat.wins[deux ?? ''] ?? 0}
        </p>
      </Bloc>

      <button
        type="button"
        onPointerDown={() => void taper()}
        disabled={etape === 'joue'}
        className={[
          'grid min-h-[52vh] w-full place-items-center rounded-3xl border-4 transition-colors duration-75',
          'touch-manipulation select-none',
          vert
            ? 'border-acide bg-acide text-nuit-900'
            : etape === 'joue'
              ? 'border-nuit-500 bg-nuit-700 text-brume'
              : 'border-rose/50 bg-nuit-800 text-craie',
        ].join(' ')}
      >
        <span className="titre px-6 text-center text-4xl uppercase">
          {vert ? 'TAPE !' : etape === 'joue' ? 'Envoyé' : 'Attends le vert…'}
        </span>
      </button>

      {etape === 'attente' && (
        <p className="text-center text-sm text-rose">
          Taper avant le vert te fait perdre l’essai.
        </p>
      )}

      {etat.history.length > 0 && (
        <Bloc>
          <Surtitre>Essais précédents</Surtitre>
          <ul className="flex flex-col gap-1.5 text-sm">
            {etat.history.map((essaiPasse) => (
              <li key={essaiPasse.attempt} className="flex justify-between">
                <span className="text-brume">Essai {essaiPasse.attempt}</span>
                <span>
                  {essaiPasse.winner
                    ? `${nomDe(joueurs, essaiPasse.winner)} l’emporte`
                    : 'Égalité, rejoué'}
                  {essaiPasse.falseStart && <span className="text-rose"> · faux départ</span>}
                </span>
              </li>
            ))}
          </ul>
        </Bloc>
      )}
    </div>
  )
}
