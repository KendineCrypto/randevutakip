export type Customer = { id: string; name: string; phone: string; email: string; created_at: string; active: boolean };
export type Device = { id: string; name: string; description: string; active: boolean };
export type Package = { id: string; name: string; device_id: string | null; device_ids?: string[]; room_name?: string; sessions: number; duration: number; price: number; active: boolean };
export type Enrollment = { id: string; customer_id: string; package_id: string; total_sessions: number; start_date: string; end_date: string };
export type Appointment = { id: string; customer_id: string; enrollment_id: string; date: string; time: string; status: 'planned' | 'attended' | 'missed' | 'cancelled' };
export type Note = { id: string; customer_id: string; text: string; created_at: string };
export const regions = [ ['right_arm', 'Sağ kol'], ['left_arm', 'Sol kol'], ['upper_belly', 'Üst göbek'], ['lower_belly', 'Alt göbek'], ['hips', 'Kalça'], ['right_thigh', 'Sağ üst bacak'], ['left_thigh', 'Sol üst bacak'], ['right_knee', 'Sağ diz kapağı'], ['left_knee', 'Sol diz kapağı'], ['right_calf', 'Sağ baldır'], ['left_calf', 'Sol baldır'] ] as const;
export type Region = typeof regions[number][0];
export type Measurement = { id: string; customer_id: string; date: string; values: Partial<Record<Region, number>> };
export type Data = { customers: Customer[]; devices: Device[]; packages: Package[]; enrollments: Enrollment[]; appointments: Appointment[]; notes: Note[]; measurements: Measurement[] };
export type Table = keyof Data;
export const emptyData: Data = { customers: [], devices: [], packages: [], enrollments: [], appointments: [], notes: [], measurements: [] };
export function dateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function addDays(date: string, days: number) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return dateKey(d); }
export const shortDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
export const money = (amount: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(amount);
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('');
export function progress(data: Data, enrollment: Enrollment) { return data.appointments.filter(a => a.enrollment_id === enrollment.id && a.status === 'attended').length; }
// Old saved demos and rows remain readable until the SQL upgrade is applied.
export function packageDeviceIds(pkg?: Pick<Package, 'device_id' | 'device_ids'>): string[] {
  return [...new Set(pkg?.device_ids ?? (pkg?.device_id ? [pkg.device_id] : []))];
}
export function packageDeviceNames(data: Data, pkg?: Package): string {
  return packageDeviceIds(pkg).map(id => data.devices.find(d => d.id === id)?.name ?? 'Bilinmeyen cihaz').join(' + ') || 'Cihaz atanmamış';
}
export const SHARED_ROOM = 'Diyet / lazer odası';
export function packageRoom(pkg?: Pick<Package, 'name' | 'room_name'>): string {
  if (!pkg) return '';
  if (pkg.room_name?.trim()) return pkg.room_name.trim().replace(/\s+/g, ' ');
  return /diyet|lazer/.test(pkg.name.replace(/[İIı]/g, 'i').toLowerCase()) ? SHARED_ROOM : '';
}
export function roomKey(room: string): string { return room.trim().replace(/\s+/g, ' ').replace(/[İIı]/g, 'i').toLowerCase(); }
export function appointmentPackageChoices(data: Data, customerId: string) {
  return {
    assigned: data.enrollments.filter(e => e.customer_id === customerId),
    catalog: data.packages.filter(p => p.active),
  };
}
export function compareMeasurements(measurements: Measurement[], region: Region) {
  const ordered = [...measurements].filter(m => m.values[region] != null).sort((a, b) => a.date.localeCompare(b.date));
  const first = ordered[0]?.values[region]; const last = ordered.at(-1)?.values[region];
  return { ordered, first, last, delta: ordered.length > 1 && first != null && last != null ? Math.round((last - first) * 10) / 10 : null };
}
export function validateAppointment(data: Data, appointment: Appointment): string | null {
  const enrollment = data.enrollments.find(e => e.id === appointment.enrollment_id && e.customer_id === appointment.customer_id);
  if (!enrollment) return 'Müşteriye ait bir paket seçin.';
  if (appointment.date < enrollment.start_date || appointment.date > enrollment.end_date) return 'Randevu tarihi paket başlangıç ve bitiş tarihleri arasında olmalı.';
  if (appointment.status === 'attended' && data.appointments.filter(a => a.id !== appointment.id && a.enrollment_id === enrollment.id && a.status === 'attended').length >= enrollment.total_sessions) return 'Bu paketteki tüm seanslar tamamlanmış.';
  if (['cancelled', 'missed'].includes(appointment.status)) return null;
  const pkg = data.packages.find(p => p.id === enrollment.package_id);
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const dayMinute = (date: string) => Date.parse(`${date}T00:00:00Z`) / 60000;
  const start = dayMinute(appointment.date) + minutes(appointment.time); const end = start + (pkg?.duration ?? 60);
  let reason = '';
  const conflict = data.appointments.some(a => {
    if (a.id === appointment.id || ['cancelled', 'missed'].includes(a.status)) return false;
    const otherEnrollment = data.enrollments.find(e => e.id === a.enrollment_id);
    const otherPackage = data.packages.find(p => p.id === otherEnrollment?.package_id);
    const sameCustomer = a.customer_id === appointment.customer_id;
    const sameDevice = packageDeviceIds(pkg).some(id => packageDeviceIds(otherPackage).includes(id));
    const room = packageRoom(pkg);
    const sameRoom = !!room && roomKey(room) === roomKey(packageRoom(otherPackage));
    const otherStart = dayMinute(a.date) + minutes(a.time);
    if (!(sameCustomer || sameDevice || sameRoom) || start >= otherStart + (otherPackage?.duration ?? 60) || end <= otherStart) return false;
    reason = sameRoom ? `${room}, ${shortDate(a.date)} ${a.time.slice(0, 5)} başlangıçlı ${otherPackage?.name ?? 'başka bir'} seansı için dolu (${otherPackage?.duration ?? 60} dk). Başka bir saat seçin.` : 'Bu saatte müşteri veya cihaz için başka bir randevu var.';
    return true;
  });
  return conflict ? reason : null;
}
export function validatePackageSchedule(data: Data, pkg: Package, now = Date.now()): string | null {
  const old = data.packages.find(p => p.id === pkg.id);
  if (!old || (old.duration === pkg.duration && roomKey(packageRoom(old)) === roomKey(packageRoom(pkg)) &&
    [...packageDeviceIds(old)].sort().join() === [...packageDeviceIds(pkg)].sort().join())) return null;
  const updated = { ...data, packages: data.packages.map(p => p.id === pkg.id ? pkg : p) };
  const affected = new Set(data.enrollments.filter(e => e.package_id === pkg.id).map(e => e.id));
  for (const a of data.appointments) {
    if (!affected.has(a.enrollment_id) || !['planned', 'attended'].includes(a.status) ||
      new Date(`${a.date}T${a.time}`).getTime() + pkg.duration * 60000 <= now) continue;
    if (validateAppointment(updated, a)) return 'Bu oda, cihaz veya süre değişikliği mevcut randevularla çakışıyor. Önce çakışan randevuları taşıyın.';
  }
  return null;
}
export function makeDemoData(): Data {
  const today = dateKey(); const id = () => crypto.randomUUID();
  const devices: Device[] = [ ['LPG Alliance', 'Bölgesel incelme & sıkılaşma'], ['G5 Masaj', 'Dolaşım & vücut bakımı'], ['Diyot Lazer', 'Lazer epilasyon'], ['Hydrafacial', 'Cilt bakımı'] ].map(([name, description]) => ({ id: id(), name, description, active: true }));
  const packages: Package[] = [ ['Bölgesel İncelme', 0, 10, 45, 8500], ['Vücut Şekillendirme', 1, 8, 40, 6000], ['Lazer Epilasyon', 2, 8, 60, 12000], ['Işıltılı Cilt Bakımı', 3, 4, 60, 4500] ].map(([name, device, sessions, duration, price]) => ({ id: id(), name: String(name), device_id: devices[Number(device)].id, sessions: Number(sessions), duration: Number(duration), price: Number(price), active: true }));
  const customers: Customer[] = ['Selin Yılmaz', 'Derya Demir', 'Ece Aydın', 'Zeynep Kaya', 'İrem Aksoy', 'Elif Çelik', 'Buse Şahin', 'Aslı Yıldız'].map((name, i) => ({ id: id(), name, phone: `0532 000 00 0${i + 1}`, email: '', created_at: addDays(today, -45 + i * 3), active: true }));
  const enrollments: Enrollment[] = customers.map((c, i) => ({ id: id(), customer_id: c.id, package_id: packages[i % 4].id, total_sessions: packages[i % 4].sessions, start_date: addDays(today, -35), end_date: addDays(today, 55) }));
  const appointments: Appointment[] = enrollments.flatMap((e, i) => Array.from({ length: i === 0 ? 5 : i % 3 + 1 }, (_, j) => ({ id: id(), customer_id: e.customer_id, enrollment_id: e.id, date: addDays(today, -30 + j * 5), time: `${10 + i}:00`, status: 'attended' as const })));
  const times = ['09:00', '10:00', '11:30', '13:00', '14:30', '16:00'];
  enrollments.slice(0, 6).forEach((e, i) => appointments.push({ id: id(), customer_id: e.customer_id, enrollment_id: e.id, date: today, time: times[i], status: i < 2 ? 'attended' : i === 3 ? 'missed' : 'planned' }));
  appointments.push({ id: id(), customer_id: customers[6].id, enrollment_id: enrollments[6].id, date: addDays(today, 1), time: '10:00', status: 'planned' });
  const notes: Note[] = [{ id: id(), customer_id: customers[0].id, text: '5. seans sonrası ölçüm alındı. Bir sonraki seansta alt göbek ve kalça bölgesine odaklanılacak.', created_at: new Date().toISOString() }, { id: id(), customer_id: customers[2].id, text: 'Bir sonraki randevusu için öğleden sonra saatlerini tercih ediyor.', created_at: new Date().toISOString() }];
  const base = [32, 31, 84, 92, 104, 61, 60, 39, 38, 37, 36];
  const measurements: Measurement[] = [0, 1, 2, 3].map((n) => ({ id: id(), customer_id: customers[0].id, date: addDays(today, -30 + n * 10), values: Object.fromEntries(regions.map(([key], i) => [key, base[i] - n * (i === 3 ? 1.8 : i === 4 ? 1.3 : .6)])) }));
  return { customers, devices, packages, enrollments, appointments, notes, measurements };
}
