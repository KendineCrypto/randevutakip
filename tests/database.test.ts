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
    await db.exec(await fs.readFile(new URL('../supabase/schema.sql', import.meta.url),'utf8'));
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
    await t.test('Kullanılan cihaz silinmez; anonim erişim kapalıdır',async()=>{
      await assert.rejects(db.exec(`delete from public.devices where id='${device}'`));
      await db.exec('set role anon');
      await assert.rejects(db.query('select * from public.customers'));
    });
  } finally { await db.close(); }
});
