# Edit Telegram keluarga

Web → Lainnya/Pengaturan → Bot Telegram → Edit pada akun yang ingin diubah.

- Nama panggilan: 1–80 karakter; hanya label web, nama pencatat lama tetap asli.
- Posisi: Telegram 1/2 akses penuh, Telegram 3 transaksi saja. Perubahan posisi memerlukan konfirmasi. Jika tujuan sudah terisi, kedua posisi ditukar secara atomik.
- Identitas Telegram asli/Chat ID tidak diubah lewat formulir. Untuk mengganti akun: Putuskan → buat kode baru → hubungkan dari akun Telegram baru → pilih posisi melalui Edit.
- Koneksi nonaktif tetap mempertahankan posisi sampai pemilik melakukan perubahan secara eksplisit; tidak ada promosi otomatis Telegram 3.

Database: jalankan TELEGRAM_EDIT.sql setelah PRIVASI_TELEGRAM.sql. Ini menambah display_name, indeks posisi unik per keluarga, dan RPC edit_telegram_member yang berjalan sebagai pemanggil dan mengikuti RLS. Migrasi produksi sudah diterapkan. Backend bot tetap mengambil hak akses dari posisi tersimpan dan nama pencatat dari identitas asli Telegram.
