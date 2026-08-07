'use client'

import { useState } from 'react'
import { Minuteur } from '@/ui/Minuteur'
import { Bloc, Bouton, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type EcranProps } from '@/client/types'
import {
  COULEURS,
  LIBELLES,
  NOMS_COULEURS,
  estJoker,
  type CarteUno,
  type Couleur,
} from './cartes'
import { estJouable, type UnoPublic } from './machine'

interface VuePrivee {
  main?: CarteUno[]
  piochee?: CarteUno | null
}

const FONDS: Record<Couleur, string> = {
  rouge: '#e5334f',
  jaune: '#f2b705',
  vert: '#2fb85f',
  bleu: '#2f7fe0',
}

function CarteVue({
  carte,
  taille = 'main',
  eteinte = false,
}: {
  carte: CarteUno
  taille?: 'main' | 'dessus'
  eteinte?: boolean
}) {
  const grande = taille === 'dessus'
  const fond = carte.couleur ? FONDS[carte.couleur] : '#1b1230'

  return (
    <span
      className={[
        'relative flex shrink-0 flex-col items-center justify-center rounded-xl border-2 font-bold',
        grande ? 'h-32 w-22 text-4xl' : 'h-20 w-14 text-2xl',
        eteinte ? 'opacity-35 grayscale' : '',
      ].join(' ')}
      style={{
        backgroundColor: fond,
        borderColor: 'rgba(255,255,255,0.85)',
        color: '#fff',
        boxShadow: grande ? '5px 5px 0 0 #07040d' : '3px 3px 0 0 #07040d',
        width: grande ? '5.5rem' : undefined,
      }}
    >
      {!carte.couleur && (
        // Joker et +4 : les quatre couleurs en fond, pour qu'on les repère au vol.
        <span className="absolute inset-1.5 rounded-lg opacity-80"
          style={{
            background:
              'conic-gradient(#e5334f 0 25%, #f2b705 0 50%, #2fb85f 0 75%, #2f7fe0 0)',
          }}
        />
      )}
      <span className="relative titre drop-shadow-[0_2px_0_rgba(0,0,0,0.45)]">
        {LIBELLES[carte.valeur]}
      </span>
    </span>
  )
}

export function UnoEcran({ etat, moi, joueurs, decalage, vuePrivee, envoyer }: EcranProps<UnoPublic>) {
  const [choixCouleur, setChoixCouleur] = useState<number | 'piochee' | null>(null)
  const [uno, setUno] = useState(false)
  const [enCours, setEnCours] = useState(false)

  const prive = (vuePrivee ?? {}) as VuePrivee
  const main = prive.main ?? []
  const tour = etat.order[etat.currentIndex]
  const monTour = tour === moi && etat.phase !== 'over'
  const doitAnnoncer = main.length === 2

  const jouable = (carte: CarteUno) =>
    estJouable(carte, etat.couleur, etat.dessus, etat.pileEnAttente, etat.chaineEstPlus4)

  const agir = async (payload: unknown) => {
    setEnCours(true)
    try {
      await envoyer(payload)
      setChoixCouleur(null)
      setUno(false)
    } finally {
      setEnCours(false)
    }
  }

  const poser = (index: number, carte: CarteUno) => {
    if (!monTour || enCours || !jouable(carte)) return
    if (estJoker(carte)) {
      setChoixCouleur(index)
      return
    }
    void agir({ type: 'play', index, uno })
  }

  const confirmerCouleur = (couleur: Couleur) => {
    if (choixCouleur === null) return
    void agir(
      choixCouleur === 'piochee'
        ? { type: 'play-piochee', couleur, uno }
        : { type: 'play', index: choixCouleur, couleur, uno },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Table : dessus de la défausse, couleur en cours, chaîne éventuelle. */}
      <div className="flex items-center justify-center gap-5">
        <CarteVue carte={etat.dessus} taille="dessus" />
        <div className="flex flex-col items-center gap-2">
          <Surtitre>Couleur</Surtitre>
          <span
            className="size-10 rounded-full border-2 border-craie/80"
            style={{ backgroundColor: FONDS[etat.couleur] }}
            aria-label={NOMS_COULEURS[etat.couleur]}
          />
          <span className="chiffre text-xs text-brume">{etat.cartesAuTalon} au talon</span>
        </div>
      </div>

      {etat.pileEnAttente > 0 && (
        <Bloc className="border-rose text-center">
          <p className="titre text-3xl text-rose">+{etat.pileEnAttente}</p>
          <p className="mt-1 text-xs text-brume">
            {etat.chaineEstPlus4
              ? 'Seul un +4 peut relever un +4. Sinon, ramasse.'
              : 'Surenchéris avec un +2 ou un +4, ou ramasse.'}
          </p>
        </Bloc>
      )}

      {/* Effectifs et tour en cours. */}
      <div className="flex flex-wrap justify-center gap-2">
        {etat.order.map((id) => (
          <span
            key={id}
            className={[
              'flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs',
              id === tour ? 'border-acide bg-acide/12 text-craie' : 'border-nuit-600 text-brume',
            ].join(' ')}
          >
            <span className="text-base leading-none">{avatarDe(joueurs, id)}</span>
            <span className="max-w-16 truncate">{nomDe(joueurs, id)}</span>
            <span
              className={['chiffre', (etat.mains[id] ?? 0) === 1 ? 'text-rose' : ''].join(' ')}
            >
              {etat.mains[id] ?? 0}
            </span>
          </span>
        ))}
      </div>

      {etat.phase === 'over' && etat.gagnant ? (
        <Bloc vif className="text-center">
          <Surtitre>Terminé</Surtitre>
          <p className="titre text-3xl">
            {avatarDe(joueurs, etat.gagnant)} {nomDe(joueurs, etat.gagnant)} l’emporte
          </p>
        </Bloc>
      ) : (
        <>
          <Bloc className="flex items-center justify-between">
            <p className="titre text-lg">
              {monTour
                ? etat.phase === 'apres-pioche'
                  ? 'Joue-la ou passe'
                  : 'À toi'
                : `Au tour de ${nomDe(joueurs, tour ?? '')}`}
            </p>
            <Minuteur echeance={etat.deadlineAt} decalage={decalage} />
          </Bloc>

          {/* Choix de couleur pour un joker. */}
          {choixCouleur !== null && (
            <Bloc vif>
              <Surtitre>Choisis la couleur</Surtitre>
              <div className="grid grid-cols-4 gap-2">
                {COULEURS.map((couleur) => (
                  <button
                    key={couleur}
                    type="button"
                    onClick={() => confirmerCouleur(couleur)}
                    aria-label={NOMS_COULEURS[couleur]}
                    className="h-14 rounded-xl border-2 border-craie/70 active:scale-95"
                    style={{ backgroundColor: FONDS[couleur] }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setChoixCouleur(null)}
                className="mt-3 w-full text-xs uppercase tracking-widest text-brume"
              >
                Annuler
              </button>
            </Bloc>
          )}

          {monTour && etat.phase === 'apres-pioche' && prive.piochee && (
            <Bloc vif>
              <Surtitre>Tu viens de piocher</Surtitre>
              <div className="flex items-center gap-4">
                <CarteVue carte={prive.piochee} />
                <div className="flex flex-1 flex-col gap-2">
                  <Bouton
                    teinte="acide"
                    disabled={enCours}
                    onClick={() =>
                      estJoker(prive.piochee as CarteUno)
                        ? setChoixCouleur('piochee')
                        : void agir({ type: 'play-piochee', uno })
                    }
                  >
                    La jouer
                  </Bouton>
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => void agir({ type: 'passer' })}
                    className="text-xs uppercase tracking-widest text-brume"
                  >
                    Passer
                  </button>
                </div>
              </div>
            </Bloc>
          )}

          {/* Bouton UNO : à activer AVANT de poser son avant-dernière carte. */}
          {doitAnnoncer && monTour && (
            <button
              type="button"
              onClick={() => setUno((v) => !v)}
              className={[
                'titre min-h-14 w-full rounded-2xl border-2 text-2xl uppercase tracking-wide transition-colors',
                uno
                  ? 'border-acide bg-acide text-nuit-900'
                  : 'border-rose text-rose animate-pulsation',
              ].join(' ')}
            >
              {uno ? 'UNO annoncé ✓' : 'Annonce UNO !'}
            </button>
          )}

          {/* Ma main. */}
          <div>
            <Surtitre>Ta main — {main.length} cartes</Surtitre>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
              {main.map((carte, index) => {
                const ok = monTour && etat.phase === 'tour' && jouable(carte)
                return (
                  <button
                    key={`${carte.couleur}-${carte.valeur}-${index}`}
                    type="button"
                    disabled={!ok || enCours}
                    onClick={() => poser(index, carte)}
                    className={ok ? 'transition-transform active:scale-95' : 'cursor-default'}
                  >
                    <CarteVue carte={carte} eteinte={!ok} />
                  </button>
                )
              })}
            </div>
          </div>

          {monTour && etat.phase === 'tour' && (
            <Bouton
              teinte={etat.pileEnAttente > 0 ? 'rose' : 'brume'}
              disabled={enCours}
              onClick={() => void agir({ type: 'draw' })}
            >
              {etat.pileEnAttente > 0 ? `Ramasser ${etat.pileEnAttente} cartes` : 'Piocher'}
            </Bouton>
          )}
        </>
      )}

      {etat.journal.length > 0 && (
        <Bloc>
          <Surtitre>Fil de la partie</Surtitre>
          <ul className="flex flex-col gap-1 text-sm text-brume">
            {etat.journal
              .slice(-5)
              .reverse()
              .map((ligne, i) => (
                <li key={i}>
                  {ligne.replace(
                    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
                    (id) => nomDe(joueurs, id),
                  )}
                </li>
              ))}
          </ul>
        </Bloc>
      )}
    </div>
  )
}
