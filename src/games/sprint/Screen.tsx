'use client'

import { useEffect, useRef, useState } from 'react'
import { Bloc, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import { SPRINT_BATCH_MS, SPRINT_MAX_BATCH } from './definition'
import type { SprintPublic } from './machine'

export function SprintEcran({ etat, moi, joueurs, decalage, envoyer }: EcranProps<SprintPublic>) {
  const [avantDepart, setAvantDepart] = useState(0)
  /** Coups tapés que le serveur n'a pas encore confirmés. */
  const [enAttente, setEnAttente] = useState(0)

  const enAttenteRef = useRef(0)
  const enVol = useRef(false)
  const participe = etat.participants.includes(moi)
  const arrive = etat.finishers.includes(moi)
  const confirme = etat.progress[moi] ?? 0

  // Décompte de départ.
  useEffect(() => {
    const battre = () => {
      const reste = etat.startsAt - (Date.now() + decalage)
      setAvantDepart(Math.max(0, reste))
    }
    battre()
    const timer = setInterval(battre, 100)
    return () => clearInterval(timer)
  }, [etat.startsAt, decalage])

  // Envoi groupé des coups, UNE requête à la fois.
  //
  // Un envoi par tap saturerait tout, mais enchaîner les paquets sans attendre
  // la réponse est pire encore : à trois cents millisecondes l'aller-retour et
  // un paquet toutes les 250 ms, deux requêtes se croisent, lisent le même état
  // et s'écrasent l'une l'autre. La moitié des coups se perdait en chemin.
  useEffect(() => {
    if (!participe || arrive || etat.phase === 'over') return

    const timer = setInterval(() => {
      if (enVol.current) return
      const lot = Math.min(enAttenteRef.current, SPRINT_MAX_BATCH)
      if (lot <= 0) return

      enVol.current = true
      void envoyer({ type: 'taps', count: lot }).finally(() => {
        enAttenteRef.current = Math.max(0, enAttenteRef.current - lot)
        setEnAttente(enAttenteRef.current)
        enVol.current = false
      })
    }, SPRINT_BATCH_MS)

    return () => clearInterval(timer)
  }, [participe, arrive, etat.phase, envoyer])

  const taper = () => {
    if (!participe || arrive || avantDepart > 0 || etat.phase === 'over') return
    enAttenteRef.current += 1
    setEnAttente(enAttenteRef.current)
  }

  // Ce que le serveur a validé, plus ce qui est encore en route. La jauge
  // réagit donc au doigt sans jamais annoncer plus que ce qui finira par
  // compter : quand tous les paquets sont arrivés, les deux valeurs coïncident.
  const affichee = Math.min(etat.target, confirme + enAttente)
  const remplissage = affichee / etat.target

  const classement = [...etat.participants].sort(
    (x, y) => (etat.progress[y] ?? 0) - (etat.progress[x] ?? 0),
  )

  return (
    <div className="flex flex-col gap-4">
      <Bloc className="flex items-center justify-between">
        <div>
          <Surtitre>Le Sprint</Surtitre>
          <p className="titre text-lg">
            {avantDepart > 0
              ? 'Prêt…'
              : arrive
                ? 'Jauge pleine'
                : etat.phase === 'over'
                  ? 'Terminé'
                  : 'Matraque !'}
          </p>
        </div>
        <p className="chiffre text-2xl">
          {affichee}
          <span className="text-sm text-brume">/{etat.target}</span>
        </p>
      </Bloc>

      <div className="h-6 w-full overflow-hidden rounded-full border-2 border-nuit-500 bg-nuit-900">
        <div
          className="h-full rounded-full transition-[width] duration-75 ease-out"
          style={{
            width: `${remplissage * 100}%`,
            background:
              'linear-gradient(90deg, var(--color-cyan), var(--color-acide))',
          }}
        />
      </div>

      {participe ? (
        <button
          type="button"
          onPointerDown={taper}
          disabled={avantDepart > 0 || arrive || etat.phase === 'over'}
          className={[
            'grid min-h-[42vh] w-full touch-manipulation select-none place-items-center',
            'rounded-3xl border-4 transition-transform duration-75 active:scale-[0.98]',
            avantDepart > 0
              ? 'border-nuit-500 bg-nuit-800 text-brume'
              : arrive
                ? 'border-acide bg-acide/20 text-acide'
                : 'border-cyan bg-cyan/15 text-craie',
          ].join(' ')}
        >
          {avantDepart > 0 ? (
            <span className="titre text-8xl">{Math.ceil(avantDepart / 1000)}</span>
          ) : arrive ? (
            <span className="titre text-4xl uppercase">Fini !</span>
          ) : (
            <span className="titre text-5xl uppercase">Tape</span>
          )}
        </button>
      ) : (
        <p className="text-center text-sm text-brume">Tu ne participes pas à cette course.</p>
      )}

      <Bloc>
        <Surtitre>Jauges</Surtitre>
        <ul className="flex flex-col gap-2">
          {classement.map((id) => {
            const p = (etat.progress[id] ?? 0) / etat.target
            const place = etat.finishers.indexOf(id)
            return (
              <li key={id} className="flex items-center gap-2">
                <span className="text-lg">{avatarDe(joueurs, id)}</span>
                <span
                  className={['w-20 shrink-0 truncate text-sm', id === moi ? 'text-acide' : ''].join(
                    ' ',
                  )}
                >
                  {nomDe(joueurs, id)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-nuit-700">
                  <span
                    className="block h-full rounded-full bg-cyan transition-[width] duration-150"
                    style={{ width: `${p * 100}%` }}
                  />
                </span>
                <span className="chiffre w-8 shrink-0 text-right text-xs">
                  {place >= 0 ? `${place + 1}ᵉ` : `${Math.round(p * 100)}%`}
                </span>
              </li>
            )
          })}
        </ul>
      </Bloc>
    </div>
  )
}
