import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase disposant de la clé `service_role`, qui contourne RLS.
 *
 * Il ne doit JAMAIS être instancié côté navigateur : ce serait donner à
 * n'importe quel joueur les droits d'écriture sur toute la base, et l'accès au
 * paquet de cartes. Le garde ci-dessous transforme cette erreur en panne
 * immédiate et bruyante plutôt qu'en faille silencieuse.
 */

/** Le projet n'est pas configuré. C'est l'erreur d'installation numéro un. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

let cache: SupabaseClient | null = null

export function serviceClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'serviceClient() a été appelé dans un navigateur. Ce module est réservé au serveur.',
    )
  }

  if (cache) return cache

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new ConfigurationError(
      'Supabase n’est pas configuré : renseigne NEXT_PUBLIC_SUPABASE_URL et ' +
        'SUPABASE_SERVICE_ROLE_KEY dans .env.local (voir .env.example et le README).',
    )
  }

  cache = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cache
}
