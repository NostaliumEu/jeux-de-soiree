'use client'

import { useState } from 'react'
import { cardLabel, colorOf, type Card } from '@/engine/cards'
import { Minuteur } from '@/ui/Minuteur'
import { Bloc, Bouton, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import { availableBets, type PurpleBet, type PurplePublic } from './machine'

const LIBELLES: Record<PurpleBet, string> = {
  red: 'Rouge',
  black: 'Noir',
  higher: 'Plus haut',
  lower: 'Plus bas',
  purple: 'Purple',
}

export function CarteJeu({ carte, taille = 'grande' }: { carte: Card | null; taille?: 'grande' | 'petite' }) {
  const grande = taille === 'grande'

  if (!carte) {
    return (
      <div
        className={[
          'grid place-items-center rounded-2xl border-2 border-dashed border-nuit-500',
          'text-brume',
          grande ? 'h-40 w-28 text-4xl' : 'h-14 w-10 text-lg',
        ].join(' ')}
      >
        ?
      </div>
    )
  }

  const rouge = colorOf(carte) === 'red'

  return (
    <div
      className={[
        'flex flex-col items-center justify-center rounded-2xl border-2 bg-craie font-bold',
        'shadow-[5px_5px_0_0_#07040d]',
        rouge ? 'border-rose text-rose' : 'border-nuit-900 text-nuit-900',
        grande ? 'h-40 w-28' : 'h-14 w-10',
      ].join(' ')}
    >
      <span className={grande ? 'titre text-4xl' : 'text-base font-bold'}>{carte.rank}</span>
      <span className={grande ? 'text-3xl' : 'text-sm'}>{carte.suit}</span>
    </div>
  )
}

export function PurpleEcran({ etat, moi, joueurs, decalage, envoyer }: EcranProps<PurplePublic>) {
  const [enCours, setEnCours] = useState(false)
  const tour = etat.order[etat.currentIndex]
  const monTour = tour === moi && etat.phase === 'bet'
  const paris = availableBets(etat.reference)

  const jouer = async (bet: PurpleBet) => {
    setEnCours(true)
    try {
      await envoyer({ type: 'bet', bet })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* La banque est l'information la plus importante de l'écran : c'est elle
          qui donne le vertige quand elle gonfle. */}
      <Bloc vif className="text-center">
        <Surtitre>La banque</Surtitre>
        <p
          className={[
            'titre text-7xl leading-none',
            etat.bank >= 10 ? 'text-rose' : etat.bank >= 5 ? 'text-or' : 'text-acide',
          ].join(' ')}
        >
          {etat.bank}
        </p>
        <p className="mt-1 text-sm text-brume">
          {etat.bank === 0
            ? 'Vide. Le prochain qui se plante s’en sort bien.'
            : `${etat.bank} gorgée${etat.bank > 1 ? 's' : ''} pour le prochain qui se trompe.`}
        </p>
      </Bloc>

      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <Surtitre>Référence</Surtitre>
          <CarteJeu carte={etat.reference} />
        </div>
      </div>

      <Bloc className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{avatarDe(joueurs, tour ?? '')}</span>
          <div>
            <p className="titre text-lg">{monTour ? 'À toi de jouer' : nomDe(joueurs, tour ?? '')}</p>
            <p className="text-xs text-brume">
              {etat.failures} échec{etat.failures > 1 ? 's' : ''} · {etat.cardsLeft} cartes
            </p>
          </div>
        </div>
        <Minuteur echeance={etat.deadlineAt} decalage={decalage} />
      </Bloc>

      {monTour ? (
        <div className="grid grid-cols-2 gap-2.5">
          {paris
            .filter((p) => p !== 'purple')
            .map((pari) => (
              <Bouton
                key={pari}
                teinte={pari === 'red' ? 'rose' : pari === 'black' ? 'brume' : 'cyan'}
                disabled={enCours}
                onClick={() => void jouer(pari)}
              >
                {LIBELLES[pari]}
              </Bouton>
            ))}
          <Bouton
            teinte="neon"
            disabled={enCours}
            className="col-span-2"
            onClick={() => void jouer('purple')}
          >
            Purple · 5 gorgées
          </Bouton>
          <p className="col-span-2 text-center text-xs text-brume">
            Le Purple parie que les deux prochaines cartes seront de couleurs différentes.
            Impossible de passer son tour.
          </p>
        </div>
      ) : (
        <p className="text-center text-sm text-brume">
          On attend {nomDe(joueurs, tour ?? '')}…
        </p>
      )}

      {etat.history.length > 0 && (
        <Bloc>
          <Surtitre>Derniers coups</Surtitre>
          <ul className="flex flex-col gap-2">
            {etat.history.slice(0, 5).map((coup, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="flex gap-1">
                  {coup.cards.map((carte) => (
                    <CarteJeu key={cardLabel(carte)} carte={carte} taille="petite" />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <strong className="font-semibold">{nomDe(joueurs, coup.player)}</strong>{' '}
                  <span className="text-brume">{LIBELLES[coup.bet]}</span>
                </span>
                <span
                  className={[
                    'chiffre shrink-0 text-xs font-bold',
                    coup.success ? 'text-acide' : 'text-rose',
                  ].join(' ')}
                >
                  {coup.success ? `+${coup.amount}` : `bu ${coup.amount}`}
                </span>
              </li>
            ))}
          </ul>
        </Bloc>
      )}
    </div>
  )
}
