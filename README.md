# X'Nest

Website sosial dengan backend Node.js. Database bisa Supabase (REST), PostgreSQL langsung, atau file JSON.

## Setup dengan Supabase

1. Supabase Dashboard > SQL Editor: jalankan isi `schema.sql`.
2. Salin `.env.example` jadi `.env`, lalu isi `SUPABASE_SECRET_KEY` dengan Secret key (`sb_secret_...`) dari Settings > API Keys. Kunci ini hanya untuk server: jangan dibagikan, jangan di-commit, jangan dipakai di browser.
3. `npm start`, lalu buka http://localhost:3000 (di Codespaces: buka port 3000 dari tab Ports). Tidak perlu `npm install`.

Kunci publishable tidak dipakai. Semua tabel dikunci dengan RLS supaya data pengguna (email, hash sandi) tidak bisa dibaca lewat API publik.

## Mode lain

- `DATABASE_URL=postgresql://...` (butuh `npm install`): tabel dibuat otomatis, memakai koneksi Postgres langsung.
- Tanpa keduanya: data disimpan di `data/db.json`.

## Akun developer

Dibuat otomatis saat server pertama kali jalan: username `devweb` atau email websitescarlett@gmail.com. Sandinya tampil di terminal, atau tentukan sendiri: `DEV_PASSWORD=sandimu npm start`. Ganti sandi di Pengaturan. Akun ini otomatis bercentang biru, bergelar Dev Web, dan punya Menu dev.

## Upload

Foto dan video disimpan di `data/uploads/` tanpa batas ukuran dari aplikasi. Batasnya hanya disk dan hosting/proxy yang dipakai, jadi pakai disk persisten. Server berjalan sebagai satu proses (data dimuat ke memori, setiap perubahan langsung ditulis ke database).
