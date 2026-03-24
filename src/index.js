/**
 * YENİCESPOR FİNANS — Cloudflare Worker
 * Rotalar:
 *   GET  /whatsapp  → Meta webhook doğrulama
 *   POST /whatsapp  → WhatsApp mesaj işleme
 *   *               → Statik varlıklar (index.html vb.)
 */

// ─── Sabitler ────────────────────────────────────────────────────────────────
const SB_URL  = "https://vkyqbjddiayxpfeeqkjz.supabase.co";
const TABLES  = { TX: "ys_transactions", CARIS: "ys_caris", LOGS: "ys_wa_logs" };

const FALLBACK = { GELIR: "c_muhtelif_gelir", GIDER: "c_muhtelif_gider" };
const FALLBACK_AD = { GELIR: "Muhtelif Gelir",  GIDER: "Muhtelif Gider" };

// Tahsilat / ödeme kelime eşleştirme
const GELIR_KW = /tahsilat|tahsil|gelir|aldık|alındı|ödedi|gönderdi|yatırdı/i;
const GIDER_KW = /ödeme|ödendi|gider|verdik|öd[eü]|gönder|masraf|harcama/i;
const KASA_KW  = /\bkasa\b|\bnakit\b/i;
const BANKA_KW = /\bbanka\b|\bhavale\b|\beft\b|\bfast\b|\btransfer\b/i;

// Tutar regex: 1.500 | 1500 | 1,500 | 1500.50
const TUTAR_RE = /\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)\s*(?:tl|₺|lira)?\b/gi;

// ─── Ana Handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/whatsapp") {
      if (request.method === "GET")  return handleVerify(request, env);
      if (request.method === "POST") return handleWebhook(request, env);
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Diğer her şey → statik dosya (index.html)
    return env.ASSETS.fetch(request);
  }
};

// ─── 1. Meta Webhook Doğrulama ────────────────────────────────────────────────
function handleVerify(request, env) {
  const url   = new URL(request.url);
  const mode  = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const verifyToken = env.WA_VERIFY_TOKEN || "yenicespor_webhook_2026";

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[WA] Webhook doğrulandı ✅");
    return new Response(challenge, { status: 200 });
  }
  console.warn("[WA] Doğrulama başarısız ❌", { mode, token });
  return new Response("Forbidden", { status: 403 });
}

// ─── 2. Webhook POST Handler ──────────────────────────────────────────────────
async function handleWebhook(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Meta imza doğrulama (isteğe bağlı — secret varsa)
  if (env.WA_APP_SECRET) {
    const sig = request.headers.get("x-hub-signature-256") || "";
    const valid = await verifySignature(request, body, env.WA_APP_SECRET);
    if (!valid) {
      console.warn("[WA] İmza geçersiz");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // WhatsApp Business Cloud mesajları
  if (body?.object !== "whatsapp_business_account") {
    return new Response("OK", { status: 200 }); // Tanınmayan payload, sessizce geç
  }

  const sbKey = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;

  // Her entry → her change → mesajlar
  const promises = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const val = change.value || {};
      for (const msg of val.messages || []) {
        promises.push(processMessage(msg, val, env, sbKey));
      }
    }
  }

  await Promise.allSettled(promises);
  return new Response("OK", { status: 200 });
}

// ─── 3. Tekil Mesaj İşleme ────────────────────────────────────────────────────
async function processMessage(msg, val, env, sbKey) {
  const msgId    = msg.id;
  const fromNum  = msg.from;
  const ts       = Number(msg.timestamp) * 1000;
  const tarih    = new Date(ts).toISOString().slice(0, 10);
  const gonderenAd = val.contacts?.[0]?.profile?.name || fromNum;

  // Sadece metin mesajı
  if (msg.type !== "text" || !msg.text?.body?.trim()) {
    await logWA(sbKey, { msg_id: msgId, gonderen: fromNum, gonderen_ad: gonderenAd,
      metin: null, durum: "atlandı", hata: "Metin dışı mesaj türü: "+msg.type, tarih });
    return;
  }

  const metin = msg.text.body.trim();

  // Gönderen filtresi
  const izinliNumaralar = (env.WA_ALLOWED_SENDERS || "ALL").split(",").map(s => s.trim());
  if (izinliNumaralar[0] !== "ALL" && !izinliNumaralar.includes(fromNum)) {
    await logWA(sbKey, { msg_id: msgId, gonderen: fromNum, gonderen_ad: gonderenAd,
      metin, durum: "atlandı", hata: "İzinsiz gönderen", tarih });
    return;
  }

  // Duplicate kontrolü
  const dupCheck = await sbGet(sbKey, TABLES.LOGS, `msg_id=eq.${msgId}&select=id`);
  if (dupCheck?.length > 0) {
    console.log("[WA] Duplicate, atlanıyor:", msgId);
    return;
  }

  // Parse
  const parsed = parseMessage(metin);
  if (!parsed) {
    await logWA(sbKey, { msg_id: msgId, gonderen: fromNum, gonderen_ad: gonderenAd,
      metin, durum: "parse_hatası", hata: "İşlem tipi veya tutar çıkarılamadı", tarih });
    return;
  }

  const { cariAd, tutar, tur, kasa } = parsed;

  // Cari bul / oluştur
  const { cariId, cariAdFinal, yeniCari } = await bulVeyaOlusturCari(sbKey, cariAd, tur);

  // Tahakkuk kontrolü
  const tahakkukVar = await kontrolTahakkuk(sbKey, cariId, tur);

  // İşlem oluştur
  const txId = crypto.randomUUID();
  const tx = {
    id: txId,
    tarih,
    tur: tur === "GELIR" ? "GELİR" : "GİDER",
    tutar,
    kasa,
    cari_id: cariId,
    aciklama: metin,
    kategori: tur === "GELIR"
      ? (tahakkukVar ? "Sponsor Geliri" : "Diğer Gelir")
      : (tahakkukVar ? "Diğer Gider" : "Diğer Gider"),
    kaynak: "whatsapp",
    gelir_id: null
  };

  let txHata = null;
  try {
    await sbPost(sbKey, TABLES.TX, tx);
  } catch (e) {
    txHata = e.message;
  }

  // Log yaz
  await logWA(sbKey, {
    msg_id: msgId,
    gonderen: fromNum,
    gonderen_ad: gonderenAd,
    metin,
    durum: txHata ? "tx_hatası" : "işlendi",
    hata: txHata || (tahakkukVar ? null : "Tahakkuk bulunamadı"),
    cari_id: cariId,
    cari_ad: cariAdFinal,
    tutar,
    islem_tipi: tur,
    kasa,
    tx_id: txHata ? null : txId,
    yeni_cari: yeniCari,
    tarih
  });

  if (txHata) {
    console.error("[WA] TX hatası:", txHata, tx);
  } else {
    console.log(`[WA] ✅ İşlem oluşturuldu: ${tur} ${tutar}₺ — ${cariAdFinal}`);
  }
}

// ─── 4. Mesaj Parse ───────────────────────────────────────────────────────────
function parseMessage(metin) {
  const text = metin.trim();

  // İşlem tipini belirle
  const isGelir = GELIR_KW.test(text);
  const isGider = GIDER_KW.test(text);

  if (!isGelir && !isGider) return null; // Finans mesajı değil

  const tur = isGelir ? "GELIR" : "GIDER";

  // Kasa tipini belirle
  let kasa = "NAKİT"; // varsayılan
  if (BANKA_KW.test(text)) kasa = "BANKA";
  else if (KASA_KW.test(text)) kasa = "NAKİT";

  // Tutarı bul — en büyük sayıyı al (küçük sayılar tarih/başka şey olabilir)
  const tutarlar = [];
  let m;
  TUTAR_RE.lastIndex = 0;
  while ((m = TUTAR_RE.exec(text)) !== null) {
    const s = m[1].replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    if (!isNaN(n) && n >= 1) tutarlar.push({ val: n, idx: m.index, len: m[0].length });
  }

  if (!tutarlar.length) return null;

  // Para birimi ile işaretlenmiş varsa önce onu al, yoksa en büyüğünü
  const tutar = tutarlar.sort((a, b) => b.val - a.val)[0].val;
  const tutatIdx = tutarlar[0].idx;

  // Cari adı: tutar ve anahtar kelimeler çıkarıldıktan sonra kalan
  let cariAd = text
    .replace(TUTAR_RE, " ")
    .replace(GELIR_KW, " ")
    .replace(GIDER_KW, " ")
    .replace(KASA_KW, " ")
    .replace(BANKA_KW, " ")
    .replace(/[₺tTlL]+\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[-:,]+|[-:,]+$/g, "")
    .trim();

  // Boşsa fallback
  if (!cariAd || cariAd.length < 2) cariAd = null;

  return { cariAd, tutar, tur, kasa };
}

// ─── 5. Cari Bul / Oluştur ───────────────────────────────────────────────────
async function bulVeyaOlusturCari(sbKey, cariAd, tur) {
  if (!cariAd) {
    // Fallback cari
    return {
      cariId: FALLBACK[tur],
      cariAdFinal: FALLBACK_AD[tur],
      yeniCari: false
    };
  }

  // Mevcut cariyi ara (case-insensitive, partial match)
  const encoded = encodeURIComponent(`%${cariAd}%`);
  const mevcut = await sbGet(sbKey, TABLES.CARIS,
    `ad=ilike.${encoded}&limit=1&select=id,ad`);

  if (mevcut?.length > 0) {
    return { cariId: mevcut[0].id, cariAdFinal: mevcut[0].ad, yeniCari: false };
  }

  // Yeni cari oluştur
  const ana_tur = tur === "GELIR" ? "Gelir" : "Masraf";
  const cariTur = tur === "GELIR" ? "Diğer Gelir" : "Diğer Gider";
  const id = "wa_" + slugify(cariAd) + "_" + Date.now().toString(36);

  try {
    await sbPost(sbKey, TABLES.CARIS, { id, ad: cariAd, tur: cariTur, ana_tur });
    return { cariId: id, cariAdFinal: cariAd, yeniCari: true };
  } catch {
    // Oluşturulamazsa fallback
    return { cariId: FALLBACK[tur], cariAdFinal: FALLBACK_AD[tur], yeniCari: false };
  }
}

// ─── 6. Tahakkuk Kontrolü ────────────────────────────────────────────────────
async function kontrolTahakkuk(sbKey, cariId, tur) {
  if (!cariId || cariId.startsWith("c_muhtelif")) return false;
  const txTur = tur === "GELIR" ? "GELİR" : "GİDER";
  const result = await sbGet(sbKey, TABLES.TX,
    `cari_id=eq.${cariId}&tur=eq.${encodeURIComponent(txTur)}&kategori=ilike.*Tahakkuk*&limit=1&select=id`);
  return result?.length > 0;
}

// ─── 7. Log ──────────────────────────────────────────────────────────────────
async function logWA(sbKey, data) {
  try {
    await sbPost(sbKey, TABLES.LOGS, {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...data
    });
  } catch (e) {
    // Log tablosu yoksa sessizce geç (tablo oluşturulmamış olabilir)
    console.warn("[WA] Log yazılamadı:", e.message);
  }
}

// ─── Supabase Helpers ─────────────────────────────────────────────────────────
function sbHeaders(key) {
  return {
    "Content-Type": "application/json",
    "apikey": key,
    "Authorization": "Bearer " + key,
    "Prefer": "return=representation"
  };
}

async function sbGet(key, table, query = "") {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
      headers: sbHeaders(key)
    });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

async function sbPost(key, table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders(key),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
function slugify(s) {
  return s.toLowerCase()
    .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g")
    .replace(/[ışİŞ]/g, "s").replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u").replace(/[ıI]/g, "i")
    .replace(/[^a-z0-9]/g, "").slice(0, 16);
}

async function verifySignature(request, body, secret) {
  try {
    const rawBody = JSON.stringify(body);
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const hex = "sha256=" + Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const expected = request.headers.get("x-hub-signature-256") || "";
    return hex === expected;
  } catch { return false; }
}
