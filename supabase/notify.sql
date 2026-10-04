-- Расписание пуш-уведомлений: раз в минуту вызвать функцию notify (supabase/functions/notify).
-- Выполняет scripts/supabase-admin.ts (npm run supabase -- cron) — он же кладёт секрет вызова в Vault
-- под именем notify_cron_secret. Можно запускать повторно: задания с теми же именами обновляются.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'planner-notify',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://cswqkcgmjlulvjojkjqz.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret')
    ),
    body := jsonb_build_object('at', now()),
    timeout_milliseconds := 20000
  );
  $job$
);

-- История запусков копится по строке в минуту — чистим раз в сутки.
select cron.schedule(
  'planner-cron-cleanup',
  '17 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '3 days' $job$
);
