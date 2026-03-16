const fs = require('fs');
const {execSync} = require('child_process');
const html = fs.readFileSync('./index.html', 'utf8');

const errors = [];
const warnings = [];

// ── REGRESYON KONTROLÜ: Önceki commit'te olan şeyler hâlâ var mı? ──
try {
  const prev = execSync('git show HEAD:index.html 2>/dev/null', {encoding:'utf8'});

  // Kritik id'ler eksildi mi?
  const prevIds = new Set([...prev.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  const currIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  const kritikPrefixler = ['tab-','kpi','kasa','mhSek-','mh-tab-'];
  for(const id of prevIds){
    if(!currIds.has(id) && kritikPrefixler.some(p=>id.startsWith(p))){
      errors.push(`REGRESYON: id="${id}" önceki sürümde vardı, şimdi yok`);
    }
  }

  // Kritik fonksiyonlar silindi mi?
  const prevFns = new Set([...prev.matchAll(/function ([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m=>m[1]));
  const currFns = new Set([...html.matchAll(/function ([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m=>m[1]));
  const kritikFnler = ['renderDashboard','renderKasaTx','renderVarliklar',
    'loadAll','showTab','saveTx','loadSozlesmeler','renderButce','loadMuhasebe',
    'hesaplaKasaBakiyeleri','renderGelirTablosuMh','renderBilancoMh','renderMizan',
    'renderYevmiye','showAlacakDetay','showBorcDetay'];
  for(const fn of kritikFnler){
    if(prevFns.has(fn) && !currFns.has(fn)){
      errors.push(`REGRESYON: function ${fn}() silindi`);
    }
  }

  // Nav sekmeleri eksildi mi?
  const prevTabs = [...prev.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]);
  const currTabs = new Set([...html.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]));
  for(const tab of prevTabs){
    if(!currTabs.has(tab)) errors.push(`REGRESYON: data-tab="${tab}" silindi`);
  }

  // Modallar eksildi mi?
  const prevModals = [...prev.matchAll(/id="([^"]+Modal)"/g)].map(m=>m[1]);
  const currModals = new Set([...html.matchAll(/id="([^"]+Modal)"/g)].map(m=>m[1]));
  for(const m of prevModals){
    if(!currModals.has(m)) errors.push(`REGRESYON: Modal id="${m}" silindi`);
  }

} catch(e) { /* ilk commit */ }

// 1. JS syntax kontrolü — node ile parse et
const scriptStart = html.lastIndexOf('<script>');
const scriptEnd = html.lastIndexOf('</script>');
if(scriptStart > -1 && scriptEnd > scriptStart){
  const jsContent = html.slice(scriptStart + 8, scriptEnd);
  const tmpFile = '/tmp/ys_check_' + Date.now() + '.js';
  fs.writeFileSync(tmpFile, jsContent);
  try {
    execSync(`node --check ${tmpFile} 2>&1`, {encoding:'utf8'});
    fs.unlinkSync(tmpFile);
  } catch(e) {
    fs.unlinkSync(tmpFile);
    const msg = (e.stdout||e.message||'').split('\n').filter(l=>l.trim()).slice(0,3).join(' | ');
    errors.push('JS SYNTAX HATASI: ' + msg);
  }
}


// 2. onclick/getElementById null riski — element HTML'de yoksa JS'de .onclick atama
// istisna: dinamik olarak openModal() içinde oluşturulan elementler (impGo vb.)
const DINAMIK_ELEMENTLER = new Set(['impGo']);
const onclickAssigns = [...html.matchAll(/document\.getElementById\("([^"]+)"\)\.onclick/g)];
onclickAssigns.forEach(([,id])=>{
  if(DINAMIK_ELEMENTLER.has(id)) return; // dinamik element, atla
  if(!html.includes(`id="${id}"`)) errors.push(`NULL HATA RİSKİ: getElementById("${id}").onclick — element HTML'de yok`);
});

// 3. Tüm showTab çağrılarında hedef section var mı
const showTabCalls = [...html.matchAll(/showTab\(['"]([^'"]+)['"]\)/g)];
showTabCalls.forEach(([,tab])=>{
  if(!html.includes(`id="tab-${tab}"`)) errors.push(`showTab("${tab}") çağrısı var ama id="tab-${tab}" section yok`);
});

// 4. Nav butonlarının tab hedefleri section olarak var mı
const navTabs = [...html.matchAll(/data-tab="([^"]+)"/g)];
navTabs.forEach(([,tab])=>{
  if(!html.includes(`id="tab-${tab}"`)) errors.push(`Nav data-tab="${tab}" var ama id="tab-${tab}" section yok`);
});

// 5. Supabase'e gönderilen alanlar — kaynak, urun, adet yasak
const sbPostCalls = [...html.matchAll(/sb\.post\([^)]+\{([^}]+)\}/g)];
sbPostCalls.forEach(([match])=>{
  if(match.includes('kaynak:')&&match.includes('ys_transactions')) errors.push(`ys_transactions'a yasak 'kaynak' alanı gönderiliyor`);
  if(match.includes('urun:')) errors.push(`Tabloya yasak 'urun' alanı gönderiliyor`);
  if(match.includes('adet:')) errors.push(`Tabloya yasak 'adet' alanı gönderiliyor`);
  if(match.includes('cari_id:')&&!match.includes('cari_temp_id')) errors.push(`'cari_id' kullanılıyor, 'cari_temp_id' olmalı`);
});

// 6. Tüm onclick="fn()" çağrılarında fn tanımlı mı
const onclickFns = [...html.matchAll(/onclick="([a-zA-Z_][a-zA-Z0-9_]*)\(/g)];
const definedFns = new Set([...html.matchAll(/function ([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m=>m[1]));
onclickFns.forEach(([,fn])=>{
  if(!definedFns.has(fn)) warnings.push(`onclick="${fn}()" — fonksiyon tanımı bulunamadı`);
});

// 7. Açık modal/section sayısı dengesi
const modalOverlays = (html.match(/class="modal-overlay"/g)||[]).length;
const modalCloses = (html.match(/closeModal\(/g)||[]).length;
if(modalCloses < modalOverlays) warnings.push(`${modalOverlays} modal var ama sadece ${modalCloses} closeModal çağrısı — bazı modaller kapatılamıyor olabilir`);

// 8. hesaplaKasaBakiyeleri dışında bağımsız kasa hesaplama var mı
const bagimsizKasa = [...html.matchAll(/const kasaG2=\{\}/g)];
if(bagimsizKasa.length > 0) warnings.push(`${bagimsizKasa.length} yerde 'kasaG2={}' bağımsız kasa hesaplama — hesaplaKasaBakiyeleri() kullan`);

// 9. KASA_LIST ile senkron
const kasaListMatch = html.match(/const KASA_LIST = \[([^\]]+)\]/);
if(kasaListMatch){
  const kasalar = kasaListMatch[1].match(/"([^"]+)"/g)||[];
  // KASA_HESAP eşleştirmesi
  kasalar.forEach(k=>{
    const kasa=k.replace(/"/g,'');
    if(!['DİĞER'].includes(kasa) && !html.includes(`"${kasa}"`+':')) {
      // sadece bilgilendirme
    }
  });
}

// 10. renderMuhasebe vs muhasebeTab senkron
['yevmiye','mizan','gelirtab','bilanco','hesapplan'].forEach(s=>{
  if(!html.includes(`mhSek-${s}`)) errors.push(`muhasebeTab alt sekmesi eksik: mhSek-${s}`);
  if(!html.includes(`mh-tab-${s}`)) errors.push(`muhasebeTab butonu eksik: mh-tab-${s}`);
});

// SONUÇ
console.log('\n══════════════════════════════════════');
console.log('  PRE-PUSH KONTROL RAPORU');
console.log('══════════════════════════════════════');
if(errors.length===0 && warnings.length===0){
  console.log('✅ Tüm kontroller geçti — push güvenli\n');
  process.exit(0);
} else {
  errors.forEach(e=>console.log('❌ HATA: '+e));
  warnings.forEach(w=>console.log('⚠️  UYARI: '+w));
  console.log(`\n${errors.length} hata, ${warnings.length} uyarı`);
  if(errors.length>0){ console.log('🚫 PUSH YAPILMADI\n'); process.exit(1); }
  else { console.log('⚠️  Uyarılarla devam ediliyor\n'); process.exit(0); }
}
