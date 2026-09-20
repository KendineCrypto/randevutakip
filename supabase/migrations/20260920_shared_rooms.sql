-- MEVCUT PROJE: Bu dosyanın tamamını Supabase SQL Editor'da çalıştırın.
-- Müşteri/randevu kayıtları silinmez. Tekrar çalıştırılabilir.
begin;
alter table public.packages add column if not exists room_name text not null default '';

-- Oda adında büyük/küçük harf, I/İ/ı ve fazladan boşluk farkları aynı kabul edilir.
-- Oda belirtilmemiş diyet/lazer paketleri, mevcut kayıtlar dahil, ortak odayı kullanır.
create or replace function public.package_room_key(package_name text, room_name text)
returns text language sql immutable set search_path = '' as $$
  select lower(translate(btrim(regexp_replace(
    case when btrim(coalesce(room_name,'')) <> '' then room_name
      when lower(translate(package_name,'Iİı','iii')) ~ '(diyet|lazer)' then 'Diyet / lazer odası'
      else '' end, '\s+', ' ', 'g')), 'Iİı','iii'));
$$;

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
          or (selected_package.device_id is not null and p.device_id = selected_package.device_id)
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
    and new.duration = old.duration and new.device_id is not distinct from old.device_id then return new; end if;
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
        or (new.device_id is not null and (case when pb.id=new.id then new.device_id else pb.device_id end)=new.device_id)
        or (new_room<>'' and (case when pb.id=new.id then new_room else public.package_room_key(pb.name,pb.room_name) end)=new_room))
      and (a.date+a.time) < (b.date+b.time+make_interval(mins=>case when pb.id=new.id then new.duration else pb.duration end))
      and (a.date+a.time+make_interval(mins=>new.duration)) > (b.date+b.time)
  ) then raise exception 'Bu oda, cihaz veya süre değişikliği mevcut randevularla çakışıyor. Önce çakışan randevuları taşıyın.'; end if;
  return new;
end;
$$;
drop trigger if exists packages_schedule_validate on public.packages;
create trigger packages_schedule_validate before update of name,room_name,duration,device_id
  on public.packages for each row execute function public.check_package_schedule();
commit;
