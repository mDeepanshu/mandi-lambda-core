-- Persistent cache for text-to-speech audio clips.
--
-- The auction UI announces vasuli entries in Hindi ("व्यापारी जिनका आई डी नंबर
-- बयालीस के लिए तीन हज़ार पांच सौ रुपये जमा हुए"). It used to call the Sarvam
-- TTS API from the browser for every announcement, with an in-memory Map that
-- died on every page reload — so the same phrases were paid for and re-fetched
-- all day long, and the API key shipped inside the JS bundle.
--
-- Instead we store a CLOSED ALPHABET of clips and concatenate them at playback:
--
--   0-99                     100 clips  (Hindi 2-digit words are all irregular)
--   सौ / हज़ार / लाख / करोड़      4 clips  (everything above 99 is compositional)
--   fixed phrases + रुपये      ~10 clips
--
-- ~115 clips cover EVERY rupee amount up to 9,99,99,999, so after one seeding
-- run the runtime TTS cost is zero and announcements work fully offline.
--
-- Audio bytes live in a public Storage bucket (CDN-cached, never touches a
-- Lambda on the hot path); this table is just the manifest the client reads.
begin;

create table if not exists tts_clip (
  id           bigint generated always as identity primary key,
  -- exact text handed to the TTS engine; also the client-side lookup key
  token        text        not null,
  -- speaker + language the clip was rendered with, so several voices can
  -- coexist and the client can ask for one consistent set
  voice        text        not null default 'aditya',
  lang         text        not null default 'hi-IN',
  -- path inside the `tts` storage bucket, e.g. 'hi-IN/aditya/<sha1>.wav'
  storage_path text        not null,
  duration_ms  int,
  sample_rate  int,
  byte_size    int,
  created_at   timestamptz not null default now(),

  constraint tts_clip_token_voice_lang_key unique (token, voice, lang)
);

-- the manifest read: every clip for one voice, in one shot
create index if not exists idx_tts_clip_voice_lang
  on tts_clip (voice, lang);

-- Public read-only bucket. Public because the clips are generic Hindi numerals
-- and phrases — no party, amount or bill data is encoded in them — and serving
-- them straight off the CDN is what makes preloading ~115 files fast.
insert into storage.buckets (id, name, public)
values ('tts', 'tts', true)
on conflict (id) do update set public = true;

commit;
