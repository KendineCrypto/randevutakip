-- Atelier: Supabase SQL Editor üzerinde bir kez çalıştırın.
-- Tüm tablolar hesaba özel RLS politikaları ve hesaplar arası ilişki koruması kullanır.
begin;
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(trim(name)) between 1 and 200),
  phone text not null default '', email text not null default '',
  created_at timestamptz not null default now(), active boolean not null default true,
  unique(id, user_id)
);
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '', active boolean not null default true,
  unique(id, user_id)
);
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(trim(name)) between 1 and 200),
  device_id uuid, sessions integer not null check (sessions between 1 and 200),
  duration integer not null check (duration between 5 and 480),
  price numeric(12,2) not null default 0 check (price between 0 and 10000000),
  active boolean not null default true, unique(id,user_id),
  foreign key(device_id,user_id) references public.devices(id,user_id) on delete restrict
);
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid not null, package_id uuid not null,
  total_sessions integer not null check (total_sessions between 1 and 200),
  start_date date not null, end_date date not null check(end_date >= start_date),
  unique(id,user_id), unique(id,customer_id,user_id),
  foreign key(customer_id,user_id) references public.customers(id,user_id) on delete restrict,
  foreign key(package_id,user_id) references public.packages(id,user_id) on delete restrict
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid not null, enrollment_id uuid not null,
  date date not null, time time not null,
  status text not null default 'planned' check(status in ('planned','attended','missed','cancelled')),
  foreign key(enrollment_id,customer_id,user_id) references public.enrollments(id,customer_id,user_id) on delete restrict
);
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid not null, text text not null check(length(trim(text)) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key(customer_id,user_id) references public.customers(id,user_id) on delete restrict
);
create function public.valid_measurements(values_json jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(values_json) <> 'object' or values_json = '{}'::jsonb then false
  else not exists (
    select 1 from jsonb_each(values_json) as entry
    where entry.key not in ('right_arm','left_arm','upper_belly','lower_belly','hips','right_thigh','left_thigh','right_knee','left_knee','right_calf','left_calf')
    or case when jsonb_typeof(entry.value) = 'number'
      then (entry.value::text)::numeric <= 0 or (entry.value::text)::numeric > 300
      else true end
  ) end;
$$;
create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid not null, date date not null,
  "values" jsonb not null check(public.valid_measurements("values")),
  unique(customer_id,date),
  foreign key(customer_id,user_id) references public.customers(id,user_id) on delete restrict
);

-- Aynı hesaptaki eşzamanlı kayıtlar için işlem kilidi; seans ve zaman çakışması DB'de de denetlenir.
create function public.check_appointment() returns trigger language plpgsql set search_path = '' as $$
declare
  enrollment public.enrollments;
  selected_package public.packages;
  completed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  select * into enrollment from public.enrollments where id = new.enrollment_id and user_id = new.user_id and customer_id = new.customer_id;
  if not found then raise exception 'Müşteriye ait paket bulunamadı'; end if;
  if new.date < enrollment.start_date or new.date > enrollment.end_date then raise exception 'Randevu paket tarihleri dışında'; end if;
  select * into selected_package from public.packages where id = enrollment.package_id and user_id = new.user_id;
  if new.status = 'attended' then
    select count(*) into completed from public.appointments where enrollment_id = new.enrollment_id and status = 'attended' and id <> new.id;
    if completed >= enrollment.total_sessions then raise exception 'Paketin tüm seansları tamamlandı'; end if;
  end if;
  if new.status in ('planned','attended') and exists (
    select 1 from public.appointments a
    join public.enrollments e on e.id = a.enrollment_id and e.user_id = a.user_id
    join public.packages p on p.id = e.package_id and p.user_id = e.user_id
    where a.user_id = new.user_id and a.id <> new.id and a.status in ('planned','attended')
      and (a.customer_id = new.customer_id or (selected_package.device_id is not null and p.device_id = selected_package.device_id))
      and (a.date + a.time) < (new.date + new.time + make_interval(mins => selected_package.duration))
      and (a.date + a.time + make_interval(mins => p.duration)) > (new.date + new.time)
  ) then raise exception 'Müşteri veya cihaz için çakışan randevu'; end if;
  return new;
end;
$$;
create trigger appointments_validate before insert or update on public.appointments for each row execute function public.check_appointment();

do $$
declare table_name text;
begin
  foreach table_name in array array['customers','devices','packages','enrollments','appointments','notes','measurements'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name);
    execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
    execute format('create policy owner_delete on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select,insert,update,delete on public.%I to authenticated', table_name);
    execute format('create index on public.%I (user_id)', table_name);
  end loop;
end $$;
create index on public.appointments(user_id,date);
create index on public.appointments(enrollment_id,status);
create index on public.enrollments(customer_id);
create index on public.notes(customer_id,created_at desc);
create index on public.measurements(customer_id,date);
commit;
