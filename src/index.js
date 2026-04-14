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

  if (url.pathname === "/seed-caris") {
    const sbKey = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;
    if (!sbKey) return new Response("Key eksik", {status:500});
    const SEED = [{"id": "yk_sebahattingöztepe", "ad": "Sebahattin Göztepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_alii̇hsantürker", "ad": "Ali İhsan Türker", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_fatihbayar", "ad": "Fatih Bayar", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_ercanalaylı", "ad": "Ercan Alaylı", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_vedattepe", "ad": "Vedat Tepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇brahimtopçu", "ad": "İbrahim Topçu", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_feritfidan", "ad": "Ferit Fidan", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_oğuzhangöztepe", "ad": "Oğuzhan Göztepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_burakkoç", "ad": "Burak Koç", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_selimbilim", "ad": "Selim Bilim", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_ünalaktaş", "ad": "Ünal Aktaş", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇smailfidan", "ad": "İsmail Fidan", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_burakseymen", "ad": "Burak Seymen", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇smailsargın", "ad": "İsmail Sargın", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_aligöztepe", "ad": "Ali Göztepe", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_salihufkuntaşkın", "ad": "Salih Ufkun Taşkın", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_i̇brahimtürker", "ad": "İbrahim Türker", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_zeynelkahyaoğlu", "ad": "Zeynel Kahyaoğlu", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_erdoğanşentürk", "ad": "Erdoğan Şentürk", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "yk_tuncayşimşek", "ad": "Tuncay Şimşek", "tur": "Yönetim Kurulu", "ana_tur": "Gelir"}, {"id": "fut_duhançağlarakdağ", "ad": "Duhan Çağlar Akdağ", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_furkanyenitürk", "ad": "Furkan Yenitürk", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_serkancan", "ad": "Serkan Can", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_ömerfarukşenkan", "ad": "Ömer Faruk Şenkan", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_erolelibol", "ad": "Erol Elibol", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_efekorucu", "ad": "Efe Korucu", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_melihdursun", "ad": "Melih Dursun", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_yusufkoç", "ad": "Yusuf Koç", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_erkani̇larslan", "ad": "Erkan İlarslan", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_hamzatürkmen", "ad": "Hamza Türkmen", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_özgürözgöçmen", "ad": "Özgür Özgöçmen", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_mtalhaüz", "ad": "M. Talha Üz", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_selimatış", "ad": "Selim Atış", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_ufukyenisoy", "ad": "Ufuk Yenisoy", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_gökhanyıldırım", "ad": "Gökhan Yıldırım", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_ardaseber", "ad": "Arda Seber", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_alişakiri", "ad": "Ali Şakiri", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_arifbuğrapaşay", "ad": "Arif Buğra Paşay", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_eyyüpensardoğan", "ad": "Eyyüp Ensar Doğan", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_yasirboz", "ad": "Yasir Boz", "tur": "Futbolcu", "ana_tur": "Gider"}, {"id": "fut_emregüzen", "ad": "EMRE GÜZEN", "tur": "A Takım Antrenör", "ana_tur": "Gider"}, {"id": "fut_vahapşenol", "ad": "VAHAP ŞENOL", "tur": "A Takım Antrenör", "ana_tur": "Gider"}, {"id": "fut_altyapiantröner", "ad": "ALTYAPI ANTRÖNER", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_sadetti̇nsoydan", "ad": "SADETTİN SOYDAN", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_selçukkaymakçi", "ad": "SELÇUK KAYMAKÇI", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_abdullahalkuş", "ad": "ABDULLAH ALKUŞ", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_özgürçoşar", "ad": "ÖZGÜR ÇOŞAR", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "fut_necmetti̇ni̇nan", "ad": "NECMETTİN İNAN", "tur": "Altyapı Antrenör", "ana_tur": "Gider"}, {"id": "c_halisaha", "ad": "Halısaha", "tur": "Gelir Kaynağı", "ana_tur": "Gelir"}, {"id": "c_yenicotob", "ad": "Yenice Otobüs", "tur": "Gelir Kaynağı", "ana_tur": "Gelir"}, {"id": "c_caybahcesi", "ad": "Çay Bahçesi Kira", "tur": "Kira", "ana_tur": "Gelir"}, {"id": "c_sostasc", "ad": "Yenice Sosyal Tesis", "tur": "Gelir Kaynağı", "ana_tur": "Gelir"}, {"id": "c_turanmetal", "ad": "Turan Metal", "tur": "Sponsor", "ana_tur": "Gelir"}, {"id": "c_burakseymen", "ad": "Burak Seymen", "tur": "Sponsor", "ana_tur": "Gelir"}, {"id": "c_altin", "ad": "Kıymetli Maden / Altın", "tur": "Kıymetli Maden", "ana_tur": "Gelir"}, {"id": "c_erdinc", "ad": "Malzemeci Erdinç", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_aytemur", "ad": "Malzemeci Aytemur", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_korayspor", "ad": "Koray Spor", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_vizyon", "ad": "Vizyon", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_elektrik", "ad": "Elektrik Faturası", "tur": "Faturalar", "ana_tur": "Masraf"}, {"id": "c_lisans", "ad": "Lisans Giderleri", "tur": "Resmi Gider", "ana_tur": "Masraf"}, {"id": "c_atletizm", "ad": "Atletizm Giderleri", "tur": "Atletizm", "ana_tur": "Masraf"}, {"id": "c_yakit", "ad": "Yakıt / Ulaşım", "tur": "Ulaşım", "ana_tur": "Masraf"}, {"id": "c_hakem", "ad": "Hakem Ücretleri", "tur": "Hakem", "ana_tur": "Masraf"}, {"id": "c_temizlik", "ad": "Temizlik / Personel", "tur": "Personel Gideri", "ana_tur": "Masraf"}, {"id": "c_banka", "ad": "Banka Masrafları", "tur": "Banka Gideri", "ana_tur": "Masraf"}, {"id": "c_cudicup", "ad": "Cudicup / Turnuva", "tur": "Resmi Gider", "ana_tur": "Masraf"}, {"id": "c_ahmetmestan", "ad": "Ahmet Mestan (Sosyal Medya)", "tur": "Tanıtım", "ana_tur": "Masraf"}, {"id": "c_noter", "ad": "Noter / Resmi İşlemler", "tur": "Resmi Gider", "ana_tur": "Masraf"}, {"id": "c_megacarsi", "ad": "Mega Çarşı", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "c_ozdilek", "ad": "Özdilek", "tur": "Malzeme", "ana_tur": "Gider"}, {"id": "uye_001_ali_gormez", "ad": "Ali Görmez", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_002_huseyin_goztepe", "ad": "Hüseyin Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_003_muammer_alpsoy", "ad": "Muammer Alpsoy", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_004_kani_kont", "ad": "Kani Kont", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_005_hamdi_turan", "ad": "Hamdi Turan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_006_cafer_doyran", "ad": "Cafer Doyran", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_007_saban_icyer", "ad": "Şaban İçyer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_008_serdar_yigit", "ad": "Serdar Yiğit", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_009_saban_demirel", "ad": "Şaban Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_010_ibrahim_dursun", "ad": "İbrahim Dursun", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_011_yusuf_dere", "ad": "Yusuf Dere", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_012_sebahattin_goztepe", "ad": "Sebahattin Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_013_ibrahim_budakli", "ad": "İbrahim Budakli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_014_kemal_kircadere", "ad": "Kemal Kircadere", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_015_ibrahim_caliskan", "ad": "İbrahim Çalişkan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_016_hasan_rupcuz", "ad": "Hasan Rupçuz", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_017_mehmet_budakli", "ad": "Mehmet Budakli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_018_suleyman_iscen", "ad": "Süleyman İşçen", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_019_ozkan_evren", "ad": "Özkan Evren", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_020_ali_goztepe", "ad": "Ali Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_021_erdogan_goztepe", "ad": "Erdoğan Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_022_ogun_sencan", "ad": "Ogün Şencan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_023_harun_havanli", "ad": "Harun Havanli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_024_vedat_tepe", "ad": "Vedat Tepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_025_ali_enver_yazici", "ad": "Ali Enver Yazici", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_026_abdullah_arac", "ad": "Abdullah Araç", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_027_ismail_sargin", "ad": "İsmail Sargin", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_028_zekeriya_balkan", "ad": "Zekeriya Balkan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_029_huseyin_demiray", "ad": "Hüseyin Demiray", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_030_ibrahim_arabaci", "ad": "İbrahim Arabaci", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_031_ibrahim_akcan", "ad": "İbrahim Akcan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_032_ali_kurtcebe", "ad": "Ali Kurtcebe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_033_serafettin_aygun", "ad": "Şerafettin Aygün", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_034_eyyup_ocal", "ad": "Eyyüp Öcal", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_035_medi_kahyaoglu", "ad": "Medi Kahyaoğlu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_036_recep_demirel", "ad": "Recep Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_037_murat_tepe", "ad": "Murat Tepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_038_necmettin_inan", "ad": "Necmettin İnan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_039_coskun_akcan", "ad": "Çoşkun Akcan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_040_faik_icyer", "ad": "Faik İçyer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_041_hasan_aksu", "ad": "Hasan Aksu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_042_yasar_arslantas", "ad": "Yaşar Arslantaş", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_043_adnan_demirel", "ad": "Adnan Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_044_kenan_evren", "ad": "Kenan Evren", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_045_yusuf_dursun", "ad": "Yusuf Dursun", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_046_nebi_durgun", "ad": "Nebi Durgun", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_047_avni_sunger", "ad": "Avni Sünger", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_048_oguzhan_goztepe", "ad": "Oğuzhan Göztepe", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_049_burak_seymen", "ad": "Burak Seymen", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_050_eray_senturk", "ad": "Eray Şentürk", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_051_ferhat_emirli", "ad": "Ferhat Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_052_aykut_demirel", "ad": "Aykut Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_053_deniz_icyer", "ad": "Deniz İçyer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_054_ismail_bicer", "ad": "İsmail Biçer", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_055_emre_mutlu", "ad": "Emre Mutlu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_056_kenan_kilic", "ad": "Kenan Kiliç", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_057_yavuz_cakir", "ad": "Yavuz Çakir", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_058_sedat_emirli", "ad": "Sedat Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_059_ercan_arik", "ad": "Ercan Arik", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_060_mehmet_otaci", "ad": "Mehmet Otaci", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_061_mesut_emirli", "ad": "Mesut Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_062_salih_ufkun_toktas", "ad": "Salih Ufkun Toktaş", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_063_tuncay_simsek", "ad": "Tuncay Şimşek", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_064_zafer_demirel", "ad": "Zafer Demirel", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_065_anil_aksu", "ad": "Anil Aksu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_066_murat_emirli", "ad": "Murat Emirli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_067_ibrahim_topcu", "ad": "İbrahim Topçu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_068_ibrahim_turker", "ad": "İbrahim Türker", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_069_fatih_bayar", "ad": "Fatih Bayar", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_070_ali_ihsan_turker", "ad": "Ali İhsan Türker", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_071_burak_koc", "ad": "Burak Koç", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_072_zeynel_kahyaoglu", "ad": "Zeynel Kahyaoğlu", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_073_selim_bilim", "ad": "Selim Bilim", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_074_unal_aktas", "ad": "Ünal Aktaş", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_075_ercan_alayli", "ad": "Ercan Alayli", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_076_ferit_fidan", "ad": "Ferit Fidan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_077_erdogan_senturk", "ad": "Erdoğan Şentürk", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_078_ismail_fidan", "ad": "İsmail Fidan", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_079_hakan_keskin", "ad": "Hakan Keskin", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_080_faruk_almas", "ad": "Faruk Almas", "tur": "Üye", "ana_tur": "Gelir"}, {"id": "uye_081_omer_turker", "ad": "Ömer Türker", "tur": "Üye", "ana_tur": "Gelir"}];
    let ok=0, hata=0;
    // 20'li batch
    for (let i=0; i<SEED.length; i+=20) {
      const batch = SEED.slice(i, i+20);
      try {
        const r = await fetch(SB_URL+"/rest/v1/ys_caris", {
          method:"POST",
          headers: {...sbHeaders(sbKey), "Prefer":"resolution=merge-duplicates"},
          body: JSON.stringify(batch)
        });
        if (r.ok) ok+=batch.length; else hata+=batch.length;
      } catch(e) { hata+=batch.length; }
    }
    return new Response(JSON.stringify({ok, hata, toplam: SEED.length}), {headers:{"Content-Type":"application/json"}});
  }
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
