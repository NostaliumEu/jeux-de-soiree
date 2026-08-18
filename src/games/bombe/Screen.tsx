'use client'

import { useEffect, useRef, useState } from 'react'
import { Bloc, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import { BOMBE_VIES } from './definition'
import type { BombePublic } from './types'

/**
 * Écran de Bombe Party.
 *
 * Il n'importe QUE `./types` et `./definition`. Toucher à `./machine` ferait
 * descendre le dictionnaire de 2,6 Mo dans le navigateur de chaque joueur.
 */
export function BombeEcran({ etat, moi, joueurs, decalage, envoyer }: EcranProps<BombePublic>) {
  const [mot, setMot] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [consume, setConsume] = useState(0)
  const champ = useRef<HTMLInputElement>(null)

  const tenant = etat.order[etat.currentIndex]
  const monTour = tenant === moi && etat.phase === 'jeu'
  const jeuxVies = etat.vies[moi] ?? 0

  // La mèche qui brûle. Toute la tension du jeu tient à ce qu'on la voie
  // avancer — et elle ne repart pas à zéro quand quelqu'un trouve un mot.
  useEffect(() => {
    if (etat.phase === 'over' || etat.deadlineAt === null) return

    const total = etat.deadlineAt - etat.mecheAllumeeA
    const battre = () => {
      const ecoule = Date.now() + decalage - etat.mecheAllumeeA
      setConsume(Math.min(1, Math.max(0, ecoule / total)))
    }

    battre()
    const timer = setInterval(battre, 100)
    return () => clearInterval(timer)
  }, [etat.mecheAllumeeA, etat.deadlineAt, etat.phase, decalage])

  // Le clavier doit être là avant même qu'on y pense.
  useEffect(() => {
    if (monTour) champ.current?.focus()
  }, [monTour, etat.syllabe])

  const proposer = async () => {
    const essai = mot.trim()
    if (!essai || enCours || !monTour) return
    setEnCours(true)
    try {
      await envoyer({ type: 'mot', mot: essai })
      setMot('')
    } finally {
      setEnCours(false)
      champ.current?.focus()
    }
  }

  const chaud = consume > 0.75
  const tiede = consume > 0.45

  if (etat.phase === 'over') {
    return (
      <div className="flex flex-col gap-4">
        <Bloc vif className="text-center">
          <Surtitre>Dernier debout</Surtitre>
          <p className="titre text-4xl">
            {etat.gagnant ? `${avatarDe(joueurs, etat.gagnant)} ${nomDe(joueurs, etat.gagnant)}` : '—'}
          </p>
        </Bloc>
        <Classement etat={etat} joueurs={joueurs} moi={moi} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* La syllabe, énorme : c'est la seule chose qu'on regarde. */}
      <Bloc vif className="text-center">
        <Surtitre>{monTour ? 'À toi, vite' : `Au tour de ${nomDe(joueurs, tenant ?? '')}`}</Surtitre>
        <p className="titre text-7xl uppercase tracking-widest text-acide">{etat.syllabe}</p>
      </Bloc>

      {/* La mèche. */}
      <div className="h-3 w-full overflow-hidden rounded-full bg-nuit-700">
        <div
          className="h-full rounded-full transition-[width] duration-100 ease-linear"
          style={{
            width: `${(1 - consume) * 100}%`,
            backgroundColor: chaud
              ? 'var(--color-rose)'
              : tiede
                ? 'var(--color-or)'
                : 'var(--color-acide)',
          }}
        />
      </div>

      {monTour ? (
        <div className="flex flex-col gap-2">
          <input
            ref={champ}
            value={mot}
            onChange={(e) => setMot(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void proposer()
            }}
            placeholder={`un mot avec « ${etat.syllabe} »`}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            className={[
              'w-full rounded-2xl border-4 bg-nuit-900 px-4 py-5 text-center text-2xl outline-none',
              chaud ? 'border-rose' : 'border-acide',
            ].join(' ')}
          />
          <p className="text-center text-xs text-brume">
            Entrée pour valider. Un mot refusé ne coûte rien — sauf du temps.
          </p>
        </div>
      ) : (
        <div className="grid min-h-32 place-items-center rounded-2xl border-2 border-nuit-600 bg-nuit-800/60">
          <span className="flex flex-col items-center gap-2 text-center">
            <span className="text-4xl">{avatarDe(joueurs, tenant ?? '')}</span>
            <span className="text-sm text-brume">
              {jeuxVies > 0 ? 'Prépare ton mot, ça arrive' : 'Tu es éliminé, tu regardes'}
            </span>
          </span>
        </div>
      )}

      {etat.dernierCoup && (
        <p
          className={[
            'text-center text-sm',
            etat.dernierCoup.valide ? 'text-acide' : 'text-rose',
          ].join(' ')}
        >
          {etat.dernierCoup.valide
            ? `${nomDe(joueurs, etat.dernierCoup.player)} : ${etat.dernierCoup.mot}`
            : `${nomDe(joueurs, etat.dernierCoup.player)} — ${etat.dernierCoup.raison}`}
        </p>
      )}

      <Vies etat={etat} joueurs={joueurs} tenant={tenant} />

      {etat.motsRecents.length > 0 && (
        <Bloc>
          <Surtitre>Déjà trouvés</Surtitre>
          <p className="text-sm text-brume">{etat.motsRecents.join(' · ')}</p>
        </Bloc>
      )}
    </div>
  )
}

function Vies({
  etat,
  joueurs,
  tenant,
}: {
  etat: BombePublic
  joueurs: EcranProps<BombePublic>['joueurs']
  tenant: string | undefined
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {etat.order.map((id) => {
        const vies = etat.vies[id] ?? 0
        return (
          <span
            key={id}
            className={[
              'flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs',
              id === tenant
                ? 'border-rose bg-rose/15 text-craie'
                : vies === 0
                  ? 'border-nuit-600 text-brume/40 line-through'
                  : 'border-nuit-600 text-brume',
            ].join(' ')}
          >
            <span className="text-base leading-none">{avatarDe(joueurs, id)}</span>
            <span className="max-w-16 truncate">{nomDe(joueurs, id)}</span>
            <span className="text-rose">
              {vies > 0 ? '♥'.repeat(vies) : '✕'}
              <span className="text-nuit-500">{'♡'.repeat(Math.max(0, BOMBE_VIES - vies))}</span>
            </span>
          </span>
        )
      })}
    </div>
  )
}

function Classement({
  etat,
  joueurs,
  moi,
}: {
  etat: BombePublic
  joueurs: EcranProps<BombePublic>['joueurs']
  moi: string
}) {
  const ordre = [
    ...etat.order.filter((id) => (etat.vies[id] ?? 0) > 0),
    ...[...etat.ordreElimination].reverse(),
  ]

  return (
    <Bloc>
      <Surtitre>Bilan</Surtitre>
      <ol className="flex flex-col gap-1.5">
        {ordre.map((id, rang) => (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span className="chiffre w-6 text-brume">{rang + 1}.</span>
            <span>{avatarDe(joueurs, id)}</span>
            <span className={['flex-1 truncate', id === moi ? 'text-acide' : ''].join(' ')}>
              {nomDe(joueurs, id)}
            </span>
            <span className="chiffre text-xs text-rose">{etat.sips[id] ?? 0} gorgées</span>
          </li>
        ))}
      </ol>
    </Bloc>
  )
}
