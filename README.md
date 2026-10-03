# UnitSaldo — paket perbaikan

Aplikasi web keuangan berbasis Supabase, dengan desain putih/hijau sesuai gambar acuan. Frontend tetap berada di `dist/` dan bisa disajikan sebagai situs statis.

## Memasang pembaruan pada aplikasi yang sudah ada

1. Cadangkan database dan folder aplikasi lama.
2. Jalankan **FIX_UNITSALDO.sql** di SQL Editor proyek Supabase yang sama. Ini menambah fungsi atomik serta memperketat akses; tidak menghapus transaksi. Jangan menjalankan ulang seluruh skema untuk pembaruan biasa.
3. Ganti folder `dist` dengan versi dalam paket ini. Periksa `dist/config.js`: URL proyek, publishable key, username bot dan WhatsApp admin.
4. Jalankan `npm run start` atau server statis lain, lalu uji akun Anda. Untuk publikasi, unggah **isi folder dist** ke hosting yang digunakan.
5. Jika menggunakan bot, ikuti `PANDUAN_SETUP_LENGKAP.md`. Token bot lama yang pernah berada di kode perlu diganti lewat BotFather.

Untuk proyek Supabase baru, jalankan `supabase-migration.sql` lalu `PERBAIKAN_DATABASE_SUPABASE.sql`; keduanya sudah diakhiri pengamanan terbaru. **FIX_UNITSALDO.sql** aman dijalankan ulang.

## Aturan saldo

- Saldo dihitung dari seluruh transaksi; filter periode memengaruhi pemasukan/pengeluaran, grafik dan laporan, bukan saldo keseluruhan.
- `income`, `debt_disbursement`, `receivable_payment`: uang masuk.
- `expense`, `debt_payment`, `receivable_disbursement`: uang keluar.
- Transfer mengurangi dompet asal dan menambah dompet tujuan; tidak mengubah total saldo.
- Tagihan lama dapat dicatat tanpa mutasi kas. Untuk utang/piutang baru dengan perpindahan uang, pilih dompet pada formulir.
- Pembayaran tagihan dibuat melalui RPC atomik; transaksi terkait tidak boleh dihapus secara terpisah.
- Angka pemasukan/pengeluaran adalah **arus uang**, termasuk penerimaan/pembayaran pinjaman; bukan laporan laba rugi akuntansi.

## Pengujian

`npm install`, `npx playwright install chromium`, lalu `npm run test:db` dan `npm run test:web`.

- Database: PostgreSQL lokal melalui PGlite, skema baru + upgrade, cicilan/lunas, nominal berlebih, kepemilikan dompet, RLS, izin lisensi/admin, kode Telegram sekali pakai.
- Browser: data uji terpisah, transaksi ganda, kategori fallback, modal, filter periode, 31 tanggal, grafik mingguan, navigasi dan layar 390px, penanganan gagal baca, XSS, error JavaScript.
- `verification/desktop.png` dan `mobile.png` adalah hasil render menggunakan **data uji**, bukan data akun produksi.

Pembaruan dan pengujian transaksi database produksi Supabase berhasil pada 3 Oktober 2026 WIB, dengan data uji di-rollback. Autentikasi browser nyata, pengiriman pesan Telegram dan deploy frontend belum dilakukan. Status lisensi tersedia; penegakan lisensi menyeluruh pada semua operasi web masih perlu diterapkan bila aplikasi dijual.

## Pembaruan 3 Oktober 2026

- Memperbaiki pemuatan data dengan query thenable Supabase; tidak memanggil `.catch()` pada query builder. Kesalahan profil ikut ditampilkan tanpa menghapus saldo terakhir.
- Nama dompet kosong/duplikat dicegah; konflik database mendapat pesan ramah termasuk dompet nonaktif.
- Kode Telegram hanya ditampilkan setelah update profil mengembalikan baris tersimpan; klik ganda diblokir.
- Browser regression memakai thenable tanpa `.catch()` sesuai SDK asli; uji dompet duplikat, konflik database, dompet baru, dan kode Telegram lulus. Pemeriksaan terpisah SDK Supabase 2.57.4 asli dengan respons HTTP uji juga lulus.
- Commit frontend di `aiserviceid/unitsaldoid`: `233bea798309459719bd5e1dcfbdfc715583ffba`.

## Bot Telegram keluarga + Gemini

Fungsi webhook sudah dipublikasikan ke Supabase. Baca PANDUAN_BOT_TELEGRAM.md untuk secrets dan aktivasi dari web. Dukungan chat pribadi beberapa anggota satu akun, parsing Gemini 3.1 Flash-Lite, fallback tanpa AI, /saldo /utang /piutang /laporan, konfirmasi Simpan/Batal, pencegahan transaksi ganda. Utang/piutang baru sudah dapat dicatat lewat Telegram dengan konfirmasi arah utang, dompet, dan jatuh tempo. Cicilan/pembayaran melalui Telegram juga didukung dengan konfirmasi dan pemeriksaan sisa. Pengujian otomatis memakai fixture; log bot nyata menunjukkan kegagalan Gemini 404 pada model sebelumnya. Parser masuk/keluar diperbaiki dan model default diperbarui. Respons chat setelah pembaruan perlu dicoba pengguna.

## Super Admin 3 Oktober 2026

Hanya ai.interiorid@gmail.com terverifikasi yang memiliki hak Super Admin, is_admin aktif. Pengaturan bot/Gemini dipindahkan ke Pengaturan → Super Admin. Server menyimpan kunci di Vault, tidak mengembalikannya ke browser. Endpoint/RPC client ditolak. Perpanjangan ke WhatsApp 085382535050 dan email ai.interiorid@gmail.com. Uji client/admin, server, Vault encryption rollback, dan UI lolos.

## Privasi keluarga Telegram
Dua Telegram pertama dapat membaca keuangan. Telegram ketiga dan berikutnya hanya mencatat transaksi. Aturan ditegakkan pada webhook untuk perintah langsung dan intent Gemini, dengan izin kosong ditolak. Jalankan PRIVASI_TELEGRAM.sql terakhir setelah skrip database lama pada pemasangan ulang. Relink ke keluarga yang sama mempertahankan nomor urut. Uji parser/webhook dan database lolos untuk pembatasan akses serta relink.

Jalankan UTANG_PENCATAT_TELEGRAM.sql terakhir pada instalasi ulang. Nama pencatat Telegram disimpan sebagai snapshot pada ledger/tagihan dan ditampilkan pada riwayat web. Uji sinkronisasi database live dilakukan dengan rollback.

Tanggal jatuh tempo relatif Telegram sudah memakai waktu pesan di Asia/Jakarta; tanggal 10 bulan depan dipetakan ke tanggal kalender, tanpa bergantung pada waktu pemrosesan ulang webhook. Bulan tanpa tanggal meminta klarifikasi. Pengujian mencakup akhir tahun, tahun kabisat, tengah malam WIB, dan pesan ulang.

CICILAN_TELEGRAM.sql dijalankan terakhir setelah UTANG_PENCATAT_TELEGRAM.sql pada pemasangan ulang. Parser memahami Nuno bayar hutang 200k Tunai, lookup nama persis dan owner/type, pembayaran atomik, status partial/paid, penolakan pembayaran berlebih, serta privasi sisa tagihan Telegram ketiga.


Pembaruan foto struk, cicilan, dan pembatalan transaksi: lihat PANDUAN_STRUK_CICILAN_BATAL.md. Migrasi terakhir: supabase/migrations/20261003022203_receipt_installments_cancellation.sql.
