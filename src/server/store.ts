/** Accès à la base. Aucune règle de jeu ici : uniquement de la persistance. */

import type { PlayerId } from '@/engine/types'
import { serviceClient } from './supabase'

export interface SessionRow {
  id: string
  code: string
  host_player_id: string | null
  mode: 'free' | 'board'
  status: 'lobby' | 'playing' | 'results' | 'finished'
  settings: { totalRounds?: number }
  current_round_id: string | null
  last_game_key: string | null
  last_activity_at: string
}

export interface PlayerRow {
  id: string
  session_id: string
  nickname: string
  avatar: string
  participations: number
  joined_at: string
  last_seen_at: string
}

export interface RoundRow {
  id: string
  session_id: string
  game_key: string
  format: string
  participants: string[]
  status: 'betting' | 'playing' | 'done'
  seed: string
  bets: Record<PlayerId, PlayerId>
  result: unknown | null
  started_at: string
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function getSessionByCode(code: string): Promise<SessionRow> {
  const { data, error } = await serviceClient()
    .from('sessions')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle()

  if (error) throw error
  if (!data) throw new NotFoundError(`Aucune soirée ne porte le code ${code}.`)
  return data as SessionRow
}

export async function getSession(id: string): Promise<SessionRow> {
  const { data, error } = await serviceClient()
    .from('sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new NotFoundError('Soirée introuvable.')
  return data as SessionRow
}

export async function getPlayers(sessionId: string): Promise<PlayerRow[]> {
  const { data, error } = await serviceClient()
    .from('players')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as PlayerRow[]
}

/**
 * Vérifie qu'un joueur est bien celui qu'il prétend être.
 *
 * Le jeton vit dans une table sans aucune policy de lecture : il n'est donc
 * jamais diffusé aux autres joueurs, contrairement au `player_id` qui circule
 * dans l'état public.
 */
export async function authenticate(playerId: string, token: string): Promise<PlayerRow> {
  const db = serviceClient()

  const { data: secret, error: secretError } = await db
    .from('player_secrets')
    .select('token')
    .eq('player_id', playerId)
    .maybeSingle()

  if (secretError) throw secretError
  if (!secret || secret.token !== token) {
    throw new ForbiddenError('Identité invalide. Rejoins de nouveau la soirée.')
  }

  const { data: player, error: playerError } = await db
    .from('players')
    .select('*')
    .eq('id', playerId)
    .maybeSingle()

  if (playerError) throw playerError
  if (!player) throw new NotFoundError('Joueur introuvable.')

  await db
    .from('players')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', playerId)

  return player as PlayerRow
}

export async function requireHost(session: SessionRow, playerId: string): Promise<void> {
  if (session.host_player_id !== playerId) {
    throw new ForbiddenError('Seul l’hôte peut faire ça.')
  }
}

export async function getRound(roundId: string): Promise<RoundRow> {
  const { data, error } = await serviceClient()
    .from('rounds')
    .select('*')
    .eq('id', roundId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new NotFoundError('Manche introuvable.')
  return data as RoundRow
}

export interface RoundStateRow {
  publicState: Record<string, unknown>
  secretState: Record<string, unknown>
  version: number
}

export async function getRoundState(roundId: string): Promise<RoundStateRow> {
  const db = serviceClient()

  const [publique, secrete] = await Promise.all([
    db.from('round_public_state').select('public_state, version').eq('round_id', roundId).maybeSingle(),
    db.from('round_secret_state').select('secret_state').eq('round_id', roundId).maybeSingle(),
  ])

  if (publique.error) throw publique.error
  if (secrete.error) throw secrete.error
  if (!publique.data || !secrete.data) throw new NotFoundError('État de manche introuvable.')

  return {
    publicState: publique.data.public_state as Record<string, unknown>,
    secretState: secrete.data.secret_state as Record<string, unknown>,
    version: publique.data.version as number,
  }
}

export async function saveRoundState(
  roundId: string,
  publicState: unknown,
  secretState: unknown,
  version: number,
): Promise<void> {
  const db = serviceClient()

  const [publique, secrete] = await Promise.all([
    db
      .from('round_public_state')
      .upsert({ round_id: roundId, public_state: publicState, version })
      .select('round_id'),
    db
      .from('round_secret_state')
      .upsert({ round_id: roundId, secret_state: secretState })
      .select('round_id'),
  ])

  if (publique.error) throw publique.error
  if (secrete.error) throw secrete.error
}

export async function savePlayerViews(
  roundId: string,
  views: Array<{ playerId: string; payload: unknown }>,
): Promise<void> {
  if (views.length === 0) return

  // Tous les jeux n'ont pas de secret par joueur : Purple cache son paquet à
  // tout le monde, donc sa vue privée est nulle. Plutôt que d'écrire une ligne
  // vide — que la contrainte `not null` rejetterait — on n'écrit rien, et on
  // supprime une éventuelle vue devenue obsolète en cours de manche.
  const aEcrire = views.filter((v) => v.payload !== null && v.payload !== undefined)
  const aSupprimer = views.filter((v) => v.payload === null || v.payload === undefined)

  const db = serviceClient()

  if (aEcrire.length > 0) {
    const { error } = await db
      .from('player_views')
      .upsert(
        aEcrire.map((v) => ({ round_id: roundId, player_id: v.playerId, payload: v.payload })),
      )
    if (error) throw error
  }

  if (aSupprimer.length > 0) {
    const { error } = await db
      .from('player_views')
      .delete()
      .eq('round_id', roundId)
      .in('player_id', aSupprimer.map((v) => v.playerId))
    if (error) throw error
  }
}

export async function getPlayerView(roundId: string, playerId: string): Promise<unknown> {
  const { data, error } = await serviceClient()
    .from('player_views')
    .select('payload')
    .eq('round_id', roundId)
    .eq('player_id', playerId)
    .maybeSingle()

  if (error) throw error
  return data?.payload ?? null
}

export async function logAction(
  roundId: string,
  playerId: string | null,
  payload: unknown,
): Promise<void> {
  const { error } = await serviceClient()
    .from('actions')
    .insert({ round_id: roundId, player_id: playerId, payload })

  if (error) throw error
}

export async function addSips(
  sessionId: string,
  sips: Record<PlayerId, number>,
): Promise<void> {
  const entries = Object.entries(sips).filter(([, n]) => n > 0)
  if (entries.length === 0) return

  const db = serviceClient()
  const { data, error } = await db
    .from('tally')
    .select('player_id, sips_total')
    .eq('session_id', sessionId)

  if (error) throw error

  const courant = new Map((data ?? []).map((r) => [r.player_id as string, r.sips_total as number]))
  const lignes = entries.map(([playerId, n]) => ({
    session_id: sessionId,
    player_id: playerId,
    sips_total: (courant.get(playerId) ?? 0) + n,
  }))

  const { error: upsertError } = await db.from('tally').upsert(lignes)
  if (upsertError) throw upsertError
}

export async function touchSession(sessionId: string): Promise<void> {
  await serviceClient()
    .from('sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', sessionId)
}

export async function getBoardState(sessionId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceClient()
    .from('board_state')
    .select('state')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw error
  return (data?.state as Record<string, unknown>) ?? null
}

export async function saveBoardState(sessionId: string, state: unknown): Promise<void> {
  const { error } = await serviceClient()
    .from('board_state')
    .upsert({ session_id: sessionId, state })

  if (error) throw error
}
