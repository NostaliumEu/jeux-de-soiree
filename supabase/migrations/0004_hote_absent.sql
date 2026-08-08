-- Fermeture des soirées dont l'hôte a disparu.
--
-- La première tentative reposait sur l'événement `pagehide` du navigateur : à
-- la fermeture de l'onglet, un signal partait pour clore la soirée. Mauvaise
-- idée. `pagehide` se déclenche aussi sur un rechargement et sur une navigation
-- interne, si bien qu'appuyer sur F5 éjectait l'hôte et refermait la partie de
-- toute la table.
--
-- On raisonne donc sur le silence plutôt que sur un événement : le navigateur
-- de l'hôte signale sa présence toutes les trente secondes, et une soirée dont
-- l'hôte n'a plus donné signe de vie depuis quatre minutes est considérée
-- abandonnée. Un rechargement, une coupure de réseau ou un tunnel ne coûtent
-- que quelques secondes de silence : bien en deçà du seuil.

create or replace function close_orphan_sessions() returns void
language sql
security definer
set search_path = public
as $$
  update sessions s
     set status = 'closed'
   where s.status in ('lobby', 'playing', 'results')
     and s.host_player_id is not null
     and exists (
       select 1
       from players p
       where p.id = s.host_player_id
         and p.last_seen_at < now() - interval '4 minutes'
     );
$$;

revoke execute on function public.close_orphan_sessions() from public;
revoke execute on function public.close_orphan_sessions() from anon;
revoke execute on function public.close_orphan_sessions() from authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('jeux-de-soiree-hote-absent')
      where exists (select 1 from cron.job where jobname = 'jeux-de-soiree-hote-absent');
    perform cron.schedule('jeux-de-soiree-hote-absent', '* * * * *', 'select close_orphan_sessions()');
  end if;
end
$$;
