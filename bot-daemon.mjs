// =========================================================================
// UNITSALDO PRO - TELEGRAM BOT POLLER DAEMON (100% NATIVE NODE.JS)
// =========================================================================

import fs from "node:fs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Isi TELEGRAM_BOT_TOKEN, SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di environment server.');
}
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
let GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

async function loadConfig() {
  try {
    const cfg = await db.rpc("bot_config_read");
    if (cfg.ok && cfg.data) {
      if (cfg.data.GEMINI_API_KEY) GEMINI_API_KEY = cfg.data.GEMINI_API_KEY;
      if (cfg.data.GEMINI_MODEL) GEMINI_MODEL = cfg.data.GEMINI_MODEL;
    }
  } catch (_) {}
}
const headers = {apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,"Content-Type":"application/json"};

// Sesi Lokal untuk Kecepatan & Ketahanan RLS
const SESSION_FILE = "./telegram_sessions.json";
let sessions = {};
try {
  if (fs.existsSync(SESSION_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  }
} catch (_) {}

function saveSessions() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2), "utf8");
  } catch (_) {}
}

// Supabase REST & RPC Helper
const db = {
  async select(table, query = "") {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) return [];
      return await res.json();
    } catch (_) {
      return [];
    }
  },
  async insert(table, data) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(data),
      });
      return { ok: res.ok, status: res.status, data: await res.json() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  async upsert(table, data, onConflict = "") {
    try {
      const query = onConflict ? `?on_conflict=${onConflict}` : "";
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(data),
      });
      return { ok: res.ok, data: await res.json() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  async rpc(funcName, params = {}) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcName}`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      return { ok: res.ok, status: res.status, data: await res.json() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
};

function formatIDR(amount) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function parseNominal(str) {
  let clean = str.toLowerCase().replace(/rp\s*/g, "").replace(/\./g, "").trim();
  let multiplier = 1;

  if (clean.includes("jt") || clean.includes("juta")) {
    multiplier = 1_000_000;
    clean = clean.replace(/(jt|juta)/g, "").trim();
  } else if (clean.includes("rb") || clean.includes("ribu") || clean.includes("k")) {
    multiplier = 1_000;
    clean = clean.replace(/(rb|ribu|k)/g, "").trim();
  }

  clean = clean.replace(/,/g, ".");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.round(num * multiplier);
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown",
        ...extra,
      }),
    });
  } catch (err) {
    console.error("Gagal kirim pesan telegram:", err.message);
  }
}

async function answerCallbackQuery(callbackQueryId, extra = {}) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...extra })
    });
  } catch (err) {
    console.error("Gagal answerCallbackQuery:", err.message);
  }
}

async function extractReceiptFromImage(base64, mimeType = "image/jpeg") {
  if (!GEMINI_API_KEY) return null;
  const schema = {
    type: "OBJECT",
    properties: {
      merchant: { type: "STRING" },
      total: { type: "NUMBER" },
      receipt_date: { type: "STRING" },
      confidence: { type: "STRING", enum: ["clear", "unclear"] },
      items: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, total: { type: "NUMBER" } }, required: ["name", "total"] } }
    },
    required: ["merchant", "total", "receipt_date", "confidence", "items"]
  };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Ekstrak struk belanja Indonesia. Ambil TOTAL AKHIR setelah diskon/pajak. Jika tidak jelas confidence unclear total 0." }] },
        contents: [{ role: "user", parts: [{ text: "Ekstrak struk ini." }, { inlineData: { mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 1500 }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "null");
  } catch (_) {
    return null;
  }
}

// Pending receipt drafts for wallet selection
const pendingReceipts = new Map();

async function handleMessage(msg) {
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const username = msg.from?.username || "";
  const firstName = msg.from?.first_name || "Pengguna";

  // Tangani foto struk
  const photos = msg.photo;
  const doc = msg.document;
  const isImageDoc = doc && typeof doc.mime_type === "string" && /^image\/(jpeg|png|webp)$/i.test(doc.mime_type);
  if ((Array.isArray(photos) && photos.length > 0) || isImageDoc) {
    let linkData = null;
    const linkRpc = await db.rpc("bot_get_link", { p_chat_id: chatId });
    if (linkRpc.ok && linkRpc.data?.linked) linkData = linkRpc.data;
    if (!linkData || !linkData.owner_id) {
      await sendTelegramMessage(chatId, "⚠️ *Akun Belum Terhubung*\n\nHubungkan bot terlebih dahulu di web UnitSaldo.");
      return;
    }
    const photoItem = isImageDoc ? doc : photos[photos.length - 1];
    try {
      const fRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photoItem.file_id}`);
      const fData = await fRes.json();
      if (!fData.ok || !fData.result?.file_path) {
        await sendTelegramMessage(chatId, "⚠️ Gagal mengambil file foto.");
        return;
      }
      const dlRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fData.result.file_path}`);
      const buf = await dlRes.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < uint8.byteLength; i += 8192) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, Math.min(i + 8192, uint8.byteLength)));
      }
      const base64 = btoa(binary);
      const r = await extractReceiptFromImage(base64);
      if (!r || r.confidence !== "clear" || !r.total || r.total <= 0) {
        await sendTelegramMessage(chatId, "🧾 *Total struk belum terbaca jelas.*\nFoto ulang lebih dekat dan terang, atau ketik nominal manual.", {
          reply_markup: {
            inline_keyboard: [[{ text: "💡 Tips Foto Struk", callback_data: "popup:photo_help" }]]
          }
        });
        return;
      }
      const caption = (msg.caption || "").toLowerCase();
      const wallets = await db.select("wallets", `owner_id=eq.${linkData.owner_id}&select=id,name,is_active`);
      const activeWallets = wallets.filter(w => w.is_active !== false);
      const matchedWallet = activeWallets.find(w => caption.includes(w.name.toLowerCase())) || (activeWallets.length === 1 ? activeWallets[0] : null);

      if (matchedWallet) {
        const desc = `Struk ${r.merchant || "Belanja"} (via ${firstName})`;
        const rpcTx = await db.rpc("bot_record_transaction", {
          p_chat_id: chatId,
          p_kind: "expense",
          p_amount: r.total,
          p_description: desc,
          p_wallet_name: matchedWallet.name
        });
        if (rpcTx.ok && rpcTx.data?.success) {
          await sendTelegramMessage(chatId, `✅ *STRUK BERHASIL DICATAT OLEH AI!*\n\n💸 *Pengeluaran:* *${formatIDR(r.total)}*\n🏢 *Merchant:* ${r.merchant || "Toko"}\n💳 *Dompet:* ${matchedWallet.name}\n👤 *Pencatat:* ${firstName}`);
          return;
        }
      }

      // Jika dompet belum dipilih, berikan pilihan popup
      const draftKey = String(Date.now());
      pendingReceipts.set(draftKey, { total: r.total, merchant: r.merchant || "Belanja", firstName });
      const buttons = [];
      for (let i = 0; i < activeWallets.length; i += 2) {
        buttons.push(activeWallets.slice(i, i + 2).map(w => ({
          text: "👛 " + w.name,
          callback_data: `pick_w:${draftKey}:${w.name}`
        })));
      }
      buttons.push([{ text: "💡 Tips Struk", callback_data: "popup:photo_help" }]);
      await sendTelegramMessage(chatId, `🧾 *Struk Terbaca oleh AI!*\n\n🏢 *Merchant:* ${r.merchant || "Struk"}\n💵 *Total:* *${formatIDR(r.total)}*\n\n⚠️ *Perintah kurang lengkap: Silakan pilih dompet:* `, {
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    } catch (err) {
      await sendTelegramMessage(chatId, "⚠️ Gagal membaca foto struk.");
      return;
    }
  }

  if (!msg.text) return;

  const text = msg.text.trim();



  // 1. COMMAND /start KODE
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const code = parts[1]?.trim()?.toUpperCase();

    if (code) {
      // 1. Coba via RPC link_telegram_by_code
      const rpcRes = await db.rpc("link_telegram_by_code", {
        p_link_code: code,
        p_chat_id: chatId,
        p_username: username,
        p_first_name: firstName
      });

      if (rpcRes.ok && rpcRes.data?.success) {
        const ownerId = rpcRes.data.owner_id || rpcRes.data.user_id;
        sessions[chatId] = {
          owner_id: ownerId,
          email: rpcRes.data.email,
          first_name: firstName,
          username: username
        };
        saveSessions();

        await sendTelegramMessage(
          chatId,
          `🎉 *Koneksi Berhasil 100%!*

Selamat datang, *${firstName}*!
Nomor Telegram Anda resmi terhubung ke UnitSaldo Pro:
📧 \`${rpcRes.data.email || "Akun Terdaftar"}\`

💡 *Multi-Device/Multi-HP Aktif:*
Nomor HP lain (misal Suami, Istri, atau Kasir) juga dapat dihubungkan ke akun yang sama menggunakan kode tautan baru dari web.

⚡ *Cara Mencatat Transaksi Instan:*
• Kirim pengeluaran: \`makan siang 25rb bca\`
• Kirim pemasukan: \`gaji 5jt mandiri\`
• Cek saldo: \`/saldo\`

Seluruh mutasi otomatis tersimpan ke dashboard web Anda dengan tag nama *${firstName}*!`
        );
        return;
      }

      await sendTelegramMessage(chatId, 'Kode tautan tidak valid atau sudah digunakan. Buat kode baru melalui menu Bot Telegram di web.');
      return;
    }

    await sendTelegramMessage(
      chatId,
      `👋 *Halo dari Bot UnitSaldo Pro (@unitsaldobot)!*

Untuk menghubungkan bot ini ke akun web UnitSaldo Anda:
1. Buka Web UnitSaldo di browser Anda: [http://localhost:5173/](http://localhost:5173/)
2. Buka menu **Bot Telegram** di sidebar.
3. Klik tombol **"Buat Kode Tautan"**.
4. Klik tombol tautan yang muncul atau kirimkan perintah:
   \`/start KODE-ANDA\` ke chat ini.`
    );
    return;
  }

  // 2. CEK APAKAH TELEGRAM SUDAH TERHUBUNG (Prioritas: RPC -> Cache -> REST)
  let linkData = null;
  const linkRpc = await db.rpc("bot_get_link", { p_chat_id: chatId });
  if (linkRpc.ok && linkRpc.data?.linked) {
    linkData = linkRpc.data;
    sessions[chatId] = linkData;
    saveSessions();
  } else {
    delete sessions[chatId];
    saveSessions();
  }


  if (!linkData || !linkData.owner_id) {
    await sendTelegramMessage(
      chatId,
      `⚠️ *Akun Belum Terhubung*

Silakan hubungkan akun Anda terlebih dahulu melalui menu **Bot Telegram** di Web UnitSaldo ([http://localhost:5173/](http://localhost:5173/)).`
    );
    return;
  }

  const ownerId = linkData.owner_id;

  // 3. COMMAND /saldo
  if (text.toLowerCase() === "/saldo" || text.toLowerCase().includes("cek saldo")) {
    const [wallets, txs] = await Promise.all([
      db.select("wallets", `owner_id=eq.${ownerId}&select=id,name,kind,is_active`),
      db.select("transactions", `owner_id=eq.${ownerId}&select=amount,kind,wallet_id,destination_wallet_id`)
    ]);

    const activeWallets = wallets.filter(w => w.is_active !== false);
    let totalSaldo = 0;
    let lines = [];

    activeWallets.forEach((w) => {
      const bal = txs.reduce((sum, t) => {
        let delta = 0;
        if (t.wallet_id === w.id) {
          if (["income", "debt_disbursement", "receivable_payment"].includes(t.kind)) delta = +t.amount;
          else if (t.kind === "transfer") delta = -t.amount;
          else delta = -t.amount;
        } else if (t.destination_wallet_id === w.id && t.kind === "transfer") {
          delta = +t.amount;
        }
        return sum + delta;
      }, 0);
      totalSaldo += bal;
      lines.push(`💳 *${w.name}*: ${formatIDR(bal)}`);
    });

    await sendTelegramMessage(
      chatId,
      `📊 *RINGKASAN SALDO UNITSALDO PRO*

${lines.join("\n") || "Belum ada dompet terdaftar."}

💰 *Total Saldo Kas/Bank:* *${formatIDR(totalSaldo)}*`
    );
    return;
  }

  // 4. PARSER TRANSAKSI CHAT NATURAL
  const lower = text.toLowerCase();
  if (/\b(transfer|utang|hutang|piutang)\b/.test(lower)) {
    await sendTelegramMessage(chatId, 'Untuk transfer dan utang/piutang, gunakan menu web agar dompet serta tagihan tercatat dengan benar. Bot ini menerima pemasukan/pengeluaran dan cek saldo.');
    return;
  }
  const numMatch = lower.match(/(?:rp\s*)?(\d+(?:[.,]\d+)?\s*(?:jt|juta|rb|ribu|k)?)/i);

  if (!numMatch) {
    await sendTelegramMessage(
      chatId,
      `❓ Format pesan belum memuat nominal transaksi.

*Contoh Pencatatan Cepat:*
• \`Makan bakso 25rb bca\`
• \`Bensin motor 20000 tunai\`
• \`Gaji bulanan 5jt mandiri\`
• Ketik \`/saldo\` untuk melihat total saldo dompet Anda.`
    );
    return;
  }

  const amount = parseNominal(numMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return;

  const [wallets, categories] = await Promise.all([
    db.select("wallets", `owner_id=eq.${ownerId}&select=id,name`),
    db.select("categories", `owner_id=eq.${ownerId}&select=id,name`)
  ]);

  const isIncome = ["gaji", "penjualan", "pendapatan", "pemasukan", "bonus", "omzet", "transferan", "dapat", "terima"].some((w) => lower.includes(w));
  const matchedWallet = wallets.find((w) => lower.includes(w.name.toLowerCase())) || wallets[0] || null;
  const matchedWalletName = matchedWallet ? matchedWallet.name : (lower.includes("tunai") ? "Tunai" : "");

  let rawDesc = text.replace(new RegExp(numMatch[0], "i"), "").trim();
  if (matchedWallet) {
    rawDesc = rawDesc.replace(new RegExp(matchedWallet.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim();
  }
  if (!rawDesc) rawDesc = isIncome ? "Pemasukan via Telegram" : "Pengeluaran via Telegram";
  
  // Tag nama penginput (contoh: Makan siang (via Hendra))
  const senderTag = firstName ? ` (via ${firstName})` : "";
  const desc = `${rawDesc}${senderTag}`;
  const matchedCat = categories.find((c) => lower.includes(c.name.toLowerCase())) || null;

  // 1. Coba catat via RPC bot_record_transaction (Aman & Bypass RLS)
  const rpcTx = await db.rpc("bot_record_transaction", {
    p_chat_id: chatId,
    p_kind: isIncome ? "income" : "expense",
    p_amount: amount,
    p_description: desc,
    p_wallet_name: matchedWalletName
  });

  if (rpcTx.ok && rpcTx.data?.success) {
    await sendTelegramMessage(
      chatId,
      `✅ *TRANSAKSI BERHASIL DICATAT!*

${isIncome ? "💰 *Pemasukan:*" : "💸 *Pengeluaran:*"} *${formatIDR(amount)}*
📝 *Keterangan:* ${desc}
💳 *Dompet:* ${rpcTx.data.wallet_name || matchedWalletName || "Kas Tunai"}
📂 *Kategori:* ${matchedCat ? matchedCat.name : "Umum"}
👤 *Pencatat:* ${firstName} (@${username || "telegram"})`
    );
    return;
  }

  await sendTelegramMessage(chatId, `❌ Gagal menyimpan transaksi. Silakan jalankan skrip perbaikan database di Supabase.`);
}

// Long Polling Loop
async function handleCallback(callback) {
  const chatId = String(callback.message?.chat?.id);
  const data = String(callback.data || "");

  if (data === "popup:photo_help") {
    await answerCallbackQuery(callback.id, {
      show_alert: true,
      text: "📸 Tips Foto Struk:\n1. Pastikan foto terang & tegak lurus\n2. Angka TOTAL AKHIR terlihat jelas\n3. Tidak terpotong & tidak buram\n4. Bisa tulis nama dompet di caption (misal: 'BCA')"
    });
    return;
  }
  if (data === "popup:incomplete_help") {
    await answerCallbackQuery(callback.id, {
      show_alert: true,
      text: "💡 Perintah Kurang Lengkap:\nSebutkan nominal dan dompet, contoh:\n• Makan 25rb Tunai\n• Beli bensin 50rb BCA\nAtau langsung kirim foto struk belanja Anda!"
    });
    return;
  }

  const pick = data.match(/^pick_w:([^:]+):(.+)$/);
  if (pick) {
    const [_, draftKey, walletName] = pick;
    const item = pendingReceipts.get(draftKey);
    if (!item) {
      await answerCallbackQuery(callback.id, { show_alert: true, text: "Struk sudah diproses atau kedaluwarsa." });
      return;
    }
    pendingReceipts.delete(draftKey);
    const desc = `Struk ${item.merchant} (via ${item.firstName})`;
    const rpcTx = await db.rpc("bot_record_transaction", {
      p_chat_id: chatId,
      p_kind: "expense",
      p_amount: item.total,
      p_description: desc,
      p_wallet_name: walletName
    });
    if (rpcTx.ok && rpcTx.data?.success) {
      await answerCallbackQuery(callback.id, { text: "Dompet " + walletName + " dipilih!" });
      await sendTelegramMessage(chatId, `✅ *STRUK BERHASIL DICATAT OLEH AI!*\n\n💸 *Pengeluaran:* *${formatIDR(item.total)}*\n🏢 *Merchant:* ${item.merchant}\n💳 *Dompet:* ${walletName}\n👤 *Pencatat:* ${item.firstName}`);
      return;
    }
    await answerCallbackQuery(callback.id, { show_alert: true, text: "Gagal menyimpan transaksi." });
    return;
  }

  await answerCallbackQuery(callback.id, { text: "Memproses..." });
}

async function startPoller() {
  await loadConfig();
  console.log("=========================================");
  console.log("🤖 UnitSaldo Telegram Bot Daemon Aktif!");
  console.log("   Bot Username: @unitsaldobot");
  console.log("=========================================");

  // Hapus webhook aktif agar long-polling berjalan lancar
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
  } catch (_) {}

  let offset = 0;

  while (true) {
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=20`;
      const res = await fetch(url);
      if (!res.ok) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.callback_query) {
            await handleCallback(update.callback_query);
          } else if (update.message) {
            await handleMessage(update.message);
          }
        }
      }
    } catch (err) {
      console.error("Poller error:", err.message);
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

startPoller();
