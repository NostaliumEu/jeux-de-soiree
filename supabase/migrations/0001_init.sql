-- Jeux de soirée — schéma initial.
--
-- Principe de sécurité : le navigateur ne peut RIEN écrire. Toutes les
-- mutations passent par les Route Handlers Next.js, qui utilisent la clé
-- service_role et contournent donc RLS. Le rôle anonyme n'a que des droits de
-- lecture, et uniquement sur ce qui est légitimement public.
--
-- Deux catégories de données ne sont jamais lisibles depuis un navigateur,
-- quelles que soient les manipulations : `round_secret_state` (le paquet de
-- cartes, les choix cachés) et `player_secrets` (le jeton d'un joueur). Elles
-- ont RLS activé et AUCUNE policy — ce qui, en Postgres, interdit tout accès.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- sessions --

create table sessions (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  host_player_id    uuid,
  mode              text not null default 'free' check (mode in ('free', 'board')),
  -- lobby : on attend. playing : une manche est en cours. results : la manche
  -- est finie, on affiche le verdict. finished : la partie de plateau est close.
  status            text not null default 'lobby' check (status in ('lobby', 'playing', 'results', 'finished')),
  settings          jsonb not null default '{}'::jsonb,
  current_round_id  uuid,
  last_game_key     text,
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);

create index sessions_code_idx on sessions (code);
create index sessions_activity_idx on sessions (last_activity_at);

-- ----------------------------------------------------------------- joueurs --

create table players (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references sessions (id) on delete cascade,
  nickname        text not null check (char_length(nickname) between 1 and 20),
  avatar          text not null default '🙂',
  -- Nombre de mini-jeux auxquels le joueur a pris part : sert à la sélection
  -- équitable des participants en mode Plateau.
  participations  int not null default 0,
  joined_at       timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index players_session_idx on players (session_id);

-- Jeton d'identification d'un joueur. Table séparée : si le jeton vivait dans
-- `players`, qui est lisible, n'importe qui pourrait usurper n'importe qui.
create table player_secrets (
  player_id  uuid primary key references players (id) on delete cascade,
  token      text not null
);

-- ----------------------------------------------------------------- manches --

create table rounds (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions (id) on delete cascade,
  game_key      text not null,
  format        text not null,
  participants  uuid[] not null,
  status        text not null default 'betting' check (status in ('betting', 'playing', 'done')),
  seed          text not null,
  -- parieur (uuid) -> joueur pronostiqué (uuid)
  bets          jsonb not null default '{}'::jsonb,
  result        jsonb,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index rounds_session_idx on rounds (session_id);

-- État diffusé à toute la table.
create table round_public_state (
  round_id      uuid primary key references rounds (id) on delete cascade,
  public_state  jsonb not null,
  version       int not null default 0
);

-- État que le navigateur ne doit JAMAIS voir : paquet mélangé, choix cachés.
create table round_secret_state (
  round_id      uuid primary key references rounds (id) on delete cascade,
  secret_state  jsonb not null
);

-- Vue personnelle d'un joueur (son propre choix, son propre vote). Servie par
-- l'API contre présentation du jeton, jamais par abonnement temps réel.
create table player_views (
  round_id   uuid not null references rounds (id) on delete cascade,
  player_id  uuid not null references players (id) on delete cascade,
  payload    jsonb not null,
  primary key (round_id, player_id)
);

-- Journal append-only : combiné à la graine, il rend toute partie rejouable.
create table actions (
  id          bigserial primary key,
  round_id    uuid not null references rounds (id) on delete cascade,
  player_id   uuid,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

create index actions_round_idx on actions (round_id, id);

-- ----------------------------------------------------------------- plateau --

create table board_state (
  session_id  uuid primary key references sessions (id) on delete cascade,
  state       jsonb not null
);

create table tally (
  session_id  uuid not null references sessions (id) on delete cascade,
  player_id   uuid not null references players (id) on delete cascade,
  sips_total  int not null default 0,
  primary key (session_id, player_id)
);

-- `sessions.current_round_id` pointe vers `rounds`, qui référence lui-même
-- `sessions` : la contrainte ne peut donc être posée qu'une fois les deux
-- tables créées.
alter table sessions
  add constraint sessions_current_round_fkey
  foreign key (current_round_id) references rounds (id) on delete set null;

-- --------------------------------------------------------------------- RLS --

alter table sessions            enable row level security;
alter table players             enable row level security;
alter table player_secrets      enable row level security;
alter table rounds              enable row level security;
alter table round_public_state  enable row level security;
alter table round_secret_state  enable row level security;
alter table player_views        enable row level security;
alter table actions             enable row level security;
alter table board_state         enable row level security;
alter table tally               enable row level security;

-- Lecture seule pour le navigateur sur ce qui est public. L'identifiant de
-- session est un UUID : le connaître vaut invitation, comme un lien de partage.
create policy "lecture publique" on sessions           for select to anon, authenticated using (true);
create policy "lecture publique" on players            for select to anon, authenticated using (true);
create policy "lecture publique" on rounds             for select to anon, authenticated using (true);
create policy "lecture publique" on round_public_state for select to anon, authenticated using (true);
create policy "lecture publique" on board_state        for select to anon, authenticated using (true);
create policy "lecture publique" on tally              for select to anon, authenticated using (true);

-- Aucune policy sur player_secrets, round_secret_state, player_views et
-- actions : RLS activé sans policy interdit tout accès au rôle anonyme.
-- Seule la clé service_role, qui contourne RLS, y accède — donc uniquement le
-- serveur. C'est ce qui garantit qu'ouvrir l'inspecteur ne donne aucun
-- avantage : la carte suivante de Purple n'a jamais quitté le serveur.

-- ---------------------------------------------------------------- Realtime --

alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table round_public_state;
alter publication supabase_realtime add table board_state;
alter publication supabase_realtime add table tally;

-- --------------------------------------------------------------- ménage ----

create or replace function cleanup_stale_sessions() returns void
language sql
security definer
set search_path = public
as $$
  delete from sessions where last_activity_at < now() - interval '24 hours';
$$;

-- Planification quotidienne si pg_cron est disponible sur le projet.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'jeux-de-soiree-cleanup',
      '0 5 * * *',
      $cron$select cleanup_stale_sessions()$cron$
    );
  end if;
exception
  when others then
    raise notice 'pg_cron indisponible : le ménage devra être déclenché manuellement.';
end
$$;
