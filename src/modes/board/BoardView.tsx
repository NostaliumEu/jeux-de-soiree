'use client'

import { Bloc, Surtitre } from '@/ui/primitives'
import { avatarDe, nomDe, type JoueurPublic } from '@/client/types'
import { BOARD_SIZE, CELLS, CELL_LABELS, type CellKind } from './cells'
import { standings, type BoardState } from './machine'

const COULEURS: Record<CellKind, { fond: string; trait: string }> = {
  neutre: { fond: '#241a3f', trait: '#362a58' },
  gage: { fond: '#ff3d8b', trait: '#ff8ab8' },
  tournee: { fond: '#ffc93d', trait: '#ffe08a' },
  duel: { fond: '#3de8ff', trait: '#8af1ff' },
  teleport: { fond: '#b14bff', trait: '#d69bff' },
}

const CENTRE = 160
const RAYON = 126

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Le journal du plateau est produit par une machine pure : elle ne connaît que
 * des identifiants, jamais les pseudos. La substitution se fait donc ici, à
 * l'affichage — sans quoi on lirait « 3f2a9c1e-… ramasse une étoile ».
 */
function avecLesPrenoms(ligne: string, joueurs: JoueurPublic[]): string {
  return ligne.replace(UUID, (id) => nomDe(joueurs, id))
}

function positionCase(index: number): { x: number; y: number } {
  const angle = (index / BOARD_SIZE) * Math.PI * 2 - Math.PI / 2
  return { x: CENTRE + Math.cos(angle) * RAYON, y: CENTRE + Math.sin(angle) * RAYON }
}

export function BoardView({
  plateau,
  joueurs,
  moi,
}: {
  plateau: BoardState
  joueurs: JoueurPublic[]
  moi: string
}) {
  // Plusieurs pions peuvent occuper la même case : on les éclate en éventail
  // vers l'intérieur de l'anneau pour qu'ils restent tous visibles.
  const parCase = new Map<number, string[]>()
  for (const pion of plateau.players) {
    const liste = parCase.get(pion.position) ?? []
    liste.push(pion.id)
    parCase.set(pion.position, liste)
  }

  const classement = standings(plateau)

  return (
    <div className="flex flex-col gap-4">
      <Bloc className="flex items-center justify-between">
        <div>
          <Surtitre>Plateau</Surtitre>
          <p className="titre text-xl">
            Manche {Math.min(plateau.roundIndex + 1, plateau.totalRounds)} / {plateau.totalRounds}
          </p>
        </div>
        <p className="chiffre text-sm text-brume">
          {plateau.finished ? 'Terminé' : `${plateau.totalRounds - plateau.roundIndex} restantes`}
        </p>
      </Bloc>

      <div className="bloc p-3">
        <svg viewBox="0 0 320 320" className="w-full" role="img" aria-label="Plateau de jeu">
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={RAYON}
            fill="none"
            stroke="#241a3f"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {CELLS.map((kind, index) => {
            const { x, y } = positionCase(index)
            const couleur = COULEURS[kind]
            const etoile = plateau.starCell === index

            return (
              <g key={index}>
                <circle
                  cx={x}
                  cy={y}
                  r={etoile ? 11 : 8.5}
                  fill={couleur.fond}
                  stroke={etoile ? '#ffc93d' : couleur.trait}
                  strokeWidth={etoile ? 3 : 1.5}
                />
                {etoile && (
                  <text x={x} y={y + 4} textAnchor="middle" fontSize="11">
                    ⭐
                  </text>
                )}
              </g>
            )
          })}

          {[...parCase.entries()].map(([position, ids]) =>
            ids.map((id, rang) => {
              const base = positionCase(position)
              const angle = (position / BOARD_SIZE) * Math.PI * 2 - Math.PI / 2
              const recul = 22 + rang * 19
              const x = base.x - Math.cos(angle) * recul
              const y = base.y - Math.sin(angle) * recul

              return (
                <g key={`${position}-${id}`}>
                  <circle
                    cx={x}
                    cy={y}
                    r={11}
                    fill="#0e0819"
                    stroke={id === moi ? '#c8ff3d' : '#a294c4'}
                    strokeWidth={id === moi ? 2.5 : 1.5}
                  />
                  <text x={x} y={y + 4.5} textAnchor="middle" fontSize="12">
                    {avatarDe(joueurs, id)}
                  </text>
                </g>
              )
            }),
          )}
        </svg>

        <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-brume">
          {(Object.keys(COULEURS) as CellKind[]).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: COULEURS[kind].fond }}
              />
              {CELL_LABELS[kind]}
            </span>
          ))}
        </div>
      </div>

      <Bloc>
        <Surtitre>Classement</Surtitre>
        <ol className="flex flex-col gap-1.5">
          {classement.map((groupe, rang) =>
            groupe.map((id) => {
              const pion = plateau.players.find((p) => p.id === id)
              return (
                <li key={id} className="flex items-center gap-2 text-sm">
                  <span className="chiffre w-6 text-brume">{rang + 1}.</span>
                  <span>{avatarDe(joueurs, id)}</span>
                  <span className={['flex-1 truncate', id === moi ? 'text-acide' : ''].join(' ')}>
                    {nomDe(joueurs, id)}
                  </span>
                  <span className="chiffre text-xs">
                    ⭐ {pion?.stars ?? 0} · {pion?.distance ?? 0} cases
                  </span>
                </li>
              )
            }),
          )}
        </ol>
      </Bloc>

      {plateau.log.length > 0 && (
        <Bloc>
          <Surtitre>Il s’est passé quoi</Surtitre>
          <ul className="flex flex-col gap-1 text-sm text-brume">
            {plateau.log
              .slice(-6)
              .reverse()
              .map((ligne, i) => (
                <li key={i}>{avecLesPrenoms(ligne, joueurs)}</li>
              ))}
          </ul>
        </Bloc>
      )}
    </div>
  )
}
