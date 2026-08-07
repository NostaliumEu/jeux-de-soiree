-- Fermeture délibérée d'une soirée par son hôte.
--
-- Distinct de `expired`, qui signifie « plus personne n'a rien fait depuis
-- 90 minutes ». Les deux mènent au même verrou côté serveur, mais pas au même
-- message : « l'hôte a fermé la soirée » n'est pas « elle s'est éteinte toute
-- seule », et un joueur qui retombe dessus a le droit de savoir laquelle.

alter table sessions drop constraint if exists sessions_status_check;
alter table sessions
  add constraint sessions_status_check
  check (status in ('lobby', 'playing', 'results', 'finished', 'expired', 'closed'));

-- Une soirée fermée par l'hôte n'a pas à être « ré-expirée » par le ménage.
create or replace function close_idle_sessions() returns void
language sql
security definer
set search_path = public
as $$
  update sessions
     set status = 'expired'
   where status not in ('expired', 'finished', 'closed')
     and last_activity_at < now() - interval '90 minutes';
$$;

revoke execute on function public.close_idle_sessions() from public;
revoke execute on function public.close_idle_sessions() from anon;
revoke execute on function public.close_idle_sessions() from authenticated;
