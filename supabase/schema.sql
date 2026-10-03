-- Схема облака для «Планера». Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run.
-- Можно запускать повторно — скрипт не ломает существующие данные.

-- Одна универсальная таблица для всех сущностей приложения (привычки, задачи, операции…).
-- kind — тип сущности, data — её поля. Новые разделы приложения не требуют менять базу.
create table if not exists public.records (
  id                text        primary key,                -- создаётся на устройстве (UUID или составной, напр. habitId+дата)
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text        not null,
  data              jsonb       not null default '{}'::jsonb,
  updated_at        bigint      not null,                   -- время изменения на устройстве, мс (кто позже — тот и прав)
  deleted           boolean     not null default false,     -- удаление = пометка, чтобы оно доехало до других устройств
  server_updated_at timestamptz not null default now()      -- время записи на сервере — курсор для скачивания изменений
);

create index if not exists records_user_server_updated_idx
  on public.records (user_id, server_updated_at);

-- Доступ: только к своим строкам и только после входа.
alter table public.records enable row level security;

drop policy if exists "records: own rows only" on public.records;
create policy "records: own rows only" on public.records
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- Триггер: сервер сам ставит server_updated_at и не даёт более старой правке затереть более новую.
create or replace function public.records_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null; -- пришла устаревшая версия — молча пропускаем
    end if;
    new.user_id := old.user_id; -- владельца строки поменять нельзя
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write
  before insert or update on public.records
  for each row execute function public.records_before_write();
