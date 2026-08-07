'use client'

import type { Identite } from './types'

async function envoyer<T>(url: string, corps: unknown): Promise<T> {
  const reponse = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  })

  const donnees = (await reponse.json().catch(() => ({}))) as { error?: string } & T
  if (!reponse.ok) throw new Error(donnees.error ?? 'Le serveur n’a pas répondu.')
  return donnees
}

export interface Arrivee {
  sessionId: string
  code: string
  playerId: string
  token: string
}

export const api = {
  creer(nickname: string, avatar: string, mode: 'free' | 'board', totalRounds?: number) {
    return envoyer<Arrivee>('/api/session', {
      action: 'create',
      nickname,
      avatar,
      mode,
      ...(totalRounds ? { totalRounds } : {}),
    })
  },

  rejoindre(code: string, nickname: string, avatar: string) {
    return envoyer<Arrivee>('/api/session', {
      action: 'join',
      code: code.toUpperCase(),
      nickname,
      avatar,
    })
  },

  hote(identite: Identite, action: 'start' | 'next' | 'lobby' | 'close-bets' | 'abandonner', gameKey?: string) {
    return envoyer<{ ok?: boolean; roundId?: string }>('/api/session', {
      action,
      sessionId: identite.sessionId,
      playerId: identite.playerId,
      token: identite.token,
      ...(gameKey ? { gameKey } : {}),
    })
  },

  quitter(identite: Identite) {
    return envoyer<{ ok: boolean; ferme: boolean }>('/api/session', {
      action: 'leave',
      sessionId: identite.sessionId,
      playerId: identite.playerId,
      token: identite.token,
    })
  },

  /**
   * Départ « au vol », quand l'onglet se ferme.
   *
   * `sendBeacon` est le seul envoi que le navigateur s'engage à terminer alors
   * que la page disparaît : un `fetch` classique serait annulé en plein vol.
   */
  quitterEnFermant(identite: Identite): void {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return
    navigator.sendBeacon(
      '/api/session',
      new Blob(
        [
          JSON.stringify({
            action: 'leave',
            sessionId: identite.sessionId,
            playerId: identite.playerId,
            token: identite.token,
          }),
        ],
        { type: 'application/json' },
      ),
    )
  },

  jouer(identite: Identite, roundId: string, payload: unknown) {
    return envoyer<{ ok: boolean; etat?: Record<string, unknown> }>('/api/play', {
      scope: 'game',
      sessionId: identite.sessionId,
      playerId: identite.playerId,
      token: identite.token,
      roundId,
      payload,
    })
  },

  parier(identite: Identite, roundId: string, target: string) {
    return envoyer<{ ok: boolean }>('/api/play', {
      scope: 'bet',
      sessionId: identite.sessionId,
      playerId: identite.playerId,
      token: identite.token,
      roundId,
      target,
    })
  },

  plateau(
    identite: Identite,
    payload:
      | { kind: 'tournee'; distribution: Record<string, number> }
      | { kind: 'duel'; opponent: string },
  ) {
    return envoyer<{ ok: boolean }>('/api/play', {
      scope: 'board',
      sessionId: identite.sessionId,
      playerId: identite.playerId,
      token: identite.token,
      payload,
    })
  },

  async vuePrivee(identite: Identite, roundId: string): Promise<unknown> {
    const params = new URLSearchParams({
      roundId,
      playerId: identite.playerId,
      token: identite.token,
    })
    const reponse = await fetch(`/api/view?${params}`)
    if (!reponse.ok) return null
    const donnees = (await reponse.json()) as { view: unknown }
    return donnees.view
  },
}

const CLE = 'jeux-de-soiree:identite'

export function lireIdentite(code: string): Identite | null {
  if (typeof window === 'undefined') return null
  try {
    const brut = window.localStorage.getItem(`${CLE}:${code.toUpperCase()}`)
    return brut ? (JSON.parse(brut) as Identite) : null
  } catch {
    return null
  }
}

export function ecrireIdentite(identite: Identite): void {
  window.localStorage.setItem(
    `${CLE}:${identite.code.toUpperCase()}`,
    JSON.stringify(identite),
  )
}

export function oublierIdentite(code: string): void {
  window.localStorage.removeItem(`${CLE}:${code.toUpperCase()}`)
}
