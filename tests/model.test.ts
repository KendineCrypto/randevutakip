import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMeasurements, emptyData, progress, validateAppointment } from '../src/model.ts';
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
