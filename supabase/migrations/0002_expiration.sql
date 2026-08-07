-- Expiration automatique des soirées abandonnées.
--
-- Une soirée qui n'a plus la moindre activité est morte : les gens sont partis,
-- ont fermé l'onglet, ou ont changé de jeu. Sans fermeture automatique elle
-- resterait « en cours » indéfiniment, et un joueur qui rouvrirait son lien le
-- lendemain retomberait sur une manche figée sans comprendre pourquoi.
--
-- Deux temps distincts :
--   90 minutes sans activité  -> la soirée est close, les joueurs voient un
--                                message clair et peuvent en relancer une
--   24 heures sans activité   -> les lignes sont supprimées

alter table sessions drop constraint if exists sessions_status_check;
alter table sessions
  add constraint sessions_status_check
  check (status in ('lobby', 'playing', 'results', 'finished', 'expired'));

create or replace function close_idle_sessions() returns void
language sql
security definer
set search_path = public
as $$
  update sessions
     set status = 'expired'
   where status <> 'expired'
     and status <> 'finished'
     and last_activity_at < now() - interval '90 minutes';
$$;

-- Comme la fonction de ménage, celle-ci contourne RLS et serait sinon exposée
-- sur /rest/v1/rpc à quiconque possède la clé publique.
revoke execute on function public.close_idle_sessions() from public;
revoke execute on function public.close_idle_sessions() from anon;
revoke execute on function public.close_idle_sessions() from authenticated;

-- Toutes les dix minutes : une soirée abandonnée ne doit pas rester ouverte
-- jusqu'au ménage de la nuit.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('jeux-de-soiree-expire')
      where exists (select 1 from cron.job where jobname = 'jeux-de-soiree-expire');
    perform cron.schedule('jeux-de-soiree-expire', '*/10 * * * *', 'select close_idle_sessions()');
  end if;
end
$$;
