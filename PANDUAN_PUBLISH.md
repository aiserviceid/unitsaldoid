# Panduan Publikasi (Publish) UnitSaldo & Bot Telegram AI

Dokumen ini menjelaskan langkah publikasi pembaruan terbaru:
1. **Telegram Bot Full AI**: Pembacaan foto struk (OCR Gemini Vision), penanganan perintah tidak lengkap dengan tombol popup pilihan dompet, dan conversational chat AI.
2. **Web App Frontend**: Pengaturan ubah password, autentikasi 2 faktor (2FA), dan fitur reset data transaksi di zona berbahaya (tampilan web app tetap terjaga 100%).

---

## Opsi 1: Publikasi Otomatis via Token Mandiri (Rekomendasi - Anti Login Global)

Sesuai aturan isolasi projek agar tidak menimpa akun lain di komputer ini:

1. Buka file `.env` di folder `aruskasku-web`.
2. Masukkan token akses Anda:
   - **`SUPABASE_ACCESS_TOKEN`**: Dapatkan di [Supabase Dashboard Access Tokens](https://supabase.com/dashboard/account/tokens) (memiliki izin deploy Edge Functions ke project `azpxkvwdmuoakipldtwa`).
   - **`VERCEL_TOKEN`**: Dapatkan di [Vercel Account Tokens](https://vercel.com/account/tokens) (opsional, jika ingin frontend di-deploy otomatis ke Vercel).
3. Jalankan perintah:
   ```powershell
   node deploy.mjs
   ```
   Skrip akan secara otomatis mempublikasikan Edge Function ke Supabase dan frontend ke Vercel tanpa perlu login CLI global.

---

## Opsi 2: Publikasi Manual / Langsung via Dashboard

Jika tidak ingin membuat access token, Anda bisa langsung memperbarui lewat dashboard web:

### 1. Supabase Edge Function (`telegram-webhook`)
1. Buka [Supabase Dashboard - Edge Functions](https://supabase.com/dashboard/project/azpxkvwdmuoakipldtwa/functions).
2. Pilih fungsi **`telegram-webhook`**.
3. Buka tab editor atau unggah file:
   - Salin seluruh isi file lokal: `supabase/functions/telegram-webhook/index.ts`
   - Paste ke editor dashboard lalu klik **Deploy**.
4. Selesai! Webhook bot Telegram Anda langsung aktif dengan kemampuan AI membaca struk & tombol popup.

### 2. Frontend Web App (`dist/`)
1. Buka dashboard [Vercel](https://vercel.com/dashboard) pada proyek `unitsaldoid` (atau `bigbossyudi`).
2. Unggah/drag folder **`dist/`** atau gunakan integrasi Git:
   - Commit & push isi folder `dist/` ke repositori GitHub `aiserviceid/unitsaldoid` (jika menggunakan auto-deploy GitHub-to-Vercel).

---

## Verifikasi Setelah Publish

1. **Bot Telegram**:
   - Kirim foto struk belanja ke bot di Telegram. Bot akan otomatis membaca total, tanggal, dan menanyakan pilihan dompet bila belum ditentukan.
   - Ketik pesan santai seperti *"Halo bot, lagi ngapain?"*. Bot akan membalas dengan AI cerdas ramah beserta tombol aksi cepat.
2. **Web App**:
   - Buka `https://unitsaldoid.vercel.app/` (tekan `Ctrl + F5` untuk membersihkan cache).
   - Masuk ke menu **Pengaturan**, periksa bagian **Ubah Password**, **Two-Factor Authentication (2FA)**, dan **Zona Berbahaya: Reset Transaksi**.
