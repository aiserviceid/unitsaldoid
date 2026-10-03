# Pemasangan UnitSaldo

## Web dan database

Untuk memperbarui proyek lama, jalankan `FIX_UNITSALDO.sql`, kemudian pasang folder `dist` baru. Untuk proyek baru jalankan skema lengkap dan perbaikan seperti dijelaskan README.

Frontend hanya boleh memakai publishable key. Service-role key dan token Telegram hanya berada pada server. Perpanjangan diarahkan ke WhatsApp 085382535050 dan ai.interiorid@gmail.com.

## Telegram: pilih satu cara menjalankan

**Daemon Node.js:**

1. Ganti token bot lama lewat BotFather karena sebelumnya tertulis dalam source.
2. Salin `.env.example` menjadi `.env`, isi token baru, URL Supabase dan service-role key.
3. Jalankan `node --env-file=.env bot-daemon.mjs` pada server Node.js 20.6+ yang terus aktif. Jangan unggah `.env` ke hosting frontend.
4. Jangan jalankan daemon bersamaan dengan webhook. Daemon menghapus webhook ketika mulai.

**Supabase Edge Function:**

1. Simpan secret `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan `TELEGRAM_WEBHOOK_SECRET` pada environment Edge Function. Gunakan secret webhook acak yang panjang.
2. Deploy `supabase/functions/telegram-webhook/index.ts` dengan pemeriksaan JWT gateway dinonaktifkan, karena Telegram tidak mengirim JWT Supabase. Function sendiri memeriksa secret header Telegram.
3. Daftarkan webhook lewat API Telegram `setWebhook` dengan `url` URL function dan `secret_token` yang sama persis dengan `TELEGRAM_WEBHOOK_SECRET`. Tanpa secret itu, function menolak request.
4. Gemini bersifat opsional dan hanya dikonfigurasi di server; kolom API key browser tidak mengatur bot.

## Menautkan akun

Masuk web → Bot Telegram → Buat Kode Tautan → Buka Bot. Kode baru memakai UUID acak dan hanya dapat digunakan sekali. Untuk menambahkan chat lain, buat kode baru. Jangan membagikan kode ke pihak yang tidak diberi hak mencatat transaksi akun tersebut.

Memutuskan tautan di web membuat bot menolak chat tersebut pada pengecekan berikutnya; cache lokal tidak digunakan sebagai izin.

## Perintah yang didukung

- `makan siang 25rb bca`: pengeluaran.
- `gaji 5jt mandiri`: pemasukan.
- `/saldo`: saldo setiap dompet.

Webhook mendukung transfer serta utang/piutang baru dengan konfirmasi. Cicilan/pembayaran juga melalui bot dengan nama dan dompet, misalnya Nuno bayar hutang 200rb Tunai. Untuk pemasangan ulang, jalankan PRIVASI_TELEGRAM.sql lalu UTANG_PENCATAT_TELEGRAM.sql setelah skrip database lama. Pengenalan kalimat bebas tetap berbasis kata kunci/AI dan perlu pemeriksaan pengguna.

Jangan menilai bot berhasil hanya dari balasan: cek transaksi dan saldo yang tersimpan pada web setelah pengujian nyata. Dashboard membaca ulang data setiap 30 detik saat tab aktif dan saat kembali ke tab.

## Verifikasi email menuju localhost
Kode signUp sekarang menyertakan options.emailRedirectTo=https://unitsaldoid.vercel.app/. Supabase Authentication → URL Configuration tetap harus memakai Site URL https://unitsaldoid.vercel.app/ dan menambahkan URL yang sama pada Redirect URLs. Konfigurasi Auth tersebut belum diperiksa/diubah melalui dashboard; plugin yang tersedia tidak menyediakan pengaturan Auth. Bila memakai template email khusus, pastikan tautan memakai ConfirmationURL atau RedirectTo yang sesuai.

Jalankan CICILAN_TELEGRAM.sql terakhir pada instalasi ulang untuk dukungan cicilan bot.
