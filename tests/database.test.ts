import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL şeması, RLS ve ilişkisel kontroller', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;`);
    const schema=await fs.readFile(new URL('../supabase/schema.sql', import.meta.url),'utf8');
    const migration=await fs.readFile(new URL('../supabase/migrations/20260920_shared_rooms.sql', import.meta.url),'utf8');
    assert.ok(schema.includes(migration),'Yeni kurulum şeması da güncel oda migrationını içermeli');
    await db.exec(schema.split('-- SHARED ROOMS UPGRADE')[0]);
    const owner='00000000-0000-0000-0000-000000000001';
    const other='00000000-0000-0000-0000-000000000002';
    const customer='10000000-0000-0000-0000-000000000001';
    const device='20000000-0000-0000-0000-000000000001';
    const pkg='30000000-0000-0000-0000-000000000001';
    const enrollment='40000000-0000-0000-0000-000000000001';
    await db.exec(`insert into auth.users values ('${owner}'),('${other}'); set role authenticated; set request.jwt.claim.sub='${owner}';`);
    await db.exec(`insert into public.customers(id,name) values('${customer}','Test Müşteri');
      insert into public.devices(id,name) values('${device}','Test Cihaz');
      insert into public.packages(id,name,device_id,sessions,duration) values('${pkg}','Test Paket','${device}',1,60);
      insert into public.enrollments(id,customer_id,package_id,total_sessions,start_date,end_date) values('${enrollment}','${customer}','${pkg}',1,'2026-09-01','2026-10-01');`);
    await db.exec('reset role');
    await db.exec(migration);
    await db.exec(migration);
    const devicesMigration=await fs.readFile(new URL('../supabase/migrations/20260920_package_devices.sql', import.meta.url),'utf8');
    assert.ok(schema.endsWith(devicesMigration));
    await db.exec(devicesMigration);
    await db.exec(devicesMigration);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    await t.test('Migration mevcut kayıtları korur ve tekrar çalıştırılabilir',async()=>{
      assert.equal((await db.query('select * from public.enrollments')).rows.length,1);
      assert.deepEqual((await db.query<{device_ids:string[]}>('select device_ids from public.packages')).rows[0].device_ids,[device]);
      assert.equal((await db.query('select * from public.package_devices')).rows.length,1);
      assert.equal((await db.query<{room_name:string}>('select room_name from public.packages')).rows[0].room_name,'');
    });
    await t.test('Yönetici kendi kayıtlarını görür',async()=>assert.equal((await db.query('select * from public.customers')).rows.length,1));
    await t.test('Başka hesap müşteri okuyamaz veya değiştiremez',async()=>{
      await db.exec(`set request.jwt.claim.sub='${other}';`);
      assert.equal((await db.query('select * from public.customers')).rows.length,0);
      assert.equal((await db.query(`update public.customers set name='İzinsiz' returning *`)).rows.length,0);
      await assert.rejects(db.exec(`insert into public.notes(customer_id,text) values('${customer}','Başka hesaba not')`));
      await assert.rejects(db.exec(`insert into public.customers(user_id,name) values('${owner}','Sahte sahip')`));
      await db.exec(`set request.jwt.claim.sub='${owner}';`);
    });
    await t.test('Eksik bölgelere izin verir, hatalı ölçümü reddeder',async()=>{
      await db.exec(`insert into public.measurements(customer_id,date,"values") values('${customer}','2026-09-01','{"right_arm":30.5}')`);
      await assert.rejects(db.exec(`insert into public.measurements(customer_id,date,"values") values('${customer}','2026-09-02','{"right_arm":0}')`));
      await assert.rejects(db.exec(`insert into public.measurements(customer_id,date,"values") values('${customer}','2026-09-03','{"unknown":12}')`));
      await assert.rejects(db.exec(`insert into public.measurements(customer_id,date,"values") values('${customer}','2026-09-04','{}')`));
      await assert.rejects(db.exec(`insert into public.measurements(customer_id,date,"values") values('${customer}','2026-09-05','{"right_arm":"abc"}')`));
    });
    await t.test('Seans çakışması ve toplam seans limiti veritabanında korunur',async()=>{
      await db.exec(`insert into public.appointments(customer_id,enrollment_id,date,time,status) values('${customer}','${enrollment}','2026-09-15','10:00','attended')`);
      await assert.rejects(db.exec(`insert into public.appointments(customer_id,enrollment_id,date,time) values('${customer}','${enrollment}','2026-09-15','10:30')`));
      await assert.rejects(db.exec(`insert into public.appointments(customer_id,enrollment_id,date,time,status) values('${customer}','${enrollment}','2026-09-16','10:00','attended')`));
      await assert.rejects(db.exec(`insert into public.appointments(customer_id,enrollment_id,date,time) values('${customer}','${enrollment}','2026-10-02','10:00')`));
      await db.exec(`insert into public.appointments(customer_id,enrollment_id,date,time,status) values('${customer}','${enrollment}','2026-09-16','10:00','missed')`);
    });
    await t.test('Diyet ve lazer ortak odası API seviyesinde korunur',async()=>{
      const c2='10000000-0000-0000-0000-000000000002';
      const laser='30000000-0000-0000-0000-000000000002';
      const diet='30000000-0000-0000-0000-000000000003';
      const e1='40000000-0000-0000-0000-000000000002';
      const e2='40000000-0000-0000-0000-000000000003';
      const a1='50000000-0000-0000-0000-000000000001';
      const a2='50000000-0000-0000-0000-000000000002';
      await db.exec(`insert into public.customers(id,name) values('${c2}','İkinci Müşteri');
        insert into public.packages(id,name,sessions,duration) values('${laser}','Lazer',10,60),('${diet}','DİYET',10,30);
        insert into public.enrollments(id,customer_id,package_id,total_sessions,start_date,end_date)
          values('${e1}','${customer}','${laser}',10,'2030-01-01','2030-12-31'),('${e2}','${c2}','${diet}',10,'2030-01-01','2030-12-31');
        insert into public.appointments(id,customer_id,enrollment_id,date,time)
          values('${a1}','${customer}','${e1}','2030-09-20','14:00');`);
      const insertDiet=(time:string,date='2030-09-20')=>db.exec(`insert into public.appointments(id,customer_id,enrollment_id,date,time) values('${a2}','${c2}','${e2}','${date}','${time}')`);
      await assert.rejects(insertDiet('14:30'),/Ortak oda dolu/);
      await assert.rejects(insertDiet('13:45'),/Ortak oda dolu/);
      await insertDiet('15:00');
      await assert.rejects(db.exec(`update public.appointments set time='14:59' where id='${a2}'`),/Ortak oda dolu/);
      await assert.rejects(db.exec(`update public.packages set duration=90 where id='${laser}'`),/mevcut randevularla çakışıyor/);
      await db.exec(`update public.packages set room_name='Farklı oda' where id='${diet}'; update public.appointments set time='14:30' where id='${a2}';`);
      await assert.rejects(db.exec(`update public.packages set room_name='' where id='${diet}'`),/mevcut randevularla çakışıyor/);
      await db.exec(`update public.appointments set status='cancelled' where id='${a1}'; update public.packages set room_name='  DİYET  / LAZER ODASI ' where id='${diet}';`);
      await assert.rejects(db.exec(`update public.appointments set status='planned' where id='${a1}'`),/Ortak oda dolu/);
      await db.exec(`update public.appointments set status='missed' where id='${a2}'; update public.appointments set status='planned' where id='${a1}';`);
      await db.exec(`update public.appointments set time='23:30' where id='${a1}';`);
      await assert.rejects(db.exec(`update public.appointments set date='2030-09-21',time='00:15',status='planned' where id='${a2}'`),/Ortak oda dolu/);
    });
    await t.test('Çoklu cihaz sahipliği, randevu çakışması ve silme koruması',async()=>{
      const d2='20000000-0000-0000-0000-000000000002',d3='20000000-0000-0000-0000-000000000003',foreignDevice='20000000-0000-0000-0000-000000000004';
      const p1='30000000-0000-0000-0000-000000000004',p2='30000000-0000-0000-0000-000000000005';
      const c2='10000000-0000-0000-0000-000000000002';
      const e1='40000000-0000-0000-0000-000000000004',e2='40000000-0000-0000-0000-000000000005';
      const a1='50000000-0000-0000-0000-000000000004',a2='50000000-0000-0000-0000-000000000005';
      await db.exec(`set request.jwt.claim.sub='${other}';insert into public.devices(id,name) values('${foreignDevice}','Başka salon');set request.jwt.claim.sub='${owner}';
        insert into public.devices(id,name) values('${d2}','G5'),('${d3}','Lenf drenaj');
        insert into public.packages(id,name,device_ids,sessions,duration) values
          ('${p1}','Kombine',array['${device}','${d2}','${d2}']::uuid[],10,60),
          ('${p2}','Diğer bakım',array['${d3}']::uuid[],10,45);`);
      const stored=()=>db.query<{device_id:string|null,device_ids:string[]}>(`select device_id,device_ids from public.packages where id='${p1}'`);
      assert.deepEqual((await stored()).rows[0],{device_id:device,device_ids:[device,d2]});
      // Supabase saves through UPSERT: both BEFORE INSERT and BEFORE UPDATE run.
      await db.exec(`insert into public.packages(id,name,device_id,device_ids,sessions,duration)
        values('${p1}','Kombine','${d2}',array['${d2}','${device}']::uuid[],10,60)
        on conflict(id) do update set device_id=excluded.device_id,device_ids=excluded.device_ids;`);
      assert.deepEqual((await stored()).rows[0],{device_id:d2,device_ids:[d2,device]});
      await db.exec(`update public.packages set device_ids=array['${device}','${d2}']::uuid[] where id='${p1}'`);
      await assert.rejects(db.exec(`update public.packages set device_ids=array['${device}','${foreignDevice}']::uuid[] where id='${p1}'`),/foreign key/);
      await assert.rejects(db.exec(`update public.packages set device_ids=array['${device}',null]::uuid[] where id='${p1}'`),/boş bir cihaz/);
      await assert.rejects(db.exec(`update public.packages set device_ids=array['${device}','99999999-0000-0000-0000-000000000001']::uuid[] where id='${p1}'`),/foreign key/);
      assert.deepEqual((await stored()).rows[0].device_ids,[device,d2]);
      await assert.rejects(db.exec(`delete from public.devices where id='${d2}'`),/foreign key/);
      await assert.rejects(db.exec(`delete from public.package_devices where package_id='${p1}'`),/permission denied/);
      await db.exec(`set request.jwt.claim.sub='${other}'`);
      assert.equal((await db.query('select * from public.package_devices')).rows.length,0);
      await db.exec(`set request.jwt.claim.sub='${owner}';
        insert into public.enrollments(id,customer_id,package_id,total_sessions,start_date,end_date) values
          ('${e1}','${customer}','${p1}',10,'2031-01-01','2031-12-31'),('${e2}','${c2}','${p2}',10,'2031-01-01','2031-12-31');
        insert into public.appointments(id,customer_id,enrollment_id,date,time) values
          ('${a1}','${customer}','${e1}','2031-09-20','10:00'),('${a2}','${c2}','${e2}','2031-09-20','10:30');`);
      await assert.rejects(db.exec(`update public.packages set device_ids=array['${d3}','${d2}']::uuid[] where id='${p2}'`),/mevcut randevularla çakışıyor/);
      await db.exec(`update public.appointments set time='11:00' where id='${a2}';update public.packages set device_ids=array['${d3}','${d2}']::uuid[] where id='${p2}';`);
      await assert.rejects(db.exec(`update public.appointments set time='10:30' where id='${a2}'`),/çakışan randevu/);
      await db.exec(`update public.appointments set status='cancelled',time='10:30' where id='${a2}'`);
      await assert.rejects(db.exec(`update public.appointments set status='planned' where id='${a2}'`),/çakışan randevu/);
      await db.exec(`update public.packages set device_ids='{}'::uuid[] where id='${p1}';update public.appointments set status='planned' where id='${a2}'`);
      assert.deepEqual((await stored()).rows[0],{device_id:null,device_ids:[]});
      assert.equal((await db.query(`select * from public.package_devices where package_id='${p1}'`)).rows.length,0);
      // Removing only the shared secondary device must also release its FK link.
      await db.exec(`update public.packages set device_ids=array['${d3}']::uuid[] where id='${p2}';delete from public.devices where id='${d2}'`);
      await db.exec(`update public.packages set device_ids=array['${d3}','${device}']::uuid[] where id='${p2}'`);
      await db.exec('reset role');await db.exec(devicesMigration);await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}'`);
      assert.deepEqual((await stored()).rows[0].device_ids,[]);
      assert.deepEqual((await db.query<{device_ids:string[]}>(`select device_ids from public.packages where id='${p2}'`)).rows[0].device_ids,[d3,device]);
    });
    await t.test('Kullanılan cihaz silinmez; anonim erişim kapalıdır',async()=>{
      await assert.rejects(db.exec(`delete from public.devices where id='${device}'`));
      await db.exec('set role anon');
      await assert.rejects(db.query('select * from public.customers'));
    });
  } finally { await db.close(); }
});
