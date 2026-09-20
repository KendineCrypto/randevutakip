import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentPackageChoices, compareMeasurements, emptyData, packageRoom, progress, roomKey, SHARED_ROOM, validateAppointment } from '../src/model.ts';
import type { Data, Appointment, Measurement } from '../src/model.ts';
const measurements:Measurement[]=[{id:'b',customer_id:'c',date:'2026-09-10',values:{lower_belly:87}},{id:'a',customer_id:'c',date:'2026-09-01',values:{lower_belly:92}},{id:'c',customer_id:'c',date:'2026-09-12',values:{hips:95}}];
test('Ölçüm tarihlerini sıralar, eksik bölgeyi sıfır saymaz',()=>{const r=compareMeasurements(measurements,'lower_belly');assert.equal(r.first,92);assert.equal(r.last,87);assert.equal(r.delta,-5);assert.equal(r.ordered.length,2);assert.equal(measurements[0].id,'b');});
test('Tek ölçümde değişim hesaplanmaz',()=>assert.equal(compareMeasurements(measurements,'hips').delta,null));
test('Olmayan bölgede değer uydurmaz',()=>assert.deepEqual(compareMeasurements(measurements,'right_arm'),{ordered:[],first:undefined,last:undefined,delta:null}));
const appointment:Appointment={id:'a',customer_id:'c',enrollment_id:'e',date:'2026-09-15',time:'10:00',status:'planned'};
function fixture():Data{return {...structuredClone(emptyData),packages:[{id:'p',name:'Paket',device_id:'device',sessions:2,duration:60,price:100,active:true}],enrollments:[{id:'e',customer_id:'c',package_id:'p',total_sessions:2,start_date:'2026-09-01',end_date:'2026-10-01'},{id:'e2',customer_id:'c2',package_id:'p',total_sessions:2,start_date:'2026-09-01',end_date:'2026-10-01'}],appointments:[{...appointment}]};}
test('Yalnızca geldi kayıtları seans sayacını artırır',()=>{const data=fixture();data.appointments.push({...appointment,id:'b',status:'attended'},{...appointment,id:'c',status:'missed'},{...appointment,id:'d',status:'cancelled'});assert.equal(progress(data,data.enrollments[0]),1);});
test('Paket başlangıç ve bitiş tarihleri denetlenir',()=>{const data=fixture();assert.ok(validateAppointment(data,{...appointment,date:'2026-08-31'}));assert.ok(validateAppointment(data,{...appointment,date:'2026-10-02'}));assert.equal(validateAppointment(data,{...appointment,date:'2026-09-01'}),null);});
test('Başka müşterinin paketini kullanamaz',()=>assert.ok(validateAppointment(fixture(),{...appointment,customer_id:'c2'})));
test('Aynı cihazda örtüşen süre engellenir, ardışık süreye izin verilir',()=>{const data=fixture();assert.ok(validateAppointment(data,{...appointment,id:'b',customer_id:'c2',enrollment_id:'e2',time:'10:30'}));assert.equal(validateAppointment(data,{...appointment,id:'b',customer_id:'c2',enrollment_id:'e2',time:'11:00'}),null);});
test('İptal edilmiş randevu cihazı meşgul etmez',()=>{const data=fixture();data.appointments[0].status='cancelled';assert.equal(validateAppointment(data,{...appointment,id:'b',customer_id:'c2',enrollment_id:'e2'}),null);});
test('Gece yarısını aşan seans sonraki günle de çakışır',()=>{const data=fixture();data.appointments[0].time='23:30';assert.ok(validateAppointment(data,{...appointment,id:'b',customer_id:'c2',enrollment_id:'e2',date:'2026-09-16',time:'00:15'}));});
test('Aynı randevuyu düzenlemek kendi kendine çakışma oluşturmaz',()=>assert.equal(validateAppointment(fixture(),{...appointment,status:'attended'}),null));
test('Tamamlanan seans sayısı paket limitini aşamaz',()=>{const data=fixture();data.appointments=[{...appointment,id:'b',date:'2026-09-02',status:'attended'},{...appointment,id:'c',date:'2026-09-03',status:'attended'}];assert.ok(validateAppointment(data,{...appointment,status:'attended'}));assert.equal(validateAppointment(data,{...data.appointments[0]}),null);});

test('Yeni müşteriye paket atanmamış olsa da bakım kataloğu seçilebilir',()=>{
  const data=fixture(); const choices=appointmentPackageChoices(data,'yeni-musteri');
  assert.equal(choices.assigned.length,0); assert.equal(choices.catalog[0].id,'p');
  data.packages[0].active=false; assert.equal(appointmentPackageChoices(data,'c').catalog.length,0);
  assert.equal(appointmentPackageChoices(data,'c').assigned.length,1);
});
test('Paket seçimi müşteriler arasında atanmış paketleri karıştırmaz',()=>{
  const data=fixture(); assert.deepEqual(appointmentPackageChoices(data,'c2').assigned.map(e=>e.id),['e2']);
});
test('Diyet/lazer adları ortak odaya bağlanır; açık oda tercihi önceliklidir',()=>{
  for(const name of ['Diyet paketi','DİYET','DIYET','Lazer epilasyon']) assert.equal(packageRoom({name}),SHARED_ROOM);
  assert.equal(packageRoom({name:'Lazer',room_name:'  Oda   2  '}),'Oda 2');
  assert.equal(roomKey('  DİYET / LAZER ODASI '),roomKey(SHARED_ROOM));
  assert.equal(packageRoom({name:'Cilt bakımı'}),'');
});
function sharedRoomFixture():Data{
  const data=fixture();data.packages[0].name='Lazer';
  data.packages.push({...data.packages[0],id:'diet',name:'Diyet',device_id:null,duration:30});
  data.enrollments[1].package_id='diet';return data;
}
test('Farklı müşteri ve cihaz olsa da lazer/diyet süre çakışması engellenir',()=>{
  const data=sharedRoomFixture();
  assert.match(validateAppointment(data,{...appointment,id:'diet-a',customer_id:'c2',enrollment_id:'e2',time:'10:30'})??'',/odası/);
  assert.equal(validateAppointment(data,{...appointment,id:'diet-a',customer_id:'c2',enrollment_id:'e2',time:'11:00'}),null);
  assert.ok(validateAppointment(data,{...appointment,id:'diet-a',customer_id:'c2',enrollment_id:'e2',time:'09:45'}));
});
test('Farklı odalar ve iptal/gelmedi kayıtları odayı bloke etmez',()=>{
  const data=sharedRoomFixture();data.packages[1].room_name='Oda 2';
  const row={...appointment,id:'diet-a',customer_id:'c2',enrollment_id:'e2'};
  assert.equal(validateAppointment(data,row),null);data.packages[1].room_name='';
  for(const status of ['missed','cancelled'] as const){data.appointments[0].status=status;assert.equal(validateAppointment(data,row),null);}
});
test('Ortak oda gece yarısını aşan lazer seansında da doludur',()=>{
  const data=sharedRoomFixture();data.appointments[0].time='23:30';
  assert.ok(validateAppointment(data,{...appointment,id:'diet-a',customer_id:'c2',enrollment_id:'e2',date:'2026-09-16',time:'00:15'}));
});
