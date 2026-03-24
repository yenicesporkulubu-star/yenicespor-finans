-- ys_wa_logs: WhatsApp webhook mesaj logları
-- Supabase SQL Editor'da çalıştır

create table if not exists ys_wa_logs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  tarih         date,
  msg_id        text unique,               -- WhatsApp mesaj ID (duplicate önlemi)
  gonderen      text,                       -- telefon numarası
  gonderen_ad   text,                       -- WhatsApp profil adı
  metin         text,                       -- ham mesaj içeriği
  durum         text,                       -- 'işlendi' | 'parse_hatası' | 'atlandı' | 'tx_hatası'
  hata          text,                       -- hata açıklaması (varsa)
  cari_id       text,                       -- eşleşen/oluşturulan cari
  cari_ad       text,
  tutar         numeric,
  islem_tipi    text,                       -- 'GELIR' | 'GIDER'
  kasa          text,                       -- 'NAKİT' | 'BANKA'
  tx_id         uuid references ys_transactions(id) on delete set null,
  yeni_cari     boolean default false       -- otomatik cari oluşturuldu mu
);

-- Anon key okuma/yazma izni (RLS kapalıysa gerek yok)
alter table ys_wa_logs enable row level security;

create policy "anon okuma" on ys_wa_logs
  for select using (true);

create policy "anon yazma" on ys_wa_logs
  for insert with check (true);

-- İndeks: msg_id duplicate hızlı kontrol
create index if not exists idx_wa_logs_msg_id on ys_wa_logs(msg_id);
create index if not exists idx_wa_logs_tarih  on ys_wa_logs(tarih desc);
create index if not exists idx_wa_logs_durum  on ys_wa_logs(durum);
