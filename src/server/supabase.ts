import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase disposant de la clé `service_role`, qui contourne RLS.
 *
 * Il ne doit JAMAIS être instancié côté navigateur : ce serait donner à
 * n'importe quel joueur les droits d'écriture sur toute la base, et l'accès au
 * paquet de cartes. Le garde ci-dessous transforme cette erreur en panne
 * immédiate et bruyante plutôt qu'en faille silencieuse.
 */

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
    throw new Error(
      'Configuration Supabase absente. Renseigne NEXT_PUBLIC_SUPABASE_URL et ' +
        'SUPABASE_SERVICE_ROLE_KEY (voir .env.example).',
    )
  }

  cache = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cache
}
