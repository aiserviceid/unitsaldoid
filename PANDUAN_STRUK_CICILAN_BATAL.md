# Foto struk, cicilan, dan pembatalan

Berlaku untuk UnitSaldo dan BIGBOS YUDI. Frontend commit de58ec483815f0d0a6e500c5d089340ea8a7c015; telegram-webhook versi 18, release unitsaldo-bot-2026-10-03-receipt-installments-cancel.

## Foto struk
Buka Asisten AI → Foto Struk, pilih pemasukan/pengeluaran dan dompet. Ambil foto dengan kamera HP atau unggah JPG/PNG/WebP maksimal 12 MB. Tekan Baca & Isi Transaksi. Gemini membaca total akhir, toko, tanggal, dan barang. Foto dikompresi di perangkat dan dikirim ke Gemini melalui server yang memeriksa sesi pemilik akun. Foto tidak disimpan di database/Storage aplikasi. Kunci Gemini hanya di konfigurasi super admin/Vault.

Formulir transaksi terisi otomatis. Periksa nominal, kategori, dompet, dan tanggal, lalu Simpan. Bila tanggal tidak terbaca, formulir memakai hari ini dan menampilkan pemberitahuan. Foto tidak jelas, AI tidak tersedia, atau kuota harian habis tidak membuat transaksi. Pembacaan menggunakan anggaran AI harian yang sama dengan chat/rekap. Hasil OCR perlu diperiksa sebelum menyimpan.

## Cicilan
Buka Utang & Piutang → Cicilan & Riwayat Pembayaran. Filter Utang/Piutang, pilih Catat Cicilan / Pelunasan, isi nominal sebagian atau penuh, dompet, dan catatan. Database mengunci tagihan dan menolak pembayaran melebihi sisanya. Piutang dibayar menambah saldo; utang dibayar mengurangi saldo. Setiap pembayaran terhubung ke transaksi ledger dan menampilkan tanggal, dompet, catatan, serta pencatat.

## Pembatalan transaksi yang sudah disimpan
Telegram: kirim `/batal` atau `batal transaksi terakhir`. Yang dipilih adalah transaksi terakhir yang dicatat oleh Telegram pengirim tersebut. Periksa ringkasan, kemudian tekan Ya, batalkan. Untuk transaksi tertentu, kirim `batal transaksi UUID`. Web Asisten AI mendukung kalimat yang sama; transaksi terakhir berasal dari akun yang login. Tombol Batalkan pada riwayat cicilan juga membuka ringkasan dan konfirmasi.

Pembatalan menghapus transaksi dari perhitungan aktif, menyimpan snapshot audit, dan mengembalikan cicilan/sisa tagihan dalam satu transaksi database. Konfirmasi ulang tidak menulis dua kali. Tombol Simpan Telegram lama tidak dapat membuat kembali transaksi yang dibatalkan. Transaksi pokok utang/piutang tidak dapat dibatalkan jika masih ada cicilan; batalkan cicilan terlebih dahulu. Telegram 3 dan seterusnya hanya bisa membatalkan pencatatan sendiri, tanpa mendapat saldo/tagihan anggota lain.

Migrasi menghubungkan pembayaran lama hanya jika pasangan nominal/dompet/waktu/pemiliknya unik. Data lama yang hubungannya tidak dapat dipastikan meminta pemeriksaan admin, bukan menebak. Ketiga pembayaran produksi saat rilis berhasil terhubung; nominal dan jumlah transaksi tidak diubah.

## Pemasangan manual
Jalankan migrasi `supabase/migrations/20261003022203_receipt_installments_cancellation.sql` setelah migrasi sebelumnya, lalu deploy seluruh file `supabase/functions/telegram-webhook/*.ts` dengan entrypoint index.ts. verify_jwt=false diperlukan untuk Telegram; fungsi mengautentikasi secret webhook, JWT web, dan HMAC cron secara terpisah. Unggah frontend dist ke kedua proyek Vercel. Jangan mengunggah backend, SQL, atau credential ke repositori frontend publik.

## Validasi rilis
Pengujian database lokal PostgreSQL/PGlite: pembayaran sebagian/penuh, pelunasan kembali partial, pembatalan pokok setelah cicilan, audit/idempotensi, privasi Telegram 3, tombol draft lama, owner isolation, anon, dan migrasi berulang. Pengujian API menggunakan SDK Supabase asli dengan HTTP Gemini/Telegram/database yang dimock. Pengujian browser Chromium memeriksa input kamera/unggah, kompresi JPEG, formulir hasil OCR, XSS, cicilan/riwayat/filter, konfirmasi pembatalan, dan layout HP. Pembacaan foto asli terhadap Gemini tidak diuji dengan akun produksi; tidak ada transaksi pengguna produksi dibatalkan untuk pengujian.
