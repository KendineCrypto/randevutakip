-- Önce 20260920_shared_rooms.sql, sonra bu dosyanın tamamını çalıştırın.
-- Eski cihaz bağlantıları korunur. Tekrar çalıştırılabilir.
begin;
alter table public.packages add column if not exists device_ids uuid[];
update public.packages set device_ids = case when device_id is null then '{}'::uuid[] else array[device_id] end
  where device_ids is null;
alter table public.packages alter column device_ids set not null;

-- Array is the API representation; these rows enforce real, owner-scoped foreign keys
-- for EVERY device, including deletion races. Only package triggers may write them.
create table if not exists public.package_devices (
  package_id uuid not null,
  device_id uuid not null,
  user_id uuid not null,
  primary key (package_id, device_id),
  foreign key (package_id,user_id) references public.packages(id,user_id) on delete cascade,
  foreign key (device_id,user_id) references public.devices(id,user_id) on delete restrict
);
create index if not exists package_devices_device_owner_idx on public.package_devices(device_id,user_id);
create index if not exists package_devices_owner_idx on public.package_devices(user_id);
alter table public.package_devices enable row level security;
revoke all on public.package_devices from public, anon, authenticated;
grant select on public.package_devices to authenticated;
drop policy if exists package_devices_read on public.package_devices;
create policy package_devices_read on public.package_devices for select to authenticated using (user_id=auth.uid());

create or replace function public.normalize_package_devices() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.device_ids is null then
    new.device_ids := case when new.device_id is null then '{}'::uuid[] else array[new.device_id] end;
  elsif tg_op='UPDATE' then
    -- Compatibility with an old client updating only the single-device field.
    if new.device_ids is not distinct from old.device_ids and new.device_id is distinct from old.device_id then
      new.device_ids := case when new.device_id is null then '{}'::uuid[] else array[new.device_id] end;
    end if;
  end if;
  if array_position(new.device_ids,null) is not null then
    raise exception 'Paket cihazları boş bir cihaz kimliği içeremez.';
  end if;
  select coalesce(array_agg(d.id order by d.first_position),'{}'::uuid[]) into new.device_ids
    from (select id,min(position) first_position from unnest(new.device_ids) with ordinality as items(id,position) group by id) d;
  new.device_id := new.device_ids[1];
  return new;
end;
$$;
drop trigger if exists packages_devices_normalize on public.packages;
create trigger packages_devices_normalize before insert or update on public.packages
  for each row execute function public.normalize_package_devices();

create or replace function public.sync_package_devices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.package_devices where package_id=new.id;
  insert into public.package_devices(package_id,device_id,user_id)
    select new.id,id,new.user_id from unnest(new.device_ids) as items(id);
  return new;
end;
$$;
revoke all on function public.sync_package_devices() from public,anon,authenticated;
drop trigger if exists packages_devices_sync on public.packages;
create trigger packages_devices_sync after insert or update of device_ids,device_id,user_id on public.packages
  for each row execute function public.sync_package_devices();
insert into public.package_devices(package_id,device_id,user_id)
  select p.id,d.id,p.user_id from public.packages p cross join lateral unnest(p.device_ids) as d(id)
  on conflict (package_id,device_id) do nothing;

-- Appointment and package-edit checks below reserve every selected device.
create or replace function public.check_appointment() returns trigger
language plpgsql set search_path = '' as $$
declare
  enrollment public.enrollments;
  selected_package public.packages;
  completed integer;
  selected_room text;
  conflict record;
begin
  -- Aynı salon hesabındaki eşzamanlı kayıtlar sırayla kontrol edilir.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  select * into enrollment from public.enrollments
    where id = new.enrollment_id and user_id = new.user_id and customer_id = new.customer_id;
  if not found then raise exception 'Müşteriye ait paket bulunamadı'; end if;
  if new.date < enrollment.start_date or new.date > enrollment.end_date then
    raise exception 'Randevu paket tarihleri dışında';
  end if;
  select * into selected_package from public.packages where id = enrollment.package_id and user_id = new.user_id;
  selected_room := public.package_room_key(selected_package.name, selected_package.room_name);
  if new.status = 'attended' then
    select count(*) into completed from public.appointments
      where enrollment_id = new.enrollment_id and status = 'attended' and id <> new.id;
    if completed >= enrollment.total_sessions then raise exception 'Paketin tüm seansları tamamlandı'; end if;
  end if;
  if new.status in ('planned','attended') then
    select p.name, a.date, a.time, p.duration,
      (selected_room <> '' and public.package_room_key(p.name,p.room_name) = selected_room) as same_room
      into conflict
      from public.appointments a
      join public.enrollments e on e.id = a.enrollment_id and e.user_id = a.user_id
      join public.packages p on p.id = e.package_id and p.user_id = e.user_id
      where a.user_id = new.user_id and a.id <> new.id and a.status in ('planned','attended')
        and (a.customer_id = new.customer_id
          or (selected_package.device_ids && p.device_ids)
          or (selected_room <> '' and public.package_room_key(p.name,p.room_name) = selected_room))
        and (a.date + a.time) < (new.date + new.time + make_interval(mins => selected_package.duration))
        and (a.date + a.time + make_interval(mins => p.duration)) > (new.date + new.time)
      order by a.date,a.time limit 1;
    if found then
      if conflict.same_room then
        raise exception 'Ortak oda dolu: % tarihinde % saatinde başlayan % seansı (% dk). Başka bir saat seçin.',
          to_char(conflict.date,'DD.MM.YYYY'),to_char(conflict.time,'HH24:MI'),conflict.name,conflict.duration;
      end if;
      raise exception 'Müşteri veya cihaz için çakışan randevu';
    end if;
  end if;
  return new;
end;
$$;

-- Paket sonradan başka odaya/cihaza taşınırken veya süresi uzatılırken de
-- gelecekteki randevular arasında yeni çakışma oluşturulmasına izin verilmez.
create or replace function public.check_package_schedule() returns trigger
language plpgsql set search_path = '' as $$
declare new_room text;
begin
  new_room := public.package_room_key(new.name,new.room_name);
  if new_room = public.package_room_key(old.name,old.room_name)
    and new.duration = old.duration and new.device_ids is not distinct from old.device_ids then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
  if exists (
    select 1 from public.appointments a
    join public.enrollments e on e.id=a.enrollment_id and e.user_id=a.user_id
    join public.appointments b on b.user_id=a.user_id and b.id<>a.id
    join public.enrollments eb on eb.id=b.enrollment_id and eb.user_id=b.user_id
    join public.packages pb on pb.id=eb.package_id and pb.user_id=eb.user_id
    where e.package_id=new.id and a.user_id=new.user_id
      and (a.date+a.time+make_interval(mins=>new.duration)) > current_timestamp::timestamp
      and a.status in ('planned','attended') and b.status in ('planned','attended')
      and (a.customer_id=b.customer_id
        or (new.device_ids && (case when pb.id=new.id then new.device_ids else pb.device_ids end))
        or (new_room<>'' and (case when pb.id=new.id then new_room else public.package_room_key(pb.name,pb.room_name) end)=new_room))
      and (a.date+a.time) < (b.date+b.time+make_interval(mins=>case when pb.id=new.id then new.duration else pb.duration end))
      and (a.date+a.time+make_interval(mins=>new.duration)) > (b.date+b.time)
  ) then raise exception 'Bu oda, cihaz veya süre değişikliği mevcut randevularla çakışıyor. Önce çakışan randevuları taşıyın.'; end if;
  return new;
end;
$$;
drop trigger if exists packages_schedule_validate on public.packages;
create trigger packages_schedule_validate before update of name,room_name,duration,device_id,device_ids
  on public.packages for each row execute function public.check_package_schedule();
commit;
