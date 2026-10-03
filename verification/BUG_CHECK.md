# Pemeriksaan bug — 3 Oktober 2026 WIB

Perbaikan: tema emas saat hover dan latar login; identitas nomor HP pada permintaan perpanjangan; nama merek pada ekspor CSV; pesan kegagalan hapus/nonaktifkan kategori tanpa mengosongkan data tampilan; tanggal transaksi terbaru, tahun filter, dan header memakai WIB.

Validasi: auth.mjs, reporting.mjs, database.mjs, telegram.mjs, web.mjs lulus. Skenario browser baru mencakup login BIGBOS pada lebar 320px, hover emas, CSV merek, identitas HP, kegagalan kategori dan tanggal WIB lintas zona waktu. Backend database dan Telegram diuji memakai fixture, bukan transaksi asli akun Yudi.

Kedua website publik memberi HTTP 200 saat baseline dan isinya cocok dengan versi sumber sebelum perbaikan. Tidak memakai kredensial pengguna atau mengubah pembukuan produksi. Browser langsung ke alamat publik mengalami kendala jaringan; alur akun masuk diverifikasi melalui fixture lokal.
