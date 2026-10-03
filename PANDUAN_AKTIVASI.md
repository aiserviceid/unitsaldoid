# Pendaftaran dan aktivasi UnitSaldo

1. Pengguna memilih Daftar Baru dan mengisi nama lengkap, WhatsApp, email, dan kata sandi.
2. Setelah pendaftaran berhasil, halaman membuka WhatsApp ke 085382535050 dengan rincian akun. Pengguna menekan Kirim sendiri.
3. Pengguna juga mengonfirmasi email melalui tautan Supabase yang dikirim ke emailnya. URL tujuan produksi harus diatur pada Authentication → URL Configuration: https://unitsaldoid.vercel.app/ .
4. Akun baru berstatus Menunggu aktivasi. Data keuangan belum dapat dibaca atau ditulis.
5. Pemilik masuk dengan email terverifikasi ai.interiorid@gmail.com → Pengaturan → Super Admin → daftar akun.
6. Periksa nama, email, serta nomor WhatsApp pendaftar, lalu pilih Verifikasi & Aktifkan (14 hari). Masa aktif dimulai saat disetujui.
7. Untuk paket berbayar, gunakan +30 Hr atau +1 Thn sesuai pembayaran. Tombol tersebut juga mengaktifkan akun yang masih menunggu.
8. Pengguna memilih Cek status aktivasi atau masuk kembali. Akun lama tidak diubah oleh pembaruan ini.

## Instalasi mandiri kode lengkap

Frontend ada di dist/. Jangan publikasikan kode backend, SQL, atau berkas rahasia sebagai aset web. Terapkan AKTIVASI_AKUN.sql paling akhir setelah CICILAN_TELEGRAM.sql, lalu deploy fungsi telegram-webhook dari supabase/functions/telegram-webhook. Pembaruan ini sudah diterapkan pada proyek Supabase azpxkvwdmuoakipldtwa.

Menu Utang/Piutang tersedia langsung pada navigasi bawah HP. Nama pengguna berada di bawah logo desktop dan HP; pengaturan tetap tersedia melalui menu Pengaturan/Lainnya.
