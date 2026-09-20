import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import { emptyData, makeDemoData, validatePackageSchedule } from './model';
import type { Data, Package, Table } from './model';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key && !url.includes('YOUR_PROJECT') ? createClient(url, key) : null;
const demoKey = 'atelier-demo-v1';
type Store = { data: Data; demo: boolean; loading: boolean; error: string; session: Session | null; busy: boolean; save: <K extends Table>(table: K, row: Data[K][number]) => Promise<boolean>; getSaveError: () => string; remove: (table: Table, id: string) => Promise<boolean>; reload: () => Promise<void>; toast: string; inform: (message: string) => void; };
const Context = createContext<Store>(null!);
export function Provider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data>(emptyData); const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [toast, inform] = useState('');
  const dataRef = useRef(data); dataRef.current = data; const locked = useRef(false);
  const authUser = useRef<string | null>(null); const requestVersion = useRef(0);
  const saveError = useRef('');
  async function reload() {
    if (!supabase) return;
    const expectedUser = authUser.current; const version = ++requestVersion.current;
    setLoading(true); setError('');
    const tables = Object.keys(emptyData) as Table[];
    try {
      const results = await Promise.all(tables.map(async table => {
        const rows: unknown[] = [];
        for (let offset = 0; ; offset += 1000) {
          const result = await supabase!.from(table).select('*').order('id').range(offset, offset + 999);
          if (result.error) throw result.error;
          rows.push(...result.data);
          if (result.data.length < 1000) break;
        }
        return rows;
      }));
      if (expectedUser === authUser.current && version === requestVersion.current) setData(Object.fromEntries(tables.map((table, i) => [table, results[i]])) as Data);
    } catch { if (version === requestVersion.current) setError('Veriler yüklenemedi. Bağlantınızı ve Supabase kurulumunu kontrol edip tekrar deneyin.'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => {
    if (!supabase) { try { const saved = sessionStorage.getItem(demoKey); setData(saved ? JSON.parse(saved) : makeDemoData()); } catch { setData(makeDemoData()); } setLoading(false); return; }
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      const nextId = next?.user.id ?? null;
      if (authUser.current !== nextId) { authUser.current = nextId; requestVersion.current++; setData(emptyData); setError(''); }
      setSession(next); if (!next) setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session?.user.id) void reload(); }, [session?.user.id]);
  useEffect(() => { if (!supabase && !loading) try { sessionStorage.setItem(demoKey, JSON.stringify(data)); } catch { inform('Önizleme verileri bu tarayıcıda saklanamadı.'); } }, [data, loading]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => inform(''), 4500); return () => clearTimeout(timer); }, [toast]);
  async function save<K extends Table>(table: K, row: Data[K][number]) {
    if (locked.current) return false; locked.current = true; setBusy(true); saveError.current = '';
    try {
      if (table === 'packages') { const message = validatePackageSchedule(dataRef.current, row as Package); if (message) throw { code: 'P0001', message }; }
      if (supabase) { const { error } = await supabase.from(table).upsert({ ...row, user_id: session!.user.id }); if (error) throw error; }
      const existing = dataRef.current[table] as { id: string }[];
      setData(prev => ({ ...prev, [table]: existing.some(r => r.id === row.id) ? existing.map(r => r.id === row.id ? row : r) : [...existing, row] }));
      inform('Değişiklikler kaydedildi.'); return true;
    } catch (err) {
      const problem = err as { code?: string; message?: string };
      saveError.current = problem.code === 'P0001' ? problem.message ?? 'Randevu çakışması nedeniyle kaydedilemedi.' : ['42703','PGRST204'].includes(problem.code ?? '') && problem.message?.includes('device_ids') ? 'Çoklu cihaz güncellemesi henüz kurulmamış. Supabase SQL Editor’da önce 20260920_shared_rooms.sql, ardından 20260920_package_devices.sql dosyasını çalıştırın.' : problem.message?.includes('room_name') ? 'Oda güncellemesi henüz kurulmamış. Supabase SQL Editor’da 20260920_shared_rooms.sql dosyasını çalıştırın.' : 'Kaydedilemedi. Bağlantıyı, tarihleri ve seans çakışmalarını kontrol edin.';
      inform(saveError.current); return false;
    }
    finally { locked.current = false; setBusy(false); }
  }
  async function remove(table: Table, id: string) {
    if (locked.current) return false; locked.current = true; setBusy(true);
    try {
      if (supabase) { const { error } = await supabase.from(table).delete().eq('id', id); if (error) throw error; }
      setData(prev => ({ ...prev, [table]: prev[table].filter(r => r.id !== id) })); inform('Kayıt silindi.'); return true;
    } catch { inform('Kayıt silinemedi. Kullanılan cihazları ve paketleri arşivleyebilirsiniz.'); return false; }
    finally { locked.current = false; setBusy(false); }
  }
  return <Context.Provider value={{ data, demo: !supabase, loading, error, session, busy, save, getSaveError: () => saveError.current, remove, reload, toast, inform }}>{children}</Context.Provider>;
}
export const useStore = () => useContext(Context);
