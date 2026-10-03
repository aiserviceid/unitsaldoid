# Kalender, Asisten Web dan Rekap

Berlaku untuk UnitSaldo dan BIGBOS YUDI; masing-masing akun hanya melihat pembukuannya.

## Web
- Kalender: buka menu Kalender di sidebar, pintasan Beranda/Laporan, atau Lainnya di HP. Klik tanggal untuk transaksi, jatuh tempo tagihan, dan agenda. Tambah/Selesai/Hapus agenda tidak mengubah pembukuan. Tombol Bayar/Terima membuka formulir pembayaran tagihan.
- Asisten AI: chat pencatatan menampilkan pratinjau lalu tombol Periksa & Simpan untuk membuka formulir. Saldo berubah hanya setelah formulir dikonfirmasi.
- Rekap: pilih harian, mingguan (Senin–Minggu), bulanan, tahunan, atau rentang maksimal 366 hari. Semua batas tanggal memakai WIB. Angka dihitung server dari transaksi; Gemini memberi penjelasan terpisah. Saat kuota/API tidak tersedia, angka dan penjelasan otomatis tetap tersedia.
- Pendapatan berbeda dari pinjaman dan pembayaran piutang. Transfer tidak dihitung sebagai pendapatan/pengeluaran. Saldo dan tagihan adalah posisi pada akhir periode yang dipilih. Nilai per pencatat termasuk transfer, bukan pendapatan pencatat.
- Bot Telegram: Salin Kode menyalin kode saja; Salin /start menyalin perintah lengkap. Satu kode berlaku sekali.

## Telegram
- `Nuno pinjam saya tunai 500k`: piutang, uang keluar.
- `saya pinjam Nuno 500k tunai`: utang saya, uang masuk.
- `Nuno nyicil sejuta masuk tunai`: pembayaran piutang, uang masuk.
- `bayar utang Nuno 200rb tunai`: pembayaran utang, uang keluar.
- `rekap hari ini`, `rekap minggu ini`, `rekap bulan lalu`, `rekap tahunan`: ringkasan periode dengan angka dari database.
- Telegram 1/2 dapat melihat rekap; Telegram 3 hanya mencatat transaksi. Gemini tidak menerima ledger untuk parsing transaksi dan tidak dapat mengubah akses.
- Popup Contoh perintah dan tombol Salin membantu melengkapi kalimat. Selalu periksa arah uang dan nominal sebelum Simpan.

## Deploy
1. Terapkan `supabase/migrations/20261003015617_integrated_calendar.sql`.
2. Deploy `telegram-webhook` dengan index.ts, core.ts, finance.ts; verify_jwt tetap false karena autentikasi webhook, JWT web/admin, dan HMAC cron ditangani di server.
3. Publikasikan dist/index.html dan dist/enhancements.js bersama file frontend yang sudah ada. Kedua domain memakai backend yang sama.
4. Rahasia tetap di konfigurasi super admin/Vault, tidak di frontend.

Agenda pribadi tidak mengirim notifikasi Telegram; pengingat tagihan Telegram yang sudah ada tetap berjalan. Chat tidak menyimpan percakapan setelah halaman dimuat ulang. Koreksi typo dibatasi agar nominal/nama/dompet tidak dibuat-buat. Gemini mengikuti kuota provider dan batas per akun yang sudah ada.
