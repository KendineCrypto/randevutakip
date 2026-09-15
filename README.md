# Atelier — Güzellik salonu yönetimi

Türkçe, telefon ve masaüstüne uyumlu müşteri, randevu, seans, not ve beden ölçümü takip uygulaması. React + TypeScript + Vite; kalıcı veriler ve yönetici girişi Supabase üzerindedir. Vercel dağıtım ayarları hazırdır.

## Yerelde çalıştırma

Node.js 22.12+ kullanın.

```powershell
npm install
npm run dev
```

Tarayıcıda terminalin gösterdiği adresi açın (varsayılan `http://localhost:5173`). Ortam değişkenleri olmadan **yalnızca örnek verilerle demo** açılır. Demo verileri sekmenin sessionStorage alanındadır; sekme kapatıldığında kaybolabilir, cihazlar arasında paylaşılmaz. Gerçek müşterileri demoya girmeyin. Supabase yapılandırılınca demo verileri aktarılmaz, temiz ve giriş korumalı çalışma alanı açılır.

## Supabase kurulumu

1. [Supabase](https://supabase.com/dashboard) üzerinde proje oluşturun. Veritabanı parolasını güvenli yerde saklayın.
2. SQL Editor'da `supabase/schema.sql` dosyasının tamamını **bir kez** çalıştırın. Bu dosya yeni proje içindir; mevcut tablolara uygulanacak migration değildir.
3. Authentication → Users üzerinden salon yöneticisini e-posta ve güçlü parola ile oluşturun. Gerekirse kullanıcı e-postasını doğrulanmış olarak işaretleyin.
4. Authentication ayarlarından **Allow new users to sign up** seçeneğini kapatın. Uygulamada açık kayıt ekranı yoktur.
5. Proje ayarlarından URL ve **publishable key** (veya legacy anon key) alın. `service_role`, secret key ve veritabanı parolasını istemciye veya bu değişkenlere kesinlikle koymayın.
6. `.env.example` dosyasını `.env` olarak kopyalayın:

```dotenv
VITE_SUPABASE_URL=https://proje-kimligi.supabase.co
VITE_SUPABASE_ANON_KEY=publishable_veya_anon_anahtari
```

7. Geliştirme sunucusunu yeniden başlatın. Oluşturduğunuz hesapla giriş yapın.

Tüm yedi tabloda RLS açıktır. Her hesap yalnızca kendi `user_id` kayıtlarını okuyup değiştirebilir; ilişkilerdeki birleşik yabancı anahtarlar başka hesaptaki müşteriye, pakete veya cihaza kayıt bağlanmasını engeller. Bu ilk sürüm tek salon yöneticisine yöneliktir; farklı hesaplar aynı salonun verilerini paylaşmaz.

## Kullanım akışı

1. **Paketler & cihazlar:** cihazlarınızı ekleyin, cihazlara bağlı paketleri ve istediğiniz seans sayısını belirleyin.
2. **Müşteriler:** müşteri oluşturun. Kartını açıp Paketler & seanslar → Paket ata seçin. Müşteriye özel seans sayısı, başlangıç ve bitiş tarihi girin.
3. **Randevu takvimi:** müşteriyi ve atanmış paketi seçerek tarih/saat belirleyin. Aynı müşteri/cihazın çakışan saatleri kontrol edilir.
4. Katılım durumunu **Geldi**, **Gelmedi**, **Planlandı** veya **İptal edildi** olarak değiştirin. Yalnızca Geldi kayıtları tamamlanan seansları artırır; toplam seans sayısı aşılamaz. Yanlış durum aynı menüden düzeltilebilir.
5. Müşteri notlarına seans gözlemi ve hatırlatmaları ekleyin. Tarihler ve seans ilerlemesi ayrıca müşteri kartında hesaplanır.
6. **Beden ölçümleri:** müşteriyi seçin, ölçüm tarihini ve ölçülen bölgeleri girin. Boş alanlar eksik ölçümdür, sıfır sayılmaz. Tarihe göre ilk ve son **dolu** ölçüm karşılaştırılır. Grafikte negatif değer azalışı, pozitif değer artışı ifade eder; tıbbi değerlendirme yapılmaz.
7. Vücut şeması önden görünümdür: müşterinin sağ tarafı izleyenin solundadır. Sağ/sol kollar, üst bacaklar, diz kapakları, baldırlar; üst/alt göbek ve kalça ayrı izlenir. Şema klavyeyle ve bölge seçme menüsüyle kullanılabilir.

Bir müşteriye aynı gün tek ölçüm seti girilir. Yanlış ölçümü silip doğru kaydı yeniden ekleyin. Kullanılmış cihaz/paketler geçmişi korumak için silinmez; arşivlenir. Kullanılmamış olanlar onay penceresiyle silinebilir. Paket şablonundaki seans sayısı değişse bile mevcut müşteri paketinin seans sayısı korunur.

## Vercel'e yayınlama

1. Projeyi kendi GitHub deponuza yükleyin; `.env` dosyasını yüklemeyin.
2. Vercel → Add New Project → depoyu seçin. Framework: Vite. Build: `npm run build`; Output: `dist`.
3. Environment Variables bölümüne iki `VITE_SUPABASE_*` değişkenini ekleyin. Bunlar derleme sırasında kullanılır; değiştirince yeniden deploy gerekir.
4. Deploy edin; yayınlanan adreste Supabase yöneticisiyle giriş yapın. Authentication → URL Configuration'da Site URL'yi yayın adresiniz olarak ayarlayın.
5. Gerçek müşteri eklemeden önce farklı bir hesapta veri görünmediğini, oturum kapatıldığında giriş ekranı açıldığını kontrol edin.

### Ücretsiz planların sınırları

- [Vercel Hobby](https://vercel.com/docs/plans/hobby) kişisel ve ticari olmayan kullanım içindir. Bir güzellik salonunun ticari sistemi için ücretsiz Vercel uygunluğu varsayılmamalıdır; Vercel'de uygun ticari plan seçilmelidir. Ücretli plan, hesap veya abonelik otomatik oluşturulmaz.
- [Supabase Free](https://supabase.com/pricing) proje başına 500 MB veritabanı sunar; düşük müşteri sayısındaki metin ve ölçüm kayıtları için makul bir başlangıçtır. Kapasite garantisi verilmez; kullanım panelini izleyin. Düşük etkinlikteki ücretsiz projeler yaklaşık 7 gün sonra duraklatılabilir.
- Ücretsiz Supabase için düzenli dışa aktarma/yedek planı oluşturun. Gerçek müşteri bilgileri için erişimi yalnızca yetkili yöneticiyle sınırlandırın.

## Doğrulama

```powershell
npm run build
npm test
```

17 kontrol; ilk/son ölçüm sıralaması ve eksik değerleri, katılım sayacı, paket tarih sınırları, seans limiti ve gece yarısını aşan cihaz/müşteri zaman çakışmalarını kapsar. SQL şeması PGlite PostgreSQL motorunda da çalıştırılır; hesap izolasyonu, anonim erişim engeli, yabancı anahtarlar ve veritabanı doğrulamaları test edilir. Tarayıcıda müşteri oluşturma, müşteriye özel paket atama, randevu ve katılım güncelleme, ölçüm kaydı ve anatomi seçimi kontrol edilmiştir. Masaüstü ve 390 px telefon düzeni doğrulanmıştır. Gerçek Supabase bağlantısı için sizin hesabınızdaki proje ve anahtarlar gereklidir; yerel önizleme canlı veritabanı bağlantısını kanıtlamaz.

## Kapsam

Bu sürümde tahsilat/muhasebe, SMS/WhatsApp gönderimi, çalışan yetkileri ve müşterinin kendi randevusunu oluşturması bulunmaz. Paket fiyatı bilgi amaçlıdır. Cihaz modelinin her fiziksel cihazı ayrı kaynak kabul edilir; aynı modelden iki cihaz varsa ayrı cihaz kaydı oluşturun. Hesap oturumları tarayıcıda Supabase Auth tarafından yönetilir, veri transferi Supabase HTTPS API üzerinden yapılır.
