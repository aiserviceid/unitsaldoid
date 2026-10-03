# Mengaktifkan bot UnitSaldo + Gemini untuk keluarga

Fungsi `telegram-webhook` sudah dipublikasikan ke proyek Supabase ArusKasKu (`azpxkvwdmuoakipldtwa`). Database draft/konfirmasi dan kuota AI sudah diterapkan. Bot belum menerima pesan sampai secrets dan webhook dipasang. Jangan menjalankan bot-daemon polling bersamaan dengan webhook.

## 1. Isi pengaturan di Super Admin

1. Buka https://unitsaldoid.vercel.app/, tekan Ctrl+F5, lalu masuk dengan **ai.interiorid@gmail.com**.
2. Buka **Pengaturan → Super Admin → Pengaturan Bot Telegram & Gemini**.
3. Masukkan **Token Bot Telegram** @unitsaldobot yang baru dari BotFather.
4. Masukkan **API Key Gemini** dari https://aistudio.google.com/apikey. Gunakan proyek free tier tanpa mengaktifkan billing.
5. **Secret Webhook** boleh kosong: server membuat secret acak jika belum tersedia. Kolom kosong mempertahankan nilai yang sudah tersimpan.
6. Klik **Simpan & Aktifkan Bot**. Jika kunci disimpan tetapi pemasangan webhook gagal, klik **Aktifkan / Perbaiki Bot** setelah memperbaiki koneksi.
7. Klik **Cek Status Bot**, lalu kirim `/start` di Telegram.

Nilai disimpan terenkripsi di Supabase Vault. Server hanya mengembalikan status, tidak mengembalikan token/API key. Akun client tidak menampilkan formulir pengaturan dan tidak bisa mengakses endpoint admin atau RPC konfigurasi. Satu-satunya super admin adalah akun dengan email terverifikasi **ai.interiorid@gmail.com** dan is_admin aktif; pemeriksaan server memakai email dari Supabase Auth.

Jika sebelumnya sudah mengisi Supabase Edge Function Secrets, nilai tersebut masih menjadi fallback ketika pengaturan Vault belum diisi. Nilai Vault menjadi prioritas. Token lama yang pernah masuk kode perlu dicabut melalui BotFather. Jangan simpan token di config.js/GitHub atau kirim di chat.

Model default: gemini-3.1-flash-lite. Pembatas aplikasi default 20 panggilan AI per akun keluarga per hari, bukan angka kuota Google. Perintah sederhana tidak memanggil AI. Google free tier dapat menggunakan input/output untuk peningkatan produk. Bot hanya mengirim pesan yang perlu AI beserta nama/ID dompet dan kategori; saldo dan riwayat transaksi tidak dikirim.

## 2. Perpanjangan lisensi

Tombol perpanjangan membuka WhatsApp **085382535050** (format tautan **6285382535050**). Pilihan email menuju **ai.interiorid@gmail.com**. Lisensi diaktifkan oleh super admin setelah proses perpanjangan; chat WhatsApp sendiri tidak otomatis memperpanjang masa aktif.

## 3. Hubungkan suami, istri, dan anak

1. Di web klik **Buat Kode Tautan**, buka bot dari Telegram suami, kirim `/start KODE`.
2. Setelah berhasil, buat **kode baru**. Gunakan kode baru itu dari Telegram istri.
3. Buat **kode baru lagi** untuk Telegram anak.
4. Semua anggota muncul di web dan masuk ke pembukuan yang sama. Satu kode hanya dapat digunakan sekali. Telegram berarti akun pengguna Telegram; bot tidak membaca nomor telepon pribadi.
5. Klik **Putuskan** pada anggota tertentu untuk mencabut aksesnya. Semua anggota terhubung saat ini boleh membaca saldo/laporan dan mencatat transaksi. Belum ada pembatas khusus anak.

## 4. Coba perintah

- `/saldo`: saldo semua dompet keluarga.
- `/utang`, `/piutang`: sisa tagihan dari database.
- `/laporan`: arus kas bulan ini dalam zona waktu Jakarta.
- `beli beras 75rb pakai Tunai`
- `terima gaji 3jt ke BCA`
- `transfer 100rb dari BCA ke DANA`
- Bahasa lebih bebas dibaca Gemini jika API key aktif; nominal/dompet yang tidak jelas perlu diklarifikasi.

Bot menampilkan ringkasan **belum tersimpan** dengan tombol **Simpan / Batal**. Tekan Simpan untuk mencatat. Klik ganda atau kiriman callback ulang tidak menggandakan transaksi. Ringkasan berlaku 15 menit. Tidak ada riwayat percakapan lintas pesan; klarifikasi dikirim ulang sebagai kalimat lengkap.

Utang/piutang baru sudah bisa dicatat lewat bot dengan konfirmasi. Contoh: `piutang Nuno 500rb dari Tunai bayar tanggal 10 bulan depan` atau `saya utang ke Nuno 500rb masuk Tunai jatuh tempo 2026-11-03`. Kalimat ambigu seperti `Nuno utang 500rb` meminta arah utang, bukan menebak. Cicilan/pembayaran juga bisa lewat bot: `Nuno bayar hutang 200rb Tunai` berarti menerima pembayaran piutang, sedangkan `bayar utang Nuno 200rb Tunai` berarti membayar utang keluarga ke Nuno. Tanggal relatif diurai memakai waktu pesan Telegram dalam Asia/Jakarta. “Tanggal 10 bulan depan” menjadi tanggal 10 bulan berikutnya; “akhir bulan depan” memakai hari terakhir bulan berikutnya; “besok”, “8 hari lagi”, dan tanggal YYYY-MM-DD juga didukung. “Bulan depan” tanpa tanggal meminta tanggal hari, sambil menyebut bulan dan tahun yang dimaksud. Saat ini pesan berupa teks, chat pribadi, transaksi satu per pesan untuk hari ini; foto, voice note, dan tanggal lampau belum didukung.

## Verifikasi yang sudah dilakukan

- Browser regression dashboard dan Telegram web: lolos.
- Parser rupiah, negasi/ambigu, transfer, nominal tidak valid: lolos.
- Handler dengan SDK Supabase 2.57.4 asli dan HTTP uji: balasan /start, tautan keluarga, draf, callback ulang, AI JSON valid/ID asing/HTTP 429, secrets kosong dan hak admin: lolos.
- Database PGlite: tiga akun Telegram satu owner, callback harus dari anggota asal, konfirmasi atomik/idempotent, Batal, akses dicabut, dompet asing ditolak, budget AI, RPC hanya service-role: lolos.
- Parser sudah diuji otomatis untuk `masuk 1 juta tunai`, `uang masuk 1juta dari usaha`, dan `keluar 20rb tunai`. Bila beberapa dompet tersedia dan nama dompet tidak disebut, bot meminta nama dompet.
- Model default diperbarui setelah log Gemini menunjukkan 404. Pesan nyata sesudah pembaruan perlu dicoba ulang; pengujian otomatis tidak menulis transaksi pengguna.

- Konfirmasi, callback ulang, dan pencabutan akses juga diuji di database Supabase nyata dalam transaksi BEGIN/ROLLBACK, tanpa menyisakan data uji. Endpoint webhook terjangkau; POST tanpa secret mengembalikan HTTP 401. Versi fungsi aktif: 2. Menu aktivasi sudah terbit di web (commit 34c1bd4703df01e66d0cd6101debed171d6fbe26).

## Privasi Telegram keluarga
Telegram pertama dan kedua berdasarkan urutan penghubungan memiliki akses transaksi, saldo, utang, piutang, dan laporan. Telegram ketiga dan berikutnya hanya transaksi; perintah pemeriksaan ditolak server, termasuk intent Gemini. Menghubungkan ulang Telegram yang sama ke keluarga yang sama mempertahankan urutan. Jalankan PRIVASI_TELEGRAM.sql setelah skrip database sebelumnya bila memasang ulang.

## Nama pencatat
Nama lengkap Telegram pengirim disimpan pada draf, lalu pada mutasi dan tagihan saat dikonfirmasi. Nama tidak diambil dari isi pesan atau hasil AI. Ringkasan bot dan riwayat web menampilkan Pencatat. Transaksi lama tanpa snapshot memakai nama tautan Telegram saat pembaruan jika tersedia. Saat memasang ulang, jalankan UTANG_PENCATAT_TELEGRAM.sql terakhir setelah BOT_TELEGRAM.sql dan PRIVASI_TELEGRAM.sql. Uji langsung database untuk sinkronisasi, snapshot nama, dan callback ganda lolos dalam transaksi rollback.

Tanggal lengkap tampil pada ringkasan bot dan disimpan sebagai due_date, sehingga masuk kalender jatuh tempo web. Draf lama sebelum perbaikan tidak dihitung ulang; batalkan lalu kirim ulang bila tanggalnya belum terbaca.

## Cicilan Telegram
Tagihan dicari dengan nama persis tanpa membedakan huruf besar/kecil, milik keluarga yang sama dan jenis yang sesuai. Bila nama memiliki beberapa tagihan aktif, pilih lewat web untuk menghindari salah alokasi; bot tidak menebak. Saat Simpan, server mengunci tagihan, memeriksa sisa, lalu menyimpan pembayaran, mutasi dan status secara atomik. Telegram pertama/kedua menerima sisa tagihan setelah simpan. Telegram ketiga hanya konfirmasi tanpa sisa/principal. Nama pencatat tersimpan pada pembayaran dan mutasi. Jalankan CICILAN_TELEGRAM.sql terakhir pada pemasangan ulang. Uji database live memakai rollback: pembayaran 200.000 atas piutang 500.000 menghasilkan sisa 300.000 dan tepat satu mutasi.
