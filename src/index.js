/**
 * YENİCESPOR FİNANS — Cloudflare Worker
 * Telegram bot → ys_drafts (onay kuyruğu)
 * WhatsApp webhook → ys_drafts
 */

const SB_URL = "https://vkyqbjddiayxpfeeqkjz.supabase.co";
const TABLES = { TX: "ys_transactions", CARIS: "ys_caris", LOGS: "ys_wa_logs", DRAFTS: "ys_drafts" };

const GELIR_KW = /tahsilat|tahsil|gelir|aldık|alındı|ödedi|gönderdi|yatırdı|aidat|katkı|sponsor|bağış/i;
const GIDER_KW = /ödeme|ödendi|gider|verdik|öd[eü]|gönder|masraf|harcama|maaş|ücret/i;
const BANKA_KW = /\bbanka\b|\bhavale\b|\beft\b|\bfast\b|\btransfer\b/i;
const TUTAR_RE = /\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)\s*(?:tl|₺|lira)?(?:\b|$)/gi;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/whatsapp") {
      if (request.method === "GET") return handleVerify(request, env);
      if (request.method === "POST") return handleWebhook(request, env);
    }
    if (url.pathname === "/telegram") {
      if (request.method === "POST") return handleTelegram(request, env);
      return new Response("OK");
    }
    if (url.pathname === "/telegram/set") return registerTelegramWebhook(request, env);
    return env.ASSETS.fetch(request);
  }
};

// ─── WhatsApp Doğrulama ───────────────────────────────────────────────────────
function handleVerify(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === (env.WA_VERIFY_TOKEN || "yenicespor_webhook_2026")) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// ─── WhatsApp Webhook ─────────────────────────────────────────────────────────
async function handleWebhook(request, env) {
  let body;
  try { body = await request.json(); } catch { return new Response("Bad Request", { status: 400 }); }
  if (body?.object !== "whatsapp_business_account") return new Response("OK");
  const sbKey = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;
  const promises = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of (change.value?.messages || [])) {
        promises.push(processWAMessage(msg, change.value, env, sbKey));
      }
    }
  }
  await Promise.allSettled(promises);
  return new Response("OK");
}

async function processWAMessage(msg, val, env, sbKey) {
  if (msg.type !== "text" || !msg.text?.body?.trim()) return;
  const metin = msg.text.body.trim();
  const tarih = new Date(Number(msg.timestamp) * 1000).toISOString().slice(0, 10);
  const fromNum = msg.from;
  const gonderenAd = val.contacts?.[0]?.profile?.name || fromNum;
  const msgId = msg.id;

  const dup = await sbGet(sbKey, TABLES.LOGS, `msg_id=eq.${msgId}&select=id`);
  if (dup?.length > 0) return;

  const parsed = parseMessage(metin);
  if (!parsed) {
    await logEntry(sbKey, { msg_id: msgId, gonderen: fromNum, gonderen_ad: gonderenAd, metin, durum: "parse_hatası", hata: "Format anlaşılamadı", tarih });
    return;
  }

  const { cariAd, tutar, tur, kasa } = parsed;
  const { cariId, cariAdFinal, yeniCari } = await fuzzyBulCari(sbKey, cariAd, tur);

  const draft = buildDraft({ cariId, cariAdFinal, tutar, tur, kasa, aciklama: metin, tarih, kaynak: "whatsapp" });
  let hata = null;
  try { await sbPost(sbKey, TABLES.DRAFTS, draft); } catch(e) { hata = e.message; }

  await logEntry(sbKey, { msg_id: msgId, gonderen: fromNum, gonderen_ad: gonderenAd, metin, durum: hata ? "hata" : "draft_olusturuldu", hata, cari_id: cariId, cari_ad: cariAdFinal, tutar, islem_tipi: tur, kasa, tx_id: hata ? null : draft.id, yeni_cari: yeniCari, tarih });
}

// ─── Telegram Handler ─────────────────────────────────────────────────────────
async function handleTelegram(request, env) {
  let body;
  try { body = await request.json(); } catch { return new Response("OK"); }

  const msg = body.message || body.edited_message;
  if (!msg?.text) return new Response("OK");

  const chatId = msg.chat.id;
  const fromName = msg.from?.first_name || msg.from?.username || String(msg.from?.id);
  const metin = msg.text.trim();
  const msgId = String(msg.message_id) + "_" + String(chatId);
  const tarih = new Date(msg.date * 1000).toISOString().slice(0, 10);
  const sbKey = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;
  const tgToken = env.TELEGRAM_TOKEN;

  // /yardim
  if (metin.startsWith("/") || metin.toLowerCase() === "yardım") {
    await tgSend(tgToken, chatId,
      "💰 *Yenicespor Finans Bot*\n\n" +
      "Her satır bir işlem olarak gönderebilirsin:\n\n" +
      "`Vedat Tepe 5000 tahsilat`\n" +
      "`Hamza Türkmen 50000 ödeme banka`\n" +
      "`Ercan Alaylı 60000 aidat`\n\n" +
      "✅ *Onay kuyruğuna* düşer, uygulamadan onaylarsın.\n" +
      "📱 Çoklu işlem: Her satıra bir işlem yaz, hepsini gönder.");
    return new Response("OK");
  }

  // Duplicate
  const dup = await sbGet(sbKey, TABLES.LOGS, `msg_id=eq.${msgId}&select=id`);
  if (dup?.length > 0) return new Response("OK");

  // Çoklu satır desteği
  const satirlar = metin.split("\n").map(s => s.trim()).filter(s => s.length > 3);
  const basarili = [];
  const hatali = [];

  for (const satir of satirlar) {
    const parsed = parseMessage(satir);
    if (!parsed) { hatali.push(satir); continue; }

    const { cariAd, tutar, tur, kasa } = parsed;
    const { cariId, cariAdFinal, yeniCari } = await fuzzyBulCari(sbKey, cariAd, tur);
    const draft = buildDraft({ cariId, cariAdFinal, tutar, tur, kasa, aciklama: satir, tarih, kaynak: "telegram" });

    let hata = null;
    try { await sbPost(sbKey, TABLES.DRAFTS, draft); }
    catch(e) { hata = e.message; }

    if (hata) {
      hatali.push(`${satir} → ❌ ${hata}`);
    } else {
      basarili.push({ cariAdFinal, tutar, tur, kasa, yeniCari });
    }
  }

  // Log
  await logEntry(sbKey, { msg_id: msgId, gonderen: String(chatId), gonderen_ad: fromName, metin, durum: basarili.length > 0 ? "draft_olusturuldu" : "hata", tarih });

  // Telegram cevap
  if (!basarili.length && !hatali.length) {
    await tgSend(tgToken, chatId, "❓ Anlaşılamadı.\n\nFormat: `Cari 5000 tahsilat`");
    return new Response("OK");
  }

  let yanit = "";
  if (basarili.length > 0) {
    yanit += `📋 *${basarili.length} işlem onay kuyruğuna eklendi*\n\n`;
    for (const b of basarili) {
      const emoji = b.tur === "GELIR" ? "💰" : "💸";
      yanit += `${emoji} ${b.cariAdFinal}${b.yeniCari ? " _(yeni)_" : ""} — *${b.tutar.toLocaleString("tr-TR")} ₺* ${b.kasa}\n`;
    }
    yanit += "\n✅ _Uygulamada Onay sekmesinden onaylayın._";
  }
  if (hatali.length > 0) {
    yanit += `\n\n⚠️ Anlaşılamayan: ${hatali.length} satır`;
  }

  await tgSend(tgToken, chatId, yanit.trim());
  return new Response("OK");
}

// ─── Draft oluştur ────────────────────────────────────────────────────────────
function buildDraft({ cariId, cariAdFinal, tutar, tur, kasa, aciklama, tarih, kaynak }) {
  return {
    id: "draft_" + crypto.randomUUID(),
    kaynak,
    cari_id: cariId,
    cari_ad: cariAdFinal,
    islem_tipi: tur === "GELIR" ? "GELİR" : "GİDER",
    tutar,
    kasa,
    aciklama,
    tarih,
    kategori: tur === "GELIR" ? "Diğer Gelir" : "Diğer Gider",
    durum: "bekliyor",
    created_at: new Date().toISOString()
  };
}

// ─── Mesaj Parse ──────────────────────────────────────────────────────────────
function parseMessage(metin) {
  const text = metin.trim();
  const isGelir = GELIR_KW.test(text);
  const isGider = GIDER_KW.test(text);
  if (!isGelir && !isGider) return null;
  const tur = isGelir ? "GELIR" : "GIDER";
  const kasa = BANKA_KW.test(text) ? "BANKA" : "NAKİT";

  const tutarlar = [];
  let m;
  TUTAR_RE.lastIndex = 0;
  while ((m = TUTAR_RE.exec(text)) !== null) {
    const s = m[1].replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    if (!isNaN(n) && n >= 10) tutarlar.push(n);
  }
  if (!tutarlar.length) return null;
  const tutar = Math.max(...tutarlar);

  let cariAd = text
    .replace(TUTAR_RE, " ")
    .replace(GELIR_KW, " ").replace(GIDER_KW, " ")
    .replace(BANKA_KW, " ")
    .replace(/[₺tTlL]+\b/g, " ")
    .replace(/\s{2,}/g, " ").trim()
    .replace(/^[-:,]+|[-:,]+$/g, "").trim();
  if (!cariAd || cariAd.length < 2) cariAd = null;

  return { cariAd, tutar, tur, kasa };
}

// ─── Fuzzy Cari Eşleştirme ───────────────────────────────────────────────────
async function fuzzyBulCari(sbKey, cariAd, tur) {
  if (!cariAd) return { cariId: tur === "GELIR" ? "c_muhtelif_gelir" : "c_muhtelif_gider", cariAdFinal: tur === "GELIR" ? "Muhtelif Gelir" : "Muhtelif Gider", yeniCari: false };

  // Supabase'den tüm carileri çek (ilk 500)
  const mevcut = await sbGet(sbKey, TABLES.CARIS, `select=id,ad&limit=500`);
  const norm = s => (s || "").toLowerCase()
    .replace(/[şŞ]/g,"s").replace(/[çÇ]/g,"c").replace(/[ğĞ]/g,"g")
    .replace(/[üÜ]/g,"u").replace(/[öÖ]/g,"o").replace(/[ıIİi]/g,"i")
    .replace(/[^a-z0-9]/g,"");

  const nCari = norm(cariAd);
  let best = null, bestSkor = 0;

  for (const c of (mevcut || [])) {
    const nc = norm(c.ad);
    let skor = 0;
    if (nc === nCari) skor = 100;
    else if (nc.includes(nCari) || nCari.includes(nc)) skor = 80;
    else {
      const words = nCari.split(/\s+/).filter(w => w.length > 2);
      for (const w of words) if (nc.includes(w)) skor += w.length * 5;
    }
    if (skor > bestSkor) { bestSkor = skor; best = c; }
  }

  if (best && bestSkor >= 15) return { cariId: best.id, cariAdFinal: best.ad, yeniCari: false };

  // Bulunamadı — yeni cari oluştur
  const anaTur = tur === "GELIR" ? "Gelir" : "Masraf";
  const cariTur = tur === "GELIR" ? "Diğer Gelir" : "Diğer Gider";
  const id = "tg_" + norm(cariAd).slice(0, 16) + "_" + Date.now().toString(36);
  try {
    await sbPost(sbKey, TABLES.CARIS, { id, ad: cariAd, tur: cariTur, ana_tur: anaTur });
    return { cariId: id, cariAdFinal: cariAd, yeniCari: true };
  } catch {
    return { cariId: tur === "GELIR" ? "c_muhtelif_gelir" : "c_muhtelif_gider", cariAdFinal: cariAd, yeniCari: false };
  }
}

// ─── Log ──────────────────────────────────────────────────────────────────────
async function logEntry(sbKey, data) {
  try {
    await sbPost(sbKey, TABLES.LOGS, { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...data });
  } catch(e) { console.warn("[LOG]", e.message); }
}

// ─── Supabase Helpers ─────────────────────────────────────────────────────────
function sbHeaders(key) {
  return { "Content-Type": "application/json", "apikey": key, "Authorization": "Bearer " + key, "Prefer": "return=representation" };
}
async function sbGet(key, table, query = "") {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(key) });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}
async function sbPost(key, table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: sbHeaders(key), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function tgSend(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
  } catch(e) { console.error("tgSend:", e.message); }
}

async function registerTelegramWebhook(request, env) {
  const token = env.TELEGRAM_TOKEN;
  if (!token) return new Response("TELEGRAM_TOKEN eksik", { status: 500 });
  const webhookUrl = new URL(request.url).origin + "/telegram";
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] })
  });
  return new Response(JSON.stringify(await r.json(), null, 2), { headers: { "Content-Type": "application/json" } });
}
