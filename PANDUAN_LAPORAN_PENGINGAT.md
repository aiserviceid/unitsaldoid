# Laporan, riwayat, dan pengingat UnitSaldo

## Laporan

Pilih bulan melalui pemilih periode di bagian atas, lalu buka Laporan. Pilih dompet dan pencatat bila diperlukan.

- Pendapatan hanya transaksi pemasukan biasa. Pinjaman dan pelunasan piutang masuk pada arus kas, bukan pendapatan.
- Belanja rutin hanya transaksi pengeluaran biasa. Cicilan utang dan pemberian piutang dipisahkan.
- Persentase sisa pendapatan = (pendapatan − belanja rutin) / pendapatan. Angka bisa negatif. Tanpa pendapatan ditampilkan tidak tersedia. Ini surplus, bukan bukti dana telah ditabung.
- Saldo awal dan akhir mencakup seluruh pencatat pada dompet terpilih. Filter pencatat menyaring aktivitas, sehingga ketika filter ini aktif, saldo akhir tidak harus sama dengan saldo awal ditambah arus kas aktivitas terfilter.
- Transfer antar-dompet tidak masuk arus kas seluruh keluarga. Pada laporan satu dompet, transfer masuk/keluar memengaruhi arus kas dompet tersebut.
- Dompet nonaktif tetap tersedia untuk laporan historis.
- Tagihan menampilkan posisi seluruh keluarga, tidak mengikuti filter dompet/pencatat. Pembayaran ditelusuri berdasarkan paid_at; pembayaran lama yang tidak memiliki tanggal tidak dapat direkonstruksi akurat untuk periode lampau.
- Semua batas periode menggunakan WIB. Data dibaca bertahap agar batas 1.000 baris API tidak memotong laporan transaksi secara diam-diam.

### Ekspor

Unduh CSV (Excel) menghasilkan berkas CSV UTF-8 dengan pemisah titik koma, ringkasan, perbandingan bulan, kategori, tagihan, dan transaksi sesuai filter. Dapat dibuka di Excel. Jika kolom tidak otomatis terpisah, gunakan menu impor teks/CSV dengan pemisah titik koma. Nilai teks yang bisa menjadi formula spreadsheet dinetralkan.

PDF / Cetak membuka dialog cetak perangkat. Pilih Simpan sebagai PDF. Tata letak cetak hanya memuat laporan, tanpa navigasi aplikasi.

## Transaksi dan riwayat

Cari berdasarkan keterangan, nominal, dompet, kategori, jenis, atau pencatat. Pencarian digabung dengan filter bulan dan tahun.

Ubah tersedia untuk pemasukan biasa, pengeluaran biasa, dan transfer. Mutasi yang terhubung utang/piutang tetap ditangani melalui menu tagihan.

Riwayat mencatat pencatatan, perubahan, dan penghapusan, termasuk nama pelaku dan nilai sebelum/sesudah. Riwayat tetap ada setelah transaksi dihapus. Riwayat dimulai sejak fitur diaktifkan; perubahan lama tidak dikarang. Menu menampilkan 100 perubahan terbaru, dan tombol Riwayat pada transaksi menampilkan riwayat transaksi tersebut. Klien tidak dapat mengubah/hapus catatan audit melalui API.

## Pengingat Telegram

Pengingat aktif secara bawaan dan dapat dimatikan di Pengaturan → Pengingat tagihan Telegram.

Pengingat mulai dikirim pukul 08.00 WIB ke nomor Telegram posisi 1 dan 2 yang masih terhubung pada akun aktif. Nomor 3 dan seterusnya tidak menerima rincian keuangan.

- Tiga hari sebelum jatuh tempo.
- Pada hari jatuh tempo.
- Satu hari sesudah jatuh tempo, lalu setiap tujuh hari jika belum lunas.

Setiap Telegram mendapat maksimal satu pesan ringkasan per hari. Tagihan lunas diabaikan. Sistem memeriksa ulang izin anggota dan saldo tagihan sebelum mengirim. Jika respons Telegram tidak pasti/timeout, pesan tidak otomatis dikirim ulang agar tidak menggandakan pengingat. Pengguna tetap dapat mengecek tagihan di web.

Cron memproses kelompok kecil sepanjang 08.00–08.59 WIB. Antrean HTTP memakai autentikasi HMAC khusus pengingat yang berubah tiap hari; token bot dan secret webhook tidak dimasukkan ke perintah cron atau antrean HTTP.

## Instalasi mandiri

Terapkan SQL secara berurutan sampai AKTIVASI_AKUN.sql, lalu LAPORAN_RIWAYAT_PENGINGAT.sql, deploy telegram-webhook (index.ts dan core.ts), kemudian JADWAL_PENGINGAT.sql. Frontend memerlukan dist/index.html dan dist/reporting.js beserta aset yang sudah ada. Jangan menerbitkan SQL/backend sebagai aset publik.

Pengujian meliputi perhitungan keuangan, batas WIB, transfer, filter, saldo/tagihan historis, CSV aman, ekspor PDF, tampilan HP, audit tidak dapat dimanipulasi klien, isolasi pemilik, aktivasi, dan privasi pengingat. Pengiriman Telegram diuji dengan layanan simulasi; pemeriksaan Supabase langsung menggunakan transaksi rollback dan pemeriksaan endpoint terjadwal di luar jam kirim.
