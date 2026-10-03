import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.dirname(__filename);

// Baca file .env lokal jika ada
const envPath = path.join(root, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      env[key] = val;
    }
  }
}

console.log('=== PEMERIKSAAN KESIAPAN DEPLOY ARUSKASKU / UNITSALDO ===\n');

const projectRef = env.SUPABASE_PROJECT_REF || 'azpxkvwdmuoakipldtwa';
const supabaseToken = env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
const vercelToken = env.VERCEL_TOKEN || process.env.VERCEL_TOKEN;

let deployedSupabase = false;
let deployedVercel = false;

// 1. Deploy Supabase Edge Function
if (supabaseToken) {
  console.log(`[1/2] Menjalankan deploy Edge Function 'telegram-webhook' ke project ${projectRef}...`);
  try {
    const envVars = { ...process.env, SUPABASE_ACCESS_TOKEN: supabaseToken };
    execSync(`npx supabase functions deploy telegram-webhook --project-ref ${projectRef} --no-verify-jwt`, {
      cwd: root,
      env: envVars,
      stdio: 'inherit'
    });
    console.log('✅ Supabase Edge Function berhasil dipublikasikan!\n');
    deployedSupabase = true;
  } catch (err) {
    console.error('❌ Gagal deploy Supabase Edge Function:', err.message);
  }
} else {
  console.log('ℹ️  [1/2] SUPABASE_ACCESS_TOKEN belum diisi di file .env.');
  console.log('    Untuk deploy otomatis tanpa login global, buat token di: https://supabase.com/dashboard/account/tokens\n');
}

// 2. Deploy Frontend Vercel
if (vercelToken) {
  console.log(`[2/2] Menjalankan deploy frontend folder 'dist' ke Vercel...`);
  try {
    const envVars = { ...process.env, VERCEL_TOKEN: vercelToken };
    execSync(`npx vercel deploy --prod --yes`, {
      cwd: path.join(root, 'dist'),
      env: envVars,
      stdio: 'inherit'
    });
    console.log('✅ Frontend Vercel berhasil dipublikasikan!\n');
    deployedVercel = true;
  } catch (err) {
    console.error('❌ Gagal deploy Vercel:', err.message);
  }
} else {
  console.log('ℹ️  [2/2] VERCEL_TOKEN belum diisi di file .env.');
  console.log('    Untuk deploy otomatis tanpa login global, buat token di: https://vercel.com/account/tokens\n');
}

if (!deployedSupabase && !deployedVercel) {
  console.log('------------------------------------------------------------');
  console.log('PILIHAN PUBLIKASI:');
  console.log('1. Masukkan token lokal di file .env:');
  console.log('   SUPABASE_ACCESS_TOKEN=sbp_xxx');
  console.log('   VERCEL_TOKEN=xxx');
  console.log('   Lalu jalankan: node deploy.mjs');
  console.log('');
  console.log('2. Atau salin manual:');
  console.log('   - Edge function: Salin supabase/functions/telegram-webhook/index.ts ke Supabase Dashboard');
  console.log('   - Frontend: Unggah isi folder dist/ ke hosting Vercel');
  console.log('------------------------------------------------------------');
}
