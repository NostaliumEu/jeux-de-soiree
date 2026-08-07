/** Avatars proposés à l'arrivée. Partagé entre le formulaire et la validation serveur. */
export const AVATARS = [
  '🦊',
  '🐼',
  '🐸',
  '🦉',
  '🐙',
  '🦁',
  '🐧',
  '🦄',
  '🐝',
  '🦋',
  '🐢',
  '🦖',
  '👻',
  '🤖',
  '🎃',
  '🍕',
] as const

export type Avatar = (typeof AVATARS)[number]

export function isAvatar(value: string): value is Avatar {
  return (AVATARS as readonly string[]).includes(value)
}
