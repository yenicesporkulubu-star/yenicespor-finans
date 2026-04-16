/**
 * YENİCESPOR FİNANS — Cloudflare Worker
 * Telegram: mesaj → inline onay butonu → direkt kayıt
 */

const SB_URL = "https://vkyqbjddiayxpfeeqkjz.supabase.co";
const TABLES = { TX: "ys_transactions", CARIS: "ys_caris", LOGS: "ys_wa_logs", DRAFTS: "ys_drafts" };

const GELIR_KW = /tahsilat|tahsil|gelir|aldık|alındı|ödedi|yatırdı|aidat|katkı|sponsor|bağış/i;
const GIDER_KW = /ödeme|ödendi|gider|verdik|öd[eü]|masraf|harcama|maaş|ücret/i;
const BANKA_KW = /\bbanka\b|\bhavale\b|\beft\b|\bfast\b|\btransfer\b/i;
const TUTAR_RE = /\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)\s*(?:tl|₺|lira)?(?:\b|$)/gi;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/whatsapp") {
      if (request.method === "GET") return handleVerify(request, env);
      if (request.method === "POST") return handleWA(request, env);
    }
    if (url.pathname === "/telegram") {
      if (request.method === "POST") return handleTelegram(request, env);
      return new Response("OK");
    }
    if (url.pathname === "/telegram/set") return registerWebhook(request, env);
    if (url.pathname === "/seed-caris") return seedCaris(request, env);
    return env.ASSETS.fetch(request);
  }
};

// ─── Telegram Ana Handler ─────────────────────────────────────────────────────
async function handleTelegram(request, env) {
  let body;
  try { body = await request.json(); } catch { return new Response("OK"); }

  const sbKey = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;
  const tgToken = env.TELEGRAM_TOKEN;

  // Callback query (buton basıldı)
  if (body.callback_query) {
    return handleCallback(body.callback_query, env, sbKey, tgToken);
  }

  const msg = body.message || body.edited_message;
  if (!msg?.text) return new Response("OK");

  const chatId = msg.chat.id;
  const fromName = msg.from?.first_name || msg.from?.username || "Kullanıcı";
  const metin = msg.text.trim();
  const msgId = String(msg.message_id) + "_" + String(chatId);
  const tarih = new Date(msg.date * 1000).toISOString().slice(0, 10);

  // /yardim veya /start
  if (metin.startsWith("/start") || metin.toLowerCase().includes("yardım")) {
    await tgSend(tgToken, chatId,
      "💰 *Yenicespor Finans Bot*\n\n" +
      "Her satır bir işlem — doğrudan onayla:\n\n" +
      "`Vedat Tepe 5000 tahsilat`\n" +
      "`Hamza Türkmen 50000 ödeme banka`\n" +
      "`Ercan Alaylı 60000 aidat`\n\n" +
      "Bot sana *✅ Onayla / ✏️ Düzenle / 🗑 Sil* butonlarını gösterir.\n" +
      "Onayladığın an direkt sisteme kaydedilir."
    );
    return new Response("OK");
  }

  // Duplicate kontrolü
  const dup = await sbGet(sbKey, TABLES.LOGS, `msg_id=eq.${msgId}&select=id`);
  if (dup?.length > 0) return new Response("OK");

  // Çoklu satır parse
  const satirlar = metin.split("\n").map(s => s.trim()).filter(s => s.length > 3);
  let islendi = 0;

  for (const satir of satirlar) {
    const parsed = parseMsg(satir);
    if (!parsed) continue;

    const { cariAd, tutar, tur, kasa } = parsed;
    const fuzzyRes = await fuzzyBul(sbKey, cariAd, tur);
    const { cariAdFinal, yeniCari, yakinlar } = fuzzyRes;
    let cariId = fuzzyRes.cariId;

    const draftId = "draft_" + crypto.randomUUID();
    const draft = {
      id: draftId,
      kaynak: "telegram",
      cari_id: cariId,
      cari_ad: cariAdFinal,
      islem_tipi: tur === "GELIR" ? "GELİR" : "GİDER",
      tutar,
      kasa,
      aciklama: satir,
      tarih,
      kategori: tur === "GELIR" ? "Diğer Gelir" : "Diğer Gider",
      durum: "bekliyor",
      created_at: new Date().toISOString()
    };

    try { await sbPost(sbKey, TABLES.DRAFTS, draft); } catch(e) { continue; }

    const emoji = tur === "GELIR" ? "💰" : "💸";
    const turStr = tur === "GELIR" ? "GELİR" : "GİDER";

    if (yeniCari && !cariId) {
      // Cari bulunamadı — seçenek sun
      const yakinlarStr = (yakinlar||[]).length
        ? "\n\n🔍 Benzer cariler:" + (yakinlar||[]).map(c => `\n• ${c.ad}`).join("")
        : "";
      const mesajMetni =
        `${emoji} *${turStr}* · ${tarih}\n` +
        `❓ *"${cariAdFinal}"* — cari bulunamadı${yakinlarStr}\n\n` +
        `💵 *${tutar.toLocaleString("tr-TR")} ₺* · ${kasa}\n` +
        `📝 _${satir}_`;

      const buttons = [
        [{ text: `➕ Yeni cari oluştur: ${cariAdFinal.slice(0,20)}`, callback_data: `yeni_cari:${draftId}:${encodeURIComponent(cariAdFinal)}:${tur}` }],
      ];
      // Yakın cariler için buton
      for (const yc of (yakinlar||[]).slice(0,2)) {
        buttons.push([{ text: `✔️ ${yc.ad}`, callback_data: `cari_sec:${draftId}:${yc.id}:${encodeURIComponent(yc.ad)}` }]);
      }
      buttons.push([{ text: "🗑 İptal", callback_data: `sil:${draftId}` }]);

      await tgSendButtons(tgToken, chatId, mesajMetni, buttons);
    } else {
      // Cari biliniyor — normal onay butonu
      const mesajMetni =
        `${emoji} *${turStr}* · ${tarih}\n` +
        `👤 *${cariAdFinal}*\n` +
        `💵 *${tutar.toLocaleString("tr-TR")} ₺* · ${kasa}\n` +
        `📝 _${satir}_`;

      await tgSendButtons(tgToken, chatId, mesajMetni, [
        [
          { text: "✅ Onayla", callback_data: `onayla:${draftId}` },
          { text: "🗑 Sil",    callback_data: `sil:${draftId}` }
        ],
        [{ text: "✏️ Tutarı Düzenle", callback_data: `duzenle:${draftId}` }]
      ]);
    }

    islendi++;
  }

  if (islendi === 0) {
    await tgSend(tgToken, chatId,
      "❓ Anlaşılamadı.\n\nFormat: `Cari Adı TUTAR tahsilat/ödeme`\n\nÖrnek:\n`Vedat Tepe 5000 tahsilat`"
    );
  }

  // Log
  await logEntry(sbKey, {
    msg_id: msgId, gonderen: String(chatId), gonderen_ad: fromName,
    metin, durum: islendi > 0 ? "buton_gonderildi" : "parse_hatasi", tarih
  });

  return new Response("OK");
}

// ─── Callback Handler (buton basıldı) ────────────────────────────────────────
async function handleCallback(cbq, env, sbKey, tgToken) {
  const chatId = cbq.message.chat.id;
  const msgId = cbq.message.message_id;
  const data = cbq.data || "";
  const [aksiyon, draftId] = data.split(":");

  // Callback'i kabul et (buton loading durumunu kaldır)
  await fetch(`https://api.telegram.org/bot${tgToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbq.id })
  });

  if (aksiyon === "onayla") {
    // Draft'ı çek
    const drafts = await sbGet(sbKey, TABLES.DRAFTS, `id=eq.${draftId}&select=*`);
    const draft = drafts?.[0];
    if (!draft) {
      await tgEditMsg(tgToken, chatId, msgId, cbq.message.text + "\n\n❌ _Draft bulunamadı_", []);
      return new Response("OK");
    }

    // TX oluştur
    const tx = {
      id: crypto.randomUUID(),
      tarih: draft.tarih,
      tur: draft.islem_tipi,
      tutar: draft.tutar,
      kasa: draft.kasa,
      cari_id: draft.cari_id,
      cari_temp_id: draft.cari_id,
      aciklama: draft.aciklama,
      kategori: draft.kategori
    };

    let hata = null;
    try { await sbPost(sbKey, TABLES.TX, tx); } catch(e) { hata = e.message; }

    if (hata) {
      await tgEditMsg(tgToken, chatId, msgId,
        cbq.message.text + `\n\n❌ Kayıt hatası: ${hata}`, []);
    } else {
      // Draft'ı güncelle
      try { await sbPatch(sbKey, TABLES.DRAFTS, { durum: "onaylandi", tx_id: tx.id }, `id=eq.${draftId}`); } catch {}
      await tgEditMsg(tgToken, chatId, msgId,
        cbq.message.text + "\n\n✅ *Kaydedildi!*", []);

      // Son 10 işlemi listele
      try {
        const sonTxs = await sbGet(sbKey, TABLES.TX, "order=created_at.desc&limit=10&select=tarih,tur,tutar,kasa,aciklama");
        if (sonTxs && sonTxs.length > 0) {
          const fmtN = n => Number(n).toLocaleString("tr-TR");
          const liste = sonTxs.map((t,i) => {
            const em = t.tur === "GELİR" ? "💰" : "💸";
            return `${i+1}\. ${em} ${t.tarih} · *${fmtN(t.tutar)} ₺* · ${t.kasa}\n    _${(t.aciklama||"").slice(0,35)}_`;
          }).join("\n");
          const gel = sonTxs.filter(t=>t.tur==="GELİR").reduce((a,t)=>a+Number(t.tutar),0);
          const gid = sonTxs.filter(t=>t.tur==="GİDER").reduce((a,t)=>a+Number(t.tutar),0);
          await tgSend(tgToken, chatId,
            `📋 *Son 10 İşlem*\n\n${liste}\n\n💰 ${fmtN(gel)} ₺  💸 ${fmtN(gid)} ₺`
          );
        }
      } catch(e) {}
    }

  } else if (aksiyon === "sil") {
    try { await sbDelete(sbKey, TABLES.DRAFTS, `id=eq.${draftId}`); } catch {}
    await tgEditMsg(tgToken, chatId, msgId,
      cbq.message.text + "\n\n🗑 _Silindi_", []);

  } else if (aksiyon === "duzenle") {
    // Kullanıcıdan yeni tutar iste
    await tgEditMsg(tgToken, chatId, msgId,
      cbq.message.text + "\n\n✏️ _Yeni tutarı yaz (sadece rakam):_", []);
    // Bir sonraki mesajı "tutar düzenleme" modunda algıla
    // Bunu session state ile yapamıyoruz (stateless), ama kullanıcı şunu yazabilir:
    // "düzenle DRAFT_ID 7500" formatında
    await tgSend(tgToken, chatId,
      `Yeni tutarı şu formatta yaz:\n\`düzenle ${draftId.slice(-8)} 7500\``
    );

  } else if (aksiyon === "yeni_cari") {
    // Format: yeni_cari:draftId:cariAd:tur
    const parts = data.split(":");
    const draftId2 = parts[1];
    const cariAd2 = decodeURIComponent(parts[2] || "");
    const tur2 = parts[3] || "GELIR";
    const cariTur = tur2 === "GELIR" ? "Diğer Gelir" : "Diğer Gider";
    const anaTur = tur2 === "GELIR" ? "Gelir" : "Masraf";
    const newId = "tg_" + cariAd2.toLowerCase().replace(/[^a-z0-9]/gi,"").slice(0,16) + "_" + Date.now().toString(36);
    try {
      await sbPost(sbKey, TABLES.CARIS, { id: newId, ad: cariAd2, tur: cariTur, ana_tur: anaTur });
      await sbPatch(sbKey, TABLES.DRAFTS, { cari_id: newId }, `id=eq.${draftId2}`);
      // Otomatik onayla
      const drafts2 = await sbGet(sbKey, TABLES.DRAFTS, `id=eq.${draftId2}&select=*`);
      const draft2 = drafts2?.[0];
      if (draft2) {
        const tx = { id: crypto.randomUUID(), tarih: draft2.tarih, tur: draft2.islem_tipi, tutar: draft2.tutar, kasa: draft2.kasa, cari_id: newId, cari_temp_id: newId, aciklama: draft2.aciklama, kategori: draft2.kategori };
        await sbPost(sbKey, TABLES.TX, tx);
        await sbPatch(sbKey, TABLES.DRAFTS, { durum: "onaylandi" }, `id=eq.${draftId2}`);
        await tgEditMsg(tgToken, chatId, msgId, cbq.message.text + `\n\n✅ *Yeni cari oluşturuldu ve kaydedildi!*\n👤 ${cariAd2}`, []);
      }
    } catch(e) {
      await tgEditMsg(tgToken, chatId, msgId, cbq.message.text + `\n\n❌ Hata: ${e.message}`, []);
    }

  } else if (aksiyon === "cari_sec") {
    // Format: cari_sec:draftId:cariId:cariAd
    const parts = data.split(":");
    const draftId3 = parts[1];
    const secCariId = parts[2];
    const secCariAd = decodeURIComponent(parts[3] || "");
    try {
      await sbPatch(sbKey, TABLES.DRAFTS, { cari_id: secCariId, cari_ad: secCariAd }, `id=eq.${draftId3}`);
      // Otomatik onayla
      const drafts3 = await sbGet(sbKey, TABLES.DRAFTS, `id=eq.${draftId3}&select=*`);
      const draft3 = drafts3?.[0];
      if (draft3) {
        const tx = { id: crypto.randomUUID(), tarih: draft3.tarih, tur: draft3.islem_tipi, tutar: draft3.tutar, kasa: draft3.kasa, cari_id: secCariId, cari_temp_id: secCariId, aciklama: draft3.aciklama, kategori: draft3.kategori };
        await sbPost(sbKey, TABLES.TX, tx);
        await sbPatch(sbKey, TABLES.DRAFTS, { durum: "onaylandi" }, `id=eq.${draftId3}`);
        await tgEditMsg(tgToken, chatId, msgId, cbq.message.text + `\n\n✅ *${secCariAd} — Kaydedildi!*`, []);
      }
    } catch(e) {
      await tgEditMsg(tgToken, chatId, msgId, cbq.message.text + `\n\n❌ Hata: ${e.message}`, []);
    }

  } else if (aksiyon === "duzenle2") {
    // "düzenle XXXXX 7500" komutu
    const [,shortId, tutarStr] = data.split(":");
    const yeniTutar = parseFloat((tutarStr||"").replace(",","."));
    if (!yeniTutar) {
      await tgSend(tgToken, chatId, "❌ Geçersiz tutar");
      return new Response("OK");
    }
    try {
      await sbPatch(sbKey, TABLES.DRAFTS, { tutar: yeniTutar }, `id=eq.${draftId}`);
      await tgSend(tgToken, chatId, `✅ Tutar ${yeniTutar.toLocaleString("tr-TR")} ₺ olarak güncellendi`);
    } catch(e) {
      await tgSend(tgToken, chatId, "❌ Güncelleme hatası: " + e.message);
    }
  }

  return new Response("OK");
}

// ─── Mesaj Parse ──────────────────────────────────────────────────────────────
function parseMsg(metin) {
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
    const n = parseFloat(m[1].replace(/\./g,"").replace(",","."));
    if (!isNaN(n) && n >= 10) tutarlar.push(n);
  }
  if (!tutarlar.length) return null;
  const tutar = Math.max(...tutarlar);

  let cariAd = text
    .replace(TUTAR_RE, " ").replace(GELIR_KW, " ").replace(GIDER_KW, " ")
    .replace(BANKA_KW, " ").replace(/[₺tl]+\b/gi, " ")
    .replace(/\s{2,}/g, " ").trim().replace(/^[-:,]+|[-:,]+$/g, "").trim();
  if (!cariAd || cariAd.length < 2) cariAd = null;

  return { cariAd, tutar, tur, kasa };
}

// ─── Fuzzy Cari ───────────────────────────────────────────────────────────────
async function fuzzyBul(sbKey, cariAd, tur) {
  const fallback = { cariId: tur==="GELIR"?"c_muhtelif_gelir":"c_muhtelif_gider", cariAdFinal: cariAd||"Muhtelif", yeniCari: false };
  if (!cariAd) return fallback;

  const rows = await sbGet(sbKey, TABLES.CARIS, `select=id,ad&limit=500`);

  const norm = s => {
    if (!s) return "";
    let t = s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    t = t.replace(/[şç]/g,"s").replace(/ğ/g,"g").replace(/[üö]/g,"u").replace(/[ıiİI]/g,"i");
    return t.replace(/[^a-z0-9]/g,"");
  };

  const nCari = norm(cariAd);
  let best = null, bestSkor = 0;

  for (const c of (rows || [])) {
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

  // Yakın eşleşme varsa öner (skor 5-14 arası)
  const yakin = rows ? [...rows].sort((a,b)=>{
    const sa = norm(a.ad).includes(norm(cariAd)) || norm(cariAd).includes(norm(a.ad)) ? 5 : 0;
    const sb2 = norm(b.ad).includes(norm(cariAd)) || norm(cariAd).includes(norm(b.ad)) ? 5 : 0;
    return sb2 - sa;
  }).slice(0,3).filter(c => {
    const nc = norm(c.ad);
    const words = norm(cariAd).split(/\s+/).filter(w=>w.length>2);
    return words.some(w=>nc.includes(w));
  }) : [];

  // Null döndür — caller inline buton göstersin
  return { cariId: null, cariAdFinal: cariAd, yeniCari: true, yakinlar: yakin };
}

// ─── Supabase Helpers ─────────────────────────────────────────────────────────
const sbH = key => ({
  "Content-Type": "application/json",
  "apikey": key,
  "Authorization": "Bearer " + key,
  "Prefer": "return=representation"
});

async function sbGet(key, table, q="") {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { headers: sbH(key) });
    return r.ok ? r.json() : [];
  } catch { return []; }
}

async function sbPost(key, table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST", headers: sbH(key), body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function sbPatch(key, table, body, q) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, {
    method: "PATCH",
    headers: { ...sbH(key), "Prefer": "return=minimal" },
    body: JSON.stringify(body)
  });
  if (!r.ok && r.status !== 204) throw new Error(await r.text());
}

async function sbDelete(key, table, q) {
  await fetch(`${SB_URL}/rest/v1/${table}?${q}`, {
    method: "DELETE", headers: sbH(key)
  });
}

async function logEntry(key, data) {
  try { await sbPost(key, TABLES.LOGS, { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...data }); }
  catch {}
}

// ─── Telegram Helpers ─────────────────────────────────────────────────────────
async function tgSend(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  });
}

async function tgSendButtons(token, chatId, text, buttons) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    })
  });
}

async function tgEditMsg(token, chatId, msgId, text, buttons) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, message_id: msgId,
      text, parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons || [] }
    })
  });
}

async function registerWebhook(request, env) {
  const token = env.TELEGRAM_TOKEN;
  if (!token) return new Response("TELEGRAM_TOKEN eksik", { status: 500 });
  const webhookUrl = new URL(request.url).origin + "/telegram";
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] })
  });
  return new Response(JSON.stringify(await r.json(), null, 2), { headers: { "Content-Type": "application/json" } });
}

// ─── WhatsApp Verify ──────────────────────────────────────────────────────────
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

async function handleWA(request, env) {
  return new Response("OK"); // WA devre dışı
}

// ─── Seed Caris ───────────────────────────────────────────────────────────────
async function seedCaris(request, env) {
  const sbKey = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;
  if (!sbKey) return new Response("Key eksik", { status: 500 });
  const SEED = [{"id": "yk_sebahattingöztepe", "ad": "Sebahattin Göztepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_alii̇hsantürker", "ad": "Ali İhsan Türker", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_fatihbayar", "ad": "Fatih Bayar", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_ercanalaylı", "ad": "Ercan Alaylı", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_vedattepe", "ad": "Vedat Tepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇brahimtopçu", "ad": "İbrahim Topçu", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_feritfidan", "ad": "Ferit Fidan", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_oğuzhangöztepe", "ad": "Oğuzhan Göztepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_burakkoç", "ad": "Burak Koç", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_selimbilim", "ad": "Selim Bilim", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_ünalaktaş", "ad": "Ünal Aktaş", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇smailfidan", "ad": "İsmail Fidan", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_burakseymen", "ad": "Burak Seymen", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇smailsargın", "ad": "İsmail Sargın", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_aligöztepe", "ad": "Ali Göztepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_salihufkuntaşkın", "ad": "Salih Ufkun Taşkın", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇brahimtürker", "ad": "İbrahim Türker", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_zeynelkahyaoğlu", "ad": "Zeynel Kahyaoğlu", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_erdoğanşentürk", "ad": "Erdoğan Şentürk", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_tuncayşimşek", "ad": "Tuncay Şimşek", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "fut_duhançağlarakdağ", "ad": "Duhan Çağlar Akdağ", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_furkanyenitürk", "ad": "Furkan Yenitürk", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_serkancan", "ad": "Serkan Can", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_ömerfarukşenkan", "ad": "Ömer Faruk Şenkan", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_erolelibol", "ad": "Erol Elibol", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_efekorucu", "ad": "Efe Korucu", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_melihdursun", "ad": "Melih Dursun", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_yusufkoç", "ad": "Yusuf Koç", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_erkani̇larslan", "ad": "Erkan İlarslan", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_hamzatürkmen", "ad": "Hamza Türkmen", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_özgürözgöçmen", "ad": "Özgür Özgöçmen", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_mtalhaüz", "ad": "M. Talha Üz", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_selimatış", "ad": "Selim Atış", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_ufukyenisoy", "ad": "Ufuk Yenisoy", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_gökhanyıldırım", "ad": "Gökhan Yıldırım", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_ardaseber", "ad": "Arda Seber", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_alişakiri", "ad": "Ali Şakiri", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_arifbuğrapaşay", "ad": "Arif Buğra Paşay", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_eyyüpensardoğan", "ad": "Eyyüp Ensar Doğan", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_yasirboz", "ad": "Yasir Boz", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_emregüzen", "ad": "EMRE GÜZEN", "tur": "A Takım Antrenör", "ana_tur": "Gider"}, {"id": "fut_vahapşenol", "ad": "VAHAP ŞENOL", "tur": "A Takım Antrenör", "ana_tur": "Gider"}, {"id": "fut_altyapiantröner", "ad": "ALTYAPI ANTRÖNER", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_sadetti̇nsoydan", "ad": "SADETTİN SOYDAN", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_selçukkaymakçi", "ad": "SELÇUK KAYMAKÇI", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_abdullahalkuş", "ad": "ABDULLAH ALKUŞ", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_özgürçoşar", "ad": "ÖZGÜR ÇOŞAR", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_necmetti̇ni̇nan", "ad": "NECMETTİN İNAN", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "c_halisaha", "ad": "Halısaha", "tur": "Gelir Kaynağı", "ana_tur": "Gelir"}, {"id": "c_yenicotob", "ad": "Yenice Otobüs", "tur": "Gelir Kaynağı", "ana_tur": "Gelir"}, {"id": "c_caybahcesi", "ad": "Çay Bahçesi Kira", "tur": "Kira", "ana_tur": "Gelir"}, {"id": "c_sostasc", "ad": "Yenice Sosyal Tesis", "tur": "Gelir Kaynağı", "ana_tur": "Gelir"}, {"id": "c_turanmetal", "ad": "Turan Metal", "tur": "Sponsor", "ana_tur": "Gelir"}, {"id": "c_burakseymen", "ad": "Burak Seymen", "tur": "Sponsor", "ana_tur": "Gelir"}, {"id": "c_altin", "ad": "Kıymetli Maden / Altın", "tur": "Kıymetli Maden", "ana_tur": "Gelir"}, {"id": "c_erdinc", "ad": "Malzemeci Erdinç", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_aytemur", "ad": "Malzemeci Aytemur", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_korayspor", "ad": "Koray Spor", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_vizyon", "ad": "Vizyon", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_elektrik", "ad": "Elektrik Faturası", "tur": "Faturalar", "ana_tur": "Masraf"}, {"id": "c_lisans", "ad": "Lisans Giderleri", "tur": "Resmi Gider", "ana_tur": "Masraf"}, {"id": "c_atletizm", "ad": "Atletizm Giderleri", "tur": "Atletizm", "ana_tur": "Masraf"}, {"id": "c_yakit", "ad": "Yakıt / Ulaşım", "tur": "Ulaşım", "ana_tur": "Masraf"}, {"id": "c_hakem", "ad": "Hakem Ücretleri", "tur": "Hakem", "ana_tur": "Masraf"}, {"id": "c_temizlik", "ad": "Temizlik / Personel", "tur": "Personel Gideri", "ana_tur": "Masraf"}, {"id": "c_banka", "ad": "Banka Masrafları", "tur": "Banka Gideri", "ana_tur": "Masraf"}, {"id": "c_cudicup", "ad": "Cudicup / Turnuva", "tur": "Resmi Gider", "ana_tur": "Masraf"}, {"id": "c_ahmetmestan", "ad": "Ahmet Mestan (Sosyal Medya)", "tur": "Tanıtım", "ana_tur": "Masraf"}, {"id": "c_noter", "ad": "Noter / Resmi İşlemler", "tur": "Resmi Gider", "ana_tur": "Masraf"}, {"id": "c_megacarsi", "ad": "Mega Çarşı", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_ozdilek", "ad": "Özdilek", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "uye_001_ali_gormez", "ad": "Ali Görmez", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_002_huseyin_goztepe", "ad": "Hüseyin Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_003_muammer_alpsoy", "ad": "Muammer Alpsoy", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_004_kani_kont", "ad": "Kani Kont", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_005_hamdi_turan", "ad": "Hamdi Turan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_006_cafer_doyran", "ad": "Cafer Doyran", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_007_saban_icyer", "ad": "Şaban İçyer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_008_serdar_yigit", "ad": "Serdar Yiğit", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_009_saban_demirel", "ad": "Şaban Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_010_ibrahim_dursun", "ad": "İbrahim Dursun", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_011_yusuf_dere", "ad": "Yusuf Dere", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_012_sebahattin_goztepe", "ad": "Sebahattin Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_013_ibrahim_budakli", "ad": "İbrahim Budakli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_014_kemal_kircadere", "ad": "Kemal Kircadere", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_015_ibrahim_caliskan", "ad": "İbrahim Çalişkan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_016_hasan_rupcuz", "ad": "Hasan Rupçuz", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_017_mehmet_budakli", "ad": "Mehmet Budakli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_018_suleyman_iscen", "ad": "Süleyman İşçen", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_019_ozkan_evren", "ad": "Özkan Evren", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_020_ali_goztepe", "ad": "Ali Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_021_erdogan_goztepe", "ad": "Erdoğan Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_022_ogun_sencan", "ad": "Ogün Şencan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_023_harun_havanli", "ad": "Harun Havanli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_024_vedat_tepe", "ad": "Vedat Tepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_025_ali_enver_yazici", "ad": "Ali Enver Yazici", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_026_abdullah_arac", "ad": "Abdullah Araç", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_027_ismail_sargin", "ad": "İsmail Sargin", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_028_zekeriya_balkan", "ad": "Zekeriya Balkan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_029_huseyin_demiray", "ad": "Hüseyin Demiray", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_030_ibrahim_arabaci", "ad": "İbrahim Arabaci", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_031_ibrahim_akcan", "ad": "İbrahim Akcan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_032_ali_kurtcebe", "ad": "Ali Kurtcebe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_033_serafettin_aygun", "ad": "Şerafettin Aygün", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_034_eyyup_ocal", "ad": "Eyyüp Öcal", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_035_medi_kahyaoglu", "ad": "Medi Kahyaoğlu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_036_recep_demirel", "ad": "Recep Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_037_murat_tepe", "ad": "Murat Tepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_038_necmettin_inan", "ad": "Necmettin İnan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_039_coskun_akcan", "ad": "Çoşkun Akcan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_040_faik_icyer", "ad": "Faik İçyer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_041_hasan_aksu", "ad": "Hasan Aksu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_042_yasar_arslantas", "ad": "Yaşar Arslantaş", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_043_adnan_demirel", "ad": "Adnan Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_044_kenan_evren", "ad": "Kenan Evren", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_045_yusuf_dursun", "ad": "Yusuf Dursun", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_046_nebi_durgun", "ad": "Nebi Durgun", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_047_avni_sunger", "ad": "Avni Sünger", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_048_oguzhan_goztepe", "ad": "Oğuzhan Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_049_burak_seymen", "ad": "Burak Seymen", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_050_eray_senturk", "ad": "Eray Şentürk", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_051_ferhat_emirli", "ad": "Ferhat Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_052_aykut_demirel", "ad": "Aykut Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_053_deniz_icyer", "ad": "Deniz İçyer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_054_ismail_bicer", "ad": "İsmail Biçer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_055_emre_mutlu", "ad": "Emre Mutlu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_056_kenan_kilic", "ad": "Kenan Kiliç", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_057_yavuz_cakir", "ad": "Yavuz Çakir", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_058_sedat_emirli", "ad": "Sedat Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_059_ercan_arik", "ad": "Ercan Arik", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_060_mehmet_otaci", "ad": "Mehmet Otaci", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_061_mesut_emirli", "ad": "Mesut Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_062_salih_ufkun_toktas", "ad": "Salih Ufkun Toktaş", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_063_tuncay_simsek", "ad": "Tuncay Şimşek", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_064_zafer_demirel", "ad": "Zafer Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_065_anil_aksu", "ad": "Anil Aksu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_066_murat_emirli", "ad": "Murat Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_067_ibrahim_topcu", "ad": "İbrahim Topçu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_068_ibrahim_turker", "ad": "İbrahim Türker", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_069_fatih_bayar", "ad": "Fatih Bayar", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_070_ali_ihsan_turker", "ad": "Ali İhsan Türker", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_071_burak_koc", "ad": "Burak Koç", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_072_zeynel_kahyaoglu", "ad": "Zeynel Kahyaoğlu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_073_selim_bilim", "ad": "Selim Bilim", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_074_unal_aktas", "ad": "Ünal Aktaş", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_075_ercan_alayli", "ad": "Ercan Alayli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_076_ferit_fidan", "ad": "Ferit Fidan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_077_erdogan_senturk", "ad": "Erdoğan Şentürk", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_078_ismail_fidan", "ad": "İsmail Fidan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_079_hakan_keskin", "ad": "Hakan Keskin", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_080_faruk_almas", "ad": "Faruk Almas", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_081_omer_turker", "ad": "Ömer Türker", "tur": "Üye", "ana_tur": "Gelir"}];
  let ok=0, hata=0;
  for (let i=0; i<SEED.length; i+=20) {
    const batch = SEED.slice(i, i+20);
    try {
      const r = await fetch(SB_URL+"/rest/v1/ys_caris", {
        method:"POST",
        headers: { ...sbH(sbKey), "Prefer":"resolution=merge-duplicates" },
        body: JSON.stringify(batch)
      });
      if (r.ok) ok+=batch.length; else hata+=batch.length;
    } catch(e) { hata+=batch.length; }
  }
  return new Response(JSON.stringify({ok, hata, toplam: SEED.length}), {headers:{"Content-Type":"application/json"}});
}
