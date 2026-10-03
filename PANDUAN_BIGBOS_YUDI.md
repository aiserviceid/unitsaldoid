# BIGBOS YUDI — akun nomor HP dan tema khusus

Akun 085382000666 telah dibuat melalui Supabase Auth Admin dengan identitas phone asli, tanpa email sintetis. Akun ditandai is_special=true, brand_name=BIGBOS YUDI, brand_theme=bigbos-gold. Status awal pending dan is_admin=false.

## Menyiapkan login

1. Supabase → Authentication → Sign In / Providers → Phone → Enable Phone Provider → Save. Phone login masih nonaktif saat implementasi ini. Akun Yudi sudah dikonfirmasi secara manual oleh pemilik melalui API Admin, sehingga akun ini tidak memerlukan SMS konfirmasi saat login.
2. Pemilik masuk dengan email terverifikasi ai.interiorid@gmail.com ke UnitSaldo → Pengaturan → Super Admin.
3. Temukan BIGBOS YUDI / 6285382000666 dengan tanda Pengguna Khusus.
4. Klik Atur Kata Sandi HP, isi minimal 12 karakter. Bagikan kata sandi kepada Yudi secara pribadi. Kata sandi tidak dikirim oleh asisten dan tidak disimpan dalam kode.
5. Klik Verifikasi & Aktifkan (14 hari), atau +30 Hr / +1 Thn sesuai lisensi yang disetujui.
6. Yudi login memakai 085382000666 dan kata sandi tersebut. Tema hitam–emas dan logo BIGBOS YUDI muncul berdasarkan identitas akun setelah login.

Kata sandi awal dibuat acak oleh server dan tidak ditampilkan atau dibagikan. Pemilik harus menetapkan kata sandi melalui panel sebelum Yudi login. Proses provisioning satu kali sudah ditutup; endpoint provision-bigbos kini hanya merespons 410 dan memerlukan JWT.

Logo yang disertakan adalah versi SVG untuk web; jika tersedia berkas logo merek resmi terpisah, aset dapat diganti dengan logo tersebut.

## Domain sendiri

Domain atau subdomain dapat ditambahkan ke proyek Vercel yang sama. Tidak perlu memindahkan database.

1. Tentukan domain yang sudah dimiliki.
2. Vercel → proyek unitsaldoid → Settings → Domains → Add Domain.
3. Ikuti nilai DNS yang diberikan Vercel di registrar domain. Jangan menebak atau menyalin alamat DNS dari contoh lama.
4. Tambahkan domain tersebut pada daftar URL redirect Supabase bila memakai alur autentikasi yang mengarahkan kembali ke domain.
5. Untuk menampilkan merek BIGBOS YUDI sejak halaman sebelum login, domain perlu dipetakan ke konfigurasi merek. Pemetaan ini belum dibuat karena nama domain belum diberikan.

Domain adalah tampilan merek, bukan izin akses data. Data tetap dibatasi berdasarkan identitas akun dan RLS. Pemilik tetap mengelola akun dari Super Admin UnitSaldo. Belum ada domain baru yang ditambahkan atau dibeli.

## Kode

Terapkan AKUN_HP_BRANDING.sql setelah LAPORAN_RIWAYAT_PENGINGAT.sql. Deploy telegram-webhook/index.ts bersama core.ts. Frontend membutuhkan bigbos-yudi-logo.svg serta index.html terbaru. Kolom branding hanya dapat diubah oleh pengelola server; klien tidak memiliki hak UPDATE untuk is_special/brand_name/brand_theme/phone_number.
