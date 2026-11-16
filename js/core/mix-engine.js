/**
 * Lokalny silnik rekomendacji miksu i masteringu („AI” oparte na regułach).
 *
 * Wszystko liczy się na urządzeniu: nie wysyłamy tekstów, nagrań ani notatek
 * do żadnego zewnętrznego modelu. Ten sam zestaw danych wejściowych daje ten
 * sam plan (brak losowości), co pozwala sprawdzać wynik testami regresyjnymi.
 *
 * Łańcuchy FX są generowane jako pliki .RfxChain dla REAPERa (lista chunków
 * VST). Plik zawiera nazwy wtyczek i kolejność — REAPER dopasowuje wtyczkę po
 * nazwie, a brakującą pokazuje jako niedostępną. Ustawienia z planu służą do
 * ustawienia parametrów w oknie wtyczki.
 */

import { ValidationError } from './errors.js';
import * as validate from './validate.js';

export const PLAN_FORMAT = 'bsxs.mixplan';
export const PLAN_VERSION = 1;
export const PACK_FORMAT = 'bsxs.fxchain.pack';
export const PACK_VERSION = 1;
export const FX_CHAIN_EXTENSION = '.RfxChain';

export const PLATFORMS = {
  streaming: { label: 'Spotify / streaming', lufs: -14, truePeak: -1 },
  youtube: { label: 'YouTube', lufs: -14, truePeak: -1 },
  apple: { label: 'Apple Music', lufs: -16, truePeak: -1 },
  club: { label: 'Klub / DJ (głośniej)', lufs: -9, truePeak: -0.8 },
  tiktok: { label: 'TikTok / Reels (głośniej)', lufs: -10, truePeak: -1 }
};

export const STYLES = {
  trap: {
    label: 'Trap / nowoczesny',
    tuning: '5–10 (słyszalny efekt)',
    humanize: '0–20',
    attack: '3 ms',
    release: '80 ms',
    air: '+1,5 dB @ 3 kHz',
    saturation: '4/10',
    glue: '2:1',
    advice: 'Wokal na przodzie, ale 808 nie może maskować stopy — sidechain lub wycięcie 60–80 Hz w stopie.'
  },
  drill: {
    label: 'Drill',
    tuning: '5–10',
    humanize: '0–10',
    attack: '2 ms',
    release: '60 ms',
    air: '+1 dB @ 2,5 kHz',
    saturation: '5/10',
    glue: '3:1',
    advice: 'Ciemniejszy, agresywny wokal — kontrola sybilantów i mocny limiter na masterze.'
  },
  boombap: {
    label: 'Boom-bap',
    tuning: '20–30 (naturalnie)',
    humanize: '30–45',
    attack: '8 ms',
    release: '120 ms',
    air: '+0,8 dB @ 4 kHz',
    saturation: '3/10',
    glue: '2:1',
    advice: 'Zostaw dynamikę — mniej kompresji, więcej środka pasma i ciepłej saturacji zamiast głośności.'
  },
  melodic: {
    label: 'Melodyjny / R&B',
    tuning: '10–20',
    humanize: '20–30',
    attack: '5 ms',
    release: '100 ms',
    air: '+1,2 dB @ 6 kHz',
    saturation: '3/10',
    glue: '2:1',
    advice: 'Wokal i chórki tłem — pilnuj, żeby pogłos nie zabierał czytelności w środku pasma.'
  },
  afro: {
    label: 'Afro / amapiano',
    tuning: '10–20',
    humanize: '20–30',
    attack: '5 ms',
    release: '100 ms',
    air: '+1,5 dB @ 2 kHz',
    saturation: '3/10',
    glue: '2:1',
    advice: 'Wokal ciepły i blisko mikrofonu, dużo miejsca na perkusję — dół zostaw dla log drumów.'
  },
  phonk: {
    label: 'Phonk',
    tuning: '0–5 (mocny efekt)',
    humanize: '0–10',
    attack: '2 ms',
    release: '50 ms',
    air: '+2 dB @ 3,5 kHz',
    saturation: '6/10',
    glue: '3:1',
    advice: 'Celowo brudny, telefoniczny wokal — saturacja i cięcie dołu zamiast czystości.'
  },
  rage: {
    label: 'Rage / pluggnb',
    tuning: '5–15',
    humanize: '10–20',
    attack: '3 ms',
    release: '70 ms',
    air: '+1,8 dB @ 5 kHz',
    saturation: '4/10',
    glue: '2:1',
    advice: 'Wokal szeroki i wysoko w miksie; reverb i delay na sendach, ale bez utraty czytelności.'
  }
};

const PREMIUM_PLUGINS = [
  {
    id: 'pro-r2',
    name: 'FabFilter Pro-R 2',
    vendor: 'FabFilter',
    category: 'Pogłos',
    format: 'VST3',
    file: 'FabFilter Pro-R 2.vst3',
    url: 'https://www.fabfilter.com/products/pro-r',
    why: 'Pogłos wysyłkowy na wokal — czytelna przestrzeń bez zamulania środka pasma.'
  },
  {
    id: 'pro-g',
    name: 'FabFilter Pro-G',
    vendor: 'FabFilter',
    category: 'Brama / ducking',
    format: 'VST3',
    file: 'FabFilter Pro-G.vst3',
    url: 'https://www.fabfilter.com/products/pro-g',
    why: 'Brama i ducking — sprząta tło wokalu i robi sidechain 808 od stopy.'
  },
  {
    id: 'timeless3',
    name: 'FabFilter Timeless 3',
    vendor: 'FabFilter',
    category: 'Delay',
    format: 'VST3',
    file: 'FabFilter Timeless 3.vst3',
    url: 'https://www.fabfilter.com/products/timeless',
    why: 'Delay z filtrem i modulacją — charakter na ad-libach i przejściach.'
  },
  {
    id: 'ssl-g',
    name: 'Waves SSL G-Channel',
    vendor: 'Waves',
    category: 'Kanał / bus',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/ssl-g-channel',
    why: 'Konsola SSL na wokalu i busie — szybki, znajomy charakter.'
  },
  {
    id: 'h-delay',
    name: 'Waves H-Delay',
    vendor: 'Waves',
    category: 'Delay',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/h-delay',
    why: 'Opóźnienie z filtrem — slap i ósemki w hookach.'
  },
  {
    id: 's1-imager',
    name: 'Waves S1 Stereo Imager',
    vendor: 'Waves',
    category: 'Stereo',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/s1-stereo-imager',
    why: 'Poszerzanie góry i chórków — dół zostaje w mono.'
  },
  {
    id: 'l2-max',
    name: 'Waves L2 Ultramaximizer',
    vendor: 'Waves',
    category: 'Limiter',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/l2-ultramaximizer',
    why: 'Klasyczny limiter — szybka głośność na masterze.'
  },
  {
    id: 'tune-rt',
    name: 'Waves Tune Real-Time',
    vendor: 'Waves',
    category: 'Strojenie wokalu',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/waves-tune-real-time',
    why: 'Tuning na żywo przy nagrywaniu — mniej poprawek po sesji.'
  },
  {
    id: 'ovox',
    name: 'Waves OVox',
    vendor: 'Waves',
    category: 'Kreacja wokalu',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/ovox-vocal-resynthesis',
    why: 'Wokal jako instrument — chórki i efekty bez dokładania nagrań.'
  },
  {
    id: 'bx-digital-v3',
    name: 'Plugin Alliance bx_digital V3',
    vendor: 'Plugin Alliance',
    category: 'Kanał / bus',
    format: 'VST3',
    file: 'bx_digital V3.vst3',
    url: 'https://www.plugin-alliance.com/',
    why: 'EQ z kontrolą mono poniżej 120 Hz — porządek w dole miksu.'
  },
  {
    id: 'bx-subsynth',
    name: 'Plugin Alliance bx_subsynth',
    vendor: 'Plugin Alliance',
    category: 'Dół / 808',
    format: 'VST3',
    file: 'bx_subsynth.vst3',
    url: 'https://www.plugin-alliance.com/',
    why: 'Dodaje subbas pod 808 bez rozmywania stopy.'
  },
  {
    id: 'crystallizer',
    name: 'Soundtoys Crystallizer',
    vendor: 'Soundtoys',
    category: 'Efekty / kreatywne',
    format: 'VST3',
    file: 'Crystallizer.vst3',
    url: 'https://www.soundtoys.com/product/crystallizer/',
    why: 'Reverse delay i granulacja na przejściach oraz ad-libach.'
  },
  {
    id: 'radiator',
    name: 'Soundtoys Radiator',
    vendor: 'Soundtoys',
    category: 'Saturacja',
    format: 'VST3',
    file: 'Radiator.vst3',
    url: 'https://www.soundtoys.com/product/radiator/',
    why: 'Lekka saturacja i kolor na wokalu oraz busie.'
  },
  {
    id: 'microshift',
    name: 'Soundtoys MicroShift',
    vendor: 'Soundtoys',
    category: 'Stereo',
    format: 'VST3',
    file: 'MicroShift.vst3',
    url: 'https://www.soundtoys.com/product/microshift/',
    why: 'Szerokie chórki i podwójne wokale z jednego nagrania.'
  },
  {
    id: 'sie-q',
    name: 'Soundtoys Sie-Q',
    vendor: 'Soundtoys',
    category: 'EQ',
    format: 'VST3',
    file: 'Sie-Q.vst3',
    url: 'https://www.soundtoys.com/product/sie-q/',
    why: 'Ciepły EQ do delikatnego dodania góry i środka.'
  },
  {
    id: 'valhalladelay',
    name: 'Valhalla Delay',
    vendor: 'Valhalla DSP',
    category: 'Delay',
    format: 'VST3',
    file: 'ValhallaDelay.vst3',
    url: 'https://valhalladsp.com/shop/delay/valhalla-delay/',
    why: 'Delay z trybami taśmy i pitch — nowoczesne ogony w hookach.'
  },
  {
    id: 'supermassive',
    name: 'Valhalla Supermassive',
    vendor: 'Valhalla DSP',
    category: 'Pogłos',
    format: 'VST3',
    file: 'ValhallaSupermassive.vst3',
    url: 'https://valhalladsp.com/shop/reverb/valhalla-supermassive/',
    why: 'Długie, filmowe pogłosy na przejścia i intra.'
  },
  {
    id: 'valhallaroom',
    name: 'ValhallaRoom',
    vendor: 'Valhalla DSP',
    category: 'Pogłos',
    format: 'VST3',
    file: 'ValhallaRoom.vst3',
    url: 'https://valhalladsp.com/shop/reverb/valhalla-room/',
    why: 'Naturalne pomieszczenie na wokalu — bez plastikowego brzmienia.'
  },
  {
    id: 'neutron',
    name: 'iZotope Neutron 5',
    vendor: 'iZotope',
    category: 'Kanał / bus',
    format: 'VST3',
    file: 'Neutron 5.vst3',
    url: 'https://www.izotope.com/en/products/neutron.html',
    why: 'Asystent kanału: EQ, kompresja i stereo w jednym oknie.'
  },
  {
    id: 'taip',
    name: 'Baby Audio TAIP',
    vendor: 'Baby Audio',
    category: 'Saturacja',
    format: 'VST3',
    file: 'Baby Audio TAIP.vst3',
    url: 'https://babyaud.io/taip',
    why: 'Taśmowa saturacja i kompresja — ciepło na bębnach i wokalu.'
  },
  {
    id: 'comeback-kid',
    name: 'Baby Audio Comeback Kid',
    vendor: 'Baby Audio',
    category: 'Delay',
    format: 'VST3',
    file: 'Baby Audio Comeback Kid.vst3',
    url: 'https://babyaud.io/comeback-kid',
    why: 'Delay z duckingiem — ogon nie zasłania wokalu.'
  },
  {
    id: 'parallel-aggression',
    name: 'Baby Audio Parallel Aggression',
    vendor: 'Baby Audio',
    category: 'Saturacja',
    format: 'VST3',
    file: 'Baby Audio Parallel Aggression.vst3',
    url: 'https://babyaud.io/parallel-aggression',
    why: 'Równoległa saturacja i kompresja — gęstość bez utraty punchu.'
  },
  {
    id: 'smooth-operator',
    name: 'Baby Audio Smooth Operator',
    vendor: 'Baby Audio',
    category: 'Dynamiczny EQ',
    format: 'VST3',
    file: 'Baby Audio Smooth Operator.vst3',
    url: 'https://babyaud.io/smooth-operator',
    why: 'Automatyczne wycinanie rezonansów na wokalu i sumie.'
  },
  {
    id: 'multipass',
    name: 'Kilohearts Multipass',
    vendor: 'Kilohearts',
    category: 'Efekty / kreatywne',
    format: 'VST3',
    file: 'Kilohearts Multipass.vst3',
    url: 'https://kilohearts.com/products/multipass',
    why: 'Wielopasmowy moduł efektów — własne chainy bez dokupowania kolejnych wtyczek.'
  },
  {
    id: 'faturator',
    name: 'Kilohearts Faturator',
    vendor: 'Kilohearts',
    category: 'Saturacja',
    format: 'VST3',
    file: 'Kilohearts Faturator.vst3',
    url: 'https://kilohearts.com/products/faturator',
    why: 'Tłusta saturacja 808 i basów z kontrolą stereo.'
  },
  {
    id: 'disperser',
    name: 'Kilohearts Disperser',
    vendor: 'Kilohearts',
    category: 'Efekty / kreatywne',
    format: 'VST3',
    file: 'Kilohearts Disperser.vst3',
    url: 'https://kilohearts.com/products/disperser',
    why: 'All-pass shaping — transjenty i „iskra” na stopie.'
  },
  {
    id: 'ott',
    name: 'Xfer OTT',
    vendor: 'Xfer Records',
    category: 'Kompresja wielopasmowa',
    format: 'VST3',
    file: 'OTT.vst3',
    url: 'https://xferrecords.com/freeware',
    why: 'Darmowy, agresywny kompresor wielopasmowy — klasyk nowoczesnego brzmienia.'
  },
  {
    id: 'lfo-tool',
    name: 'Xfer LFOTool',
    vendor: 'Xfer Records',
    category: 'Efekty / kreatywne',
    format: 'VST3',
    file: 'LFOTool.vst3',
    url: 'https://xferrecords.com/products/lfo-tool',
    why: 'Sidechain i modulacja — ducking 808 od stopy bez ręcznego rysowania.'
  },
  {
    id: 'oxford-limiter',
    name: 'Sonnox Oxford Limiter',
    vendor: 'Sonnox',
    category: 'Limiter',
    format: 'VST3',
    file: 'Oxford Limiter.vst3',
    url: 'https://www.sonnox.com/plugin/oxford-limiter',
    why: 'Alternatywny limiter z kontrolą True Peak i enhance.'
  },
  {
    id: 'kotelnikov',
    name: 'TDR Kotelnikov',
    vendor: 'Tokyo Dawn Records',
    category: 'Kompresja',
    format: 'VST3',
    file: 'TDR Kotelnikov.vst3',
    url: 'https://www.tokyodawn.net/tdr-kotelnikov/',
    why: 'Łagodna, czysta kompresja sumy — klejenie bez pompowania.'
  },
  {
    id: 'soothe2',
    name: 'oeksound soothe2',
    vendor: 'oeksound',
    category: 'Dynamiczny EQ',
    format: 'VST3',
    file: 'soothe2.vst3',
    url: 'https://oeksound.com/plugins/soothe2/',
    why: 'Usuwa ostrość i sybilanty w locie — ratunek dla agresywnych wokali.'
  },
  {
    id: 'rc-20',
    name: 'XLN Audio RC-20 Retro Color',
    vendor: 'XLN Audio',
    category: 'Kolor / taśma',
    format: 'VST3',
    file: 'RC-20 Retro Color.vst3',
    url: 'https://www.xlnaudio.com/products/addictive_fx/effect/rc-20_retro_color',
    why: 'Noise, wobble i taśma — charakter próbki i „starego” brzmienia.'
  },
  {
    id: 'god-particle',
    name: 'Cradle The God Particle',
    vendor: 'Cradle',
    category: 'Mastering',
    format: 'VST3',
    file: 'The God Particle.vst3',
    url: 'https://cradle.app/the-god-particle',
    why: 'Klejenie i głośność na sumie — szybki finisz miksu przed limiterem.'
  },
  {
    id: 'shaperbox',
    name: 'Cableguys ShaperBox 3',
    vendor: 'Cableguys',
    category: 'Efekty / kreatywne',
    format: 'VST3',
    file: 'ShaperBox 3.vst3',
    url: 'https://www.cableguys.com/shaperbox.html',
    why: 'Rytmiczne kształtowanie głośności, filtra i panoramy — ruch w podkładzie.'
  },
  {
    id: 'pro-q4',
    name: 'FabFilter Pro-Q 4',
    vendor: 'FabFilter',
    category: 'EQ',
    format: 'VST3',
    file: 'FabFilter Pro-Q 4.vst3',
    url: 'https://www.fabfilter.com/products/pro-q',
    why: 'Precyzyjne cięcie rezonansów i delikatna korekcja barwy na wokalu i busie.'
  },
  {
    id: 'pro-c2',
    name: 'FabFilter Pro-C 2',
    vendor: 'FabFilter',
    category: 'Kompresja',
    format: 'VST3',
    file: 'FabFilter Pro-C 2.vst3',
    url: 'https://www.fabfilter.com/products/pro-c',
    why: 'Kontrolowana kompresja wokalu i klejenie sumy bez utraty ataku.'
  },
  {
    id: 'pro-ds',
    name: 'FabFilter Pro-DS',
    vendor: 'FabFilter',
    category: 'De-esser',
    format: 'VST3',
    file: 'FabFilter Pro-DS.vst3',
    url: 'https://www.fabfilter.com/products/pro-ds',
    why: 'Usuwa sybilanty „s” i „sz” bez lizania barwy wokalu.'
  },
  {
    id: 'pro-mb',
    name: 'FabFilter Pro-MB',
    vendor: 'FabFilter',
    category: 'Kompresja wielopasmowa',
    format: 'VST3',
    file: 'FabFilter Pro-MB.vst3',
    url: 'https://www.fabfilter.com/products/pro-mb',
    why: 'Osobna kontrola dołu i góry — 808 i stopa bez walki o miejsce.'
  },
  {
    id: 'pro-l2',
    name: 'FabFilter Pro-L 2',
    vendor: 'FabFilter',
    category: 'Limiter',
    format: 'VST3',
    file: 'FabFilter Pro-L 2.vst3',
    url: 'https://www.fabfilter.com/products/pro-l',
    why: 'Limiter masterujący z kontrolą True Peak — głośność bez przesterów.'
  },
  {
    id: 'saturn2',
    name: 'FabFilter Saturn 2',
    vendor: 'FabFilter',
    category: 'Saturacja',
    format: 'VST3',
    file: 'FabFilter Saturn 2.vst3',
    url: 'https://www.fabfilter.com/products/saturn',
    why: 'Wielopasmowa saturacja: ciepło na dole i charakter na wokalu.'
  },
  {
    id: 'autotune-pro',
    name: 'Antares Auto-Tune Pro',
    vendor: 'Antares',
    category: 'Strojenie wokalu',
    format: 'VST3',
    file: 'Auto-Tune Pro.vst3',
    url: 'https://www.antarestech.com/products/auto-tune',
    why: 'Standardowy tuning w rapie — od naturalnej korekty do efektu trap.'
  },
  {
    id: 'cl76',
    name: 'Waves CLA-76',
    vendor: 'Waves',
    category: 'Kompresja',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/cla-76-compressor-limiter',
    why: 'Szybka, agresywna kompresja wokalu — klasyk na wokalu rapowym.'
  },
  {
    id: 'cl2a',
    name: 'Waves CLA-2A',
    vendor: 'Waves',
    category: 'Kompresja',
    format: 'VST3',
    file: 'WaveShell1-VST3.vst3',
    url: 'https://www.waves.com/plugins/cla-2a-compressor-limiter',
    why: 'Łagodna, optyczna kompresja — wyrównanie głośności zwrotek.'
  },
  {
    id: 'ssl4000',
    name: 'Plugin Alliance bx_console SSL 4000 E',
    vendor: 'Plugin Alliance',
    category: 'Kanał / bus',
    format: 'VST3',
    file: 'bx_console SSL 4000 E.vst3',
    url: 'https://www.plugin-alliance.com/',
    why: 'Charakter konsoli SSL na sumie — klejenie miksu i ogólny „kolor”.'
  },
  {
    id: 'masterdesk',
    name: 'Plugin Alliance bx_masterdesk',
    vendor: 'Plugin Alliance',
    category: 'Mastering',
    format: 'VST3',
    file: 'bx_masterdesk.vst3',
    url: 'https://www.plugin-alliance.com/',
    why: 'Szybki mastering: korekcja, kompresja i limiter w jednym oknie.'
  },
  {
    id: 'decapitator',
    name: 'Soundtoys Decapitator',
    vendor: 'Soundtoys',
    category: 'Saturacja',
    format: 'VST3',
    file: 'Decapitator.vst3',
    url: 'https://www.soundtoys.com/product/decapitator/',
    why: 'Lekka saturacja wokalu, żeby przebił się przez beat.'
  },
  {
    id: 'alterboy',
    name: 'Soundtoys Little AlterBoy',
    vendor: 'Soundtoys',
    category: 'Kreacja wokalu',
    format: 'VST3',
    file: 'LittleAlterBoy.vst3',
    url: 'https://www.soundtoys.com/product/little-alterboy/',
    why: 'Ad-liby i chórki: zmiana formantu i wysokości bez nagrywania od nowa.'
  },
  {
    id: 'echoboy',
    name: 'Soundtoys EchoBoy',
    vendor: 'Soundtoys',
    category: 'Delay',
    format: 'VST3',
    file: 'EchoBoy.vst3',
    url: 'https://www.soundtoys.com/product/echoboy/',
    why: 'Delay na osobnym sendzie — przestrzeń bez zamulania wokalu.'
  },
  {
    id: 'vintageverb',
    name: 'Valhalla VintageVerb',
    vendor: 'Valhalla DSP',
    category: 'Pogłos',
    format: 'VST3',
    file: 'ValhallaVintageVerb.vst3',
    url: 'https://valhalladsp.com/shop/reverb/valhalla-vintage-verb/',
    why: 'Pogłos na sendach — tanie, lekkie i wystarczające do rapu.'
  },
  {
    id: 'ozone',
    name: 'iZotope Ozone 11',
    vendor: 'iZotope',
    category: 'Mastering',
    format: 'VST3',
    file: 'Ozone 11.vst3',
    url: 'https://www.izotope.com/en/products/ozone.html',
    why: 'Kompletny mastering z asystentem — szybki start dla własnych wydań.'
  },
  {
    id: 'rx',
    name: 'iZotope RX 11',
    vendor: 'iZotope',
    category: 'Naprawa nagrań',
    format: 'VST3',
    file: 'RX 11.vst3',
    url: 'https://www.izotope.com/en/products/rx.html',
    why: 'Odszumianie i usuwanie oddechów z wokalu przed miksem.'
  },
  {
    id: 'nova',
    name: 'TDR Nova',
    vendor: 'Tokyo Dawn Records',
    category: 'Dynamiczny EQ',
    format: 'VST3',
    file: 'TDR Nova.vst3',
    url: 'https://www.tokyodawn.net/tdr-nova/',
    why: 'Dynamiczna korekcja — wycina tylko wtedy, gdy pasmo przeszkadza.'
  },
  {
    id: 'inflator',
    name: 'Sonnox Oxford Inflator',
    vendor: 'Sonnox',
    category: 'Głośność / kolor',
    format: 'VST3',
    file: 'Oxford Inflator.vst3',
    url: 'https://www.sonnox.com/plugin/oxford-inflator',
    why: 'Dodaje gęstości i głośności bez typowego „pompowania” limitera.'
  },
  {
    id: 'serum',
    name: 'Xfer Serum',
    vendor: 'Xfer Records',
    category: 'Instrument',
    format: 'VST3',
    file: 'Serum.vst3',
    url: 'https://xferrecords.com/products/serum',
    why: 'Najczęstsza synteza w nowoczesnym rapie — basy, pluki, leady.'
  },
  {
    id: 'phaseplant',
    name: 'Kilohearts Phase Plant',
    vendor: 'Kilohearts',
    category: 'Instrument',
    format: 'VST3',
    file: 'Phase Plant.vst3',
    url: 'https://kilohearts.com/products/phase_plant',
    why: 'Elastyczna synteza do 808, padów i efektów.'
  },
  {
    id: 'kontakt',
    name: 'Native Instruments Kontakt 7',
    vendor: 'Native Instruments',
    category: 'Instrument',
    format: 'VST3',
    file: 'Kontakt 7.vst3',
    url: 'https://www.native-instruments.com/en/products/komplete/samplers/kontakt-7/',
    why: 'Banki brzmień, sample i instrumenty akustyczne w produkcjach.'
  },
  {
    id: 'crystalline',
    name: 'Baby Audio Crystalline',
    vendor: 'Baby Audio',
    category: 'Pogłos',
    format: 'VST3',
    file: 'Baby Audio Crystalline.vst3',
    url: 'https://babyaud.io/crystalline',
    why: 'Nowoczesny, czysty pogłos do wokali i ad-libów.'
  }
];

const STOCK_PLUGINS = [
  {
    id: 'rea-gate',
    name: 'ReaGate',
    vendor: 'Cockos',
    category: 'Brama / ducking',
    format: 'VST',
    file: 'reagate.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowana brama — sprząta szum i tło między wersami.'
  },
  {
    id: 'rea-tune',
    name: 'ReaTune',
    vendor: 'Cockos',
    category: 'Strojenie wokalu',
    format: 'VST',
    file: 'reatune.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany tuner i korekta wysokości — działa bez zakupów.'
  },
  {
    id: 'rea-verb',
    name: 'ReaVerb',
    vendor: 'Cockos',
    category: 'Pogłos',
    format: 'VST',
    file: 'reaverb.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany pogłos na sendach — wystarcza do demo i szybkich miksów.'
  },
  {
    id: 'rea-pitch',
    name: 'ReaPitch',
    vendor: 'Cockos',
    category: 'Kreacja wokalu',
    format: 'VST',
    file: 'reapitch.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowana zmiana wysokości i formantu — ad-liby bez dodatków.'
  },
  {
    id: 'rea-fir',
    name: 'ReaFIR',
    vendor: 'Cockos',
    category: 'EQ',
    format: 'VST',
    file: 'reafir.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany EQ i redukcja szumu oparta na FFT.'
  },
  {
    id: 'rea-eq',
    name: 'ReaEQ',
    vendor: 'Cockos',
    category: 'EQ',
    format: 'VST',
    file: 'reaeq.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany EQ REAPERa — działa od razu, bez instalacji.'
  },
  {
    id: 'rea-comp',
    name: 'ReaComp',
    vendor: 'Cockos',
    category: 'Kompresja',
    format: 'VST',
    file: 'reacomp.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany kompresor — wystarcza do kontroli dynamiki wokalu.'
  },
  {
    id: 'rea-xcomp',
    name: 'ReaXcomp',
    vendor: 'Cockos',
    category: 'Kompresja wielopasmowa',
    format: 'VST',
    file: 'reaxcomp.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany kompresor wielopasmowy — tania kontrola dołu.'
  },
  {
    id: 'rea-delay',
    name: 'ReaDelay',
    vendor: 'Cockos',
    category: 'Delay',
    format: 'VST',
    file: 'readelay.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany delay — przestrzeń dla wokalu bez dodatkowych zakupów.'
  },
  {
    id: 'rea-limit',
    name: 'ReaLimit',
    vendor: 'Cockos',
    category: 'Limiter',
    format: 'VST',
    file: 'realimit.dll',
    url: 'https://www.reaper.fm/download.php',
    tier: 'stock',
    why: 'Wbudowany limiter — zabezpiecza master przed przesterowaniem.'
  }
];

export const PLUGIN_CATALOG = [...PREMIUM_PLUGINS, ...STOCK_PLUGINS];

const PLUGIN_BY_ID = new Map(PLUGIN_CATALOG.map((plugin) => [plugin.id, plugin]));

/**
 * Zestawy tematyczne: co realnie stoi w łańcuchach raperów i producentów.
 * Kolejność w zestawie to kolejność zakupów — od najważniejszych.
 */
export const PLUGIN_PACKS = [
  {
    id: 'starter',
    label: 'Zestaw startowy rapera',
    note: 'Minimum, które pokrywa tuning, korekcję, de-esser, kompresję, saturację, limiter, pogłos i syntezę.',
    ids: ['autotune-pro', 'pro-q4', 'pro-ds', 'pro-c2', 'decapitator', 'pro-l2', 'vintageverb', 'serum']
  },
  {
    id: 'vocal',
    label: 'Wokal prowadzący i ad-liby',
    note: 'Tuning, kontrola dynamiki, usuwanie sybilantów, ciepło i szerokość chórków.',
    ids: [
      'autotune-pro', 'tune-rt', 'pro-q4', 'pro-ds', 'cl76', 'pro-c2',
      'decapitator', 'alterboy', 'echoboy', 'microshift'
    ]
  },
  {
    id: 'beat',
    label: 'Beat, 808 i stopa',
    note: 'Dół bez walki o miejsce: EQ, kompresja wielopasmowa, kontrola subbasu i saturacja.',
    ids: ['pro-q4', 'pro-mb', 'bx-subsynth', 'saturn2', 'ott', 'rc-20']
  },
  {
    id: 'master',
    label: 'Master i głośność',
    note: 'Korekcja, klejenie, gęstość i limiter z kontrolą True Peak.',
    ids: ['pro-q4', 'pro-mb', 'ssl4000', 'inflator', 'god-particle', 'pro-l2', 'ozone']
  },
  {
    id: 'fx',
    label: 'FX, przestrzeń i kreatywne wstawki',
    note: 'Pogłosy, delaye i efekty, które budują charakter nowoczesnego rapu.',
    ids: ['vintageverb', 'valhalladelay', 'supermassive', 'echoboy', 'crystallizer', 'shaperbox', 'radiator']
  }
];

export const CHAIN_VARIANTS = ['premium', 'stock'];

export const CHAIN_DEFINITIONS = [
  {
    id: 'vocal',
    label: 'Wokal',
    placement: 'Ścieżka wokalu prowadzącego (insert) — ad-liby na osobnych ścieżkach.',
    purpose: 'Czyszczenie, tuning, kompresja i saturacja wokalu prowadzącego oraz ad-libów.'
  },
  {
    id: 'beat',
    label: 'Beat / instrumental',
    placement: 'Ścieżka instrumentalu albo bus bitu.',
    purpose: 'Kontrola dołu, wyrównanie dynamiki i charakter instrumentalu.'
  },
  {
    id: 'mixbus',
    label: 'Bus miksowy',
    placement: 'Folder / bus, do którego wchodzą wszystkie ścieżki.',
    purpose: 'Klejenie całego miksu przed masterem — delikatna kompresja i kolor.'
  },
  {
    id: 'master',
    label: 'Master',
    placement: 'Ścieżka master — ostatnie ogniwo przed renderem.',
    purpose: 'Głośność docelowa, limiter i kontrola True Peak pod wybraną platformę.'
  },
  {
    id: 'sends',
    label: 'Sends (pogłos/delay)',
    placement: 'Osobne ścieżki send — nie wkładaj tego w insert wokalu.',
    purpose: 'Przestrzeń i ogon efektu na wysyłkach, żeby nie zamulać wokalu.'
  }
];

export function pluginById(id) {
  return PLUGIN_BY_ID.get(String(id)) || null;
}

/** Stabilny identyfikator wtyczki w chunku REAPERa (bez losowości). */
export function pluginUid(name) {
  let hash = 7;
  for (const char of String(name ?? '')) {
    hash = (hash * 31 + char.codePointAt(0)) % 2147483647;
  }
  return String(hash);
}

export function normalizeRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Plan wymaga danych wejściowych.');
  }
  const bpm = validate.requireNumber(input.bpm, 'BPM', { min: 20, max: 400, integer: true });
  const style = validate.requireEnum(input.style, Object.keys(STYLES), 'Styl');
  const platform = validate.requireEnum(input.platform, Object.keys(PLATFORMS), 'Platforma');
  const keySig = validate.optionalText(input.keySig, 'Tonacja', { max: 20 });
  const title = validate.optionalText(input.title, 'Tytuł', { max: 120 });
  return { bpm, style, platform, keySig, title };
}

function step(pluginId, settings, why = '') {
  const plugin = pluginById(pluginId);
  if (!plugin) {
    throw new ValidationError(`Brak wtyczki w katalogu: ${pluginId}.`);
  }
  return {
    plugin,
    settings: (settings || []).map((entry) => ({ param: String(entry.param), value: String(entry.value) })),
    why: why || plugin.why
  };
}

function vocalSteps({ request, style, variant }) {
  if (variant === 'stock') {
    return [
      step('rea-tune', [
        { param: 'Tryb', value: 'Automatyczna korekta, 5–10' },
        { param: 'Zakres', value: 'Tylko dźwięki poza skalą' }
      ]),
      step('rea-eq', [
        { param: 'Filtr górnoprzepustowy', value: '80–90 Hz, 24 dB/oct' },
        { param: 'Cięcie rezonansów', value: '250–400 Hz, −2 dB' },
        { param: 'Obecność', value: style.air }
      ]),
      step('rea-gate', [
        { param: 'Próg', value: '−45 dB' },
        { param: 'Release', value: '120 ms' }
      ]),
      step('rea-comp', [
        { param: 'Próg', value: '−20 dB' },
        { param: 'Ratio', value: '4:1' },
        { param: 'Attack / Release', value: `${style.attack} / ${style.release}` },
        { param: 'Redukcja', value: '3–5 dB' }
      ]),
      step('rea-delay', [
        { param: 'Typ', value: 'Slap delay (ósemka z kropką)' },
        { param: 'Mix', value: '12%' }
      ])
    ];
  }
  return [
    step('autotune-pro', [
      { param: 'Retune', value: style.tuning },
      { param: 'Humanize', value: style.humanize },
      {
        param: 'Skala',
        value: request.keySig ? `Dopasowana do tonacji ${request.keySig}` : 'Ustaw wg tonacji utworu'
      }
    ]),
    step('pro-q4', [
      { param: 'Filtr górnoprzepustowy', value: '90 Hz, 24 dB/oct' },
      { param: 'Cięcie rezonansów', value: '250–400 Hz, −2 dB, Q 2,0' },
      { param: 'Obecność', value: style.air },
      { param: 'Powietrze', value: '+1 dB @ 12 kHz (oszczędnie)' }
    ]),
    step('pro-ds', [
      { param: 'Próg', value: '−22 dB' },
      { param: 'Zakres', value: '4 dB' },
      { param: 'Częstotliwość', value: '6–8 kHz' }
    ]),
    step('pro-c2', [
      { param: 'Ratio', value: '4:1' },
      { param: 'Attack / Release', value: `${style.attack} / ${style.release}` },
      { param: 'Redukcja', value: '3–5 dB' }
    ]),
    step('decapitator', [
      { param: 'Drive', value: style.saturation },
      { param: 'Charakter', value: 'A — lekka lampa' },
      { param: 'Mix', value: '25%' }
    ]),
    step('alterboy', [
      { param: 'Formant', value: '−2 do −4 (grubszy wokal)' },
      { param: 'Pitch', value: '0 — tylko barwa' },
      { param: 'Mix', value: '20%' }
    ]),
    step('echoboy', [
      { param: 'Użycie', value: 'Osobny send, nie w łańcuchu insertów' },
      { param: 'Tryb', value: 'Tape' },
      { param: 'Mix', value: '12%' }
    ])
  ];
}

function beatSteps({ variant }) {
  if (variant === 'stock') {
    return [
      step('rea-eq', [
        { param: 'Filtr górnoprzepustowy', value: '30 Hz, 12 dB/oct' },
        { param: 'Dół', value: 'mono poniżej 120 Hz' },
        { param: 'Cięcie', value: '200–300 Hz, −1,5 dB' }
      ]),
      step('rea-xcomp', [
        { param: 'Pasmo niskie', value: '30–120 Hz' },
        { param: 'Ratio', value: '3:1' },
        { param: 'Redukcja', value: '≤ 3 dB' }
      ]),
      step('rea-comp', [
        { param: 'Ratio', value: '2:1' },
        { param: 'Attack / Release', value: '10 ms / 100 ms' }
      ])
    ];
  }
  return [
    step('pro-q4', [
      { param: 'Filtr górnoprzepustowy', value: '30 Hz, 12 dB/oct' },
      { param: 'Kontrola dołu', value: 'mono poniżej 120 Hz' },
      { param: 'Cięcie', value: '200–300 Hz, −1,5 dB' }
    ]),
    step('pro-mb', [
      { param: 'Pasmo niskie', value: '30–120 Hz' },
      { param: 'Ratio', value: '3:1' },
      { param: 'Redukcja', value: '≤ 3 dB' },
      { param: 'Pasmo wysokie', value: '6–12 kHz, spokojnie 1 dB' }
    ]),
    step('bx-subsynth', [
      { param: 'Sub', value: 'wzmocnienie 40–60 Hz, oszczędnie' },
      { param: 'Drive', value: 'łagodny' },
      { param: 'Użycie', value: 'równolegle do 808, nie na całym beacie' }
    ]),
    step('saturn2', [
      { param: 'Charakter', value: 'Warm Tape' },
      { param: 'Drive', value: '20%' },
      { param: 'Mix', value: '15%' }
    ])
  ];
}

function mixbusSteps({ style, variant }) {
  if (variant === 'stock') {
    return [
      step('rea-comp', [
        { param: 'Ratio', value: '2:1' },
        { param: 'Attack / Release', value: '10 ms / auto' },
        { param: 'Redukcja', value: '1–2 dB' }
      ]),
      step('rea-eq', [
        { param: 'Korekcja', value: '−0,5 dB @ 200 Hz, +0,5 dB @ 4 kHz' }
      ])
    ];
  }
  return [
    step('ssl4000', [
      { param: 'Trim', value: '−1 dB na wejściu' },
      { param: 'EQ', value: 'łagodny, bez dużych cięć' },
      { param: 'Kompresja kanału', value: '2 dB redukcji' }
    ]),
    step('pro-c2', [
      { param: 'Ratio', value: style.glue },
      { param: 'Attack / Release', value: '10 ms / auto' },
      { param: 'Redukcja', value: '1–2 dB' }
    ]),
    step('soothe2', [
      { param: 'Zakres', value: '2–8 kHz, redukcja 1–2 dB' },
      { param: 'Depth', value: 'łagodnie, tylko gdy pasmo kłuje' }
    ]),
    step('nova', [
      { param: 'Tryb', value: 'Dynamiczny EQ' },
      { param: 'Korekcja', value: '200 Hz i 4 kHz, tylko gdy pasmo przeszkadza' }
    ])
  ];
}

function masterSteps({ style, platform, variant }) {
  if (variant === 'stock') {
    return [
      step('rea-eq', [
        { param: 'Filtr górnoprzepustowy', value: '25 Hz, 12 dB/oct' },
        { param: 'Korekcja', value: '±0,5 dB' }
      ]),
      step('rea-limit', [
        { param: 'Ceiling', value: `${platform.truePeak} dBTP` },
        { param: 'Redukcja', value: '2–3 dB' }
      ])
    ];
  }
  return [
    step('pro-q4', [
      { param: 'Tryb', value: 'Linear phase, low latency' },
      { param: 'Filtr górnoprzepustowy', value: '25 Hz, 12 dB/oct' },
      { param: 'Korekcja', value: '±0,5 dB' }
    ]),
    step('pro-mb', [
      { param: 'Cel', value: 'kontrola dołu i góry' },
      { param: 'Redukcja', value: '≤ 2 dB' }
    ]),
    step('inflator', [
      { param: 'Effect', value: 'ok. 20%' },
      { param: 'Curve', value: 'łagodna' }
    ]),
    step('god-particle', [
      { param: 'Użycie', value: 'delikatnie — 10–20% możliwości' },
      { param: 'Kontrola', value: 'porównaj z wersją bypass (A/B)' }
    ]),
    step('pro-l2', [
      { param: 'Output', value: `${platform.lufs} LUFS` },
      { param: 'True Peak', value: `${platform.truePeak} dBTP` },
      { param: 'Lookahead', value: '2 ms' },
      { param: 'Charakter', value: style.glue === '3:1' ? 'Aggressive' : 'Transparent' }
    ])
  ];
}

function sendsSteps({ variant }) {
  if (variant === 'stock') {
    return [
      step('rea-verb', [
        { param: 'Użycie', value: 'Osobna ścieżka send, 100% wet' },
        { param: 'Czas', value: '1,8–2,4 s' }
      ]),
      step('rea-delay', [
        { param: 'Użycie', value: 'Osobna ścieżka send' },
        { param: 'Typ', value: 'Ósemka z kropką' },
        { param: 'Feedback', value: '25%' }
      ])
    ];
  }
  return [
    step('vintageverb', [
      { param: 'Użycie', value: 'Osobna ścieżka send, 100% wet' },
      { param: 'Tryb', value: 'Plate' },
      { param: 'Czas', value: '1,8–2,4 s' }
    ]),
    step('echoboy', [
      { param: 'Użycie', value: 'Osobna ścieżka send' },
      { param: 'Tryb', value: 'Tape' },
      { param: 'Mix', value: '100% wet na sendzie' }
    ]),
    step('crystallizer', [
      { param: 'Użycie', value: 'Ad-liby i przejścia, osobny send' },
      { param: 'Pitch', value: 'mieszanie oktaw, delikatnie' }
    ])
  ];
}

const STAGE_BUILDERS = {
  vocal: vocalSteps,
  beat: beatSteps,
  mixbus: mixbusSteps,
  master: masterSteps,
  sends: sendsSteps
};

function planNotes({ request, style, platform }) {
  return [
    `Zostaw ok. 6 dB headroomu na sumie przed masterem — limiter ma co robić.`,
    `Cel głośności: ${platform.lufs} LUFS i ${platform.truePeak} dBTP (${platform.label}).`,
    style.advice,
    request.keySig
      ? `Tonacja ${request.keySig}: dopasuj Auto-Tune i sprawdź, czy bas nie koliduje z wokalem.`
      : 'Nie podano tonacji — dopasuj Auto-Tune ręcznie w oknie wtyczki.',
    'Odsłuchaj na telefonie i w słuchawkach: rap wygrywa lub przegrywa w środku pasma.',
    'Paczka ZIP zawiera łańcuchy premium i stock — stock działa od razu, premium po zainstalowaniu wtyczek.',
    'Plan policzony lokalnie — żadne nagranie ani notatka nie opuściły urządzenia.'
  ];
}

export function buildPlan(input = {}, { variant = 'premium' } = {}) {
  const request = normalizeRequest(input);
  if (!CHAIN_VARIANTS.includes(variant)) {
    throw new ValidationError(`Nieznany wariant łańcucha: ${variant}.`);
  }
  const style = STYLES[request.style];
  const platform = PLATFORMS[request.platform];
  const stages = CHAIN_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    purpose: definition.purpose,
    steps: STAGE_BUILDERS[definition.id]({ request, style, platform, variant })
  }));

  return {
    format: PLAN_FORMAT,
    version: PLAN_VERSION,
    title: request.title || 'Nowy utwór',
    bpm: request.bpm,
    keySig: request.keySig,
    style: request.style,
    styleLabel: style.label,
    platform: request.platform,
    platformLabel: platform.label,
    variant,
    target: { lufs: platform.lufs, truePeak: platform.truePeak, sampleRate: 48000 },
    stages,
    notes: planNotes({ request, style, platform })
  };
}

function escapeChunkValue(value) {
  return String(value ?? '')
    .replace(/"/g, "'")
    .replace(/[\r\n\u0000-\u001f]/g, ' ')
    .trim();
}

/**
 * Plik .RfxChain: nagłówek BYPASS i chunki VST w kolejności łańcucha.
 * Bez parametrów — wtyczka wczyta się w stanie domyślnym, a wartości z planu
 * ustawia się w jej oknie (każda wtyczka ma inny zestaw parametrów).
 */
export function rfxChainText(stage) {
  if (!stage || !Array.isArray(stage.steps) || stage.steps.length === 0) {
    throw new ValidationError('Łańcuch nie zawiera wtyczek.');
  }
  const lines = ['BYPASS 0 0 0'];
  for (const entry of stage.steps) {
    const plugin = entry?.plugin;
    if (!plugin || !plugin.name || !plugin.vendor || !plugin.file) {
      throw new ValidationError('Krok łańcucha nie ma kompletnych danych wtyczki.');
    }
    const label = `${plugin.format || 'VST3'}: ${plugin.name} (${plugin.vendor})`;
    lines.push(`<VST "${escapeChunkValue(label)}" "${escapeChunkValue(plugin.file)}" 0 "" ${pluginUid(plugin.name)}`);
    lines.push('>');
  }
  return `${lines.join('\n')}\n`;
}

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'chain';
}

/** Nazwa pliku budowana wyłącznie z bezpiecznych znaków — bez ścieżek i „..”. */
export function chainFileName(plan, stageId) {
  const title = slugify(plan?.title || 'bsxs');
  const stage = slugify(stageId);
  const variant = plan?.variant === 'stock' ? 'stock' : 'premium';
  return `bsxs-${title}-${stage}-${variant}${FX_CHAIN_EXTENSION}`;
}

export function planFileName(plan, extension = '.md') {
  return `bsxs-mixplan-${slugify(plan?.title)}${String(extension).startsWith('.') ? extension : `.${extension}`}`;
}

export function recipeMarkdown(plan) {
  if (!plan || !Array.isArray(plan.stages)) {
    throw new ValidationError('Brak planu do wyeksportowania.');
  }
  const lines = [];
  lines.push(`# ${plan.title} — plan miksu i masteringu`);
  lines.push('');
  lines.push(`- BPM: ${plan.bpm}`);
  lines.push(`- Tonacja: ${plan.keySig || 'nie podano'}`);
  lines.push(`- Styl: ${plan.styleLabel}`);
  lines.push(`- Platforma: ${plan.platformLabel}`);
  lines.push(`- Cel: ${plan.target.lufs} LUFS, ${plan.target.truePeak} dBTP, ${plan.target.sampleRate} Hz`);
  lines.push(`- Wariant łańcuchów: ${plan.variant === 'premium' ? 'wtyczki premium' : 'wtyczki wbudowane REAPERa'}`);
  lines.push('');
  lines.push('## Wskazówki');
  for (const note of plan.notes) lines.push(`- ${note}`);
  lines.push('');
  plan.stages.forEach((stage, stageIndex) => {
    lines.push(`## ${stageIndex + 1}. ${stage.label}`);
    lines.push('');
    lines.push(stage.purpose);
    lines.push('');
    stage.steps.forEach((entry, stepIndex) => {
      const plugin = entry.plugin;
      lines.push(`### ${stageIndex + 1}.${stepIndex + 1} ${plugin.name} (${plugin.vendor})`);
      lines.push('');
      lines.push(entry.why);
      lines.push('');
      if (entry.settings.length) {
        for (const setting of entry.settings) {
          lines.push(`- ${setting.param}: ${setting.value}`);
        }
        lines.push('');
      }
      lines.push(`Strona producenta: ${plugin.url}`);
      lines.push('');
    });
  });
  lines.push('## Jak wstawić do REAPERa');
  lines.push('');
  lines.push('1. Pobierz plik .RfxChain dla wybranego etapu.');
  lines.push('2. W REAPERze przeciągnij plik na ścieżkę (albo: FX → Add FX → Import FX chain).');
  lines.push('3. Zainstalowane wtyczki wczytają się w kolejności z pliku; brakujące REAPER pokaże jako niedostępne.');
  lines.push('4. Ustaw parametry według listy powyżej — plik nie przenosi ustawień wtyczek.');
  lines.push('5. Zapisz łańcuch jako własny preset (FX → Save FX chain), jeśli chcesz go używać ponownie.');
  lines.push('');
  lines.push('Plik nie zawiera żadnych nagrań ani danych osobowych.');
  return `${lines.join('\n')}\n`;
}

export function chainPack(plan, { createdAt = null } = {}) {
  if (!plan || !Array.isArray(plan.stages)) {
    throw new ValidationError('Brak planu do wyeksportowania.');
  }
  return JSON.stringify({
    format: PACK_FORMAT,
    version: PACK_VERSION,
    createdAt,
    title: plan.title,
    bpm: plan.bpm,
    keySig: plan.keySig,
    style: plan.style,
    platform: plan.platform,
    variant: plan.variant,
    target: plan.target,
    chains: plan.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      fileName: chainFileName(plan, stage.id),
      rfxChain: rfxChainText(stage)
    })),
    notes: plan.notes
  }, null, 2);
}

/** Nazwa pakietu JSON z wariantem — oba warianty mogą leżeć w jednym ZIPie. */
export function packFileName(plan) {
  const variant = plan?.variant === 'stock' ? 'stock' : 'premium';
  return `bsxs-mixplan-${slugify(plan?.title)}-${variant}.json`;
}

/** Wszystkie pliki .RfxChain jednego planu — nazwy są unikalne i bezpieczne. */
export function chainFiles(plan) {
  if (!plan || !Array.isArray(plan.stages) || plan.stages.length === 0) {
    throw new ValidationError('Brak planu do wyeksportowania.');
  }
  const seen = new Set();
  return plan.stages.map((stage) => {
    const fileName = chainFileName(plan, stage.id);
    if (seen.has(fileName)) {
      throw new ValidationError(`Zduplikowana nazwa pliku łańcucha: ${fileName}.`);
    }
    seen.add(fileName);
    return { id: stage.id, label: stage.label, fileName, text: rfxChainText(stage) };
  });
}

export function catalogFileName() {
  return 'bsxs-wtyczki-mix-master.md';
}

/** Lista wtyczek z linkami producentów — do pobrania i wydrukowania. */
export function catalogMarkdown() {
  const lines = [];
  lines.push('# Mix Master — katalog wtyczek');
  lines.push('');
  lines.push(`${PLUGIN_CATALOG.length} pozycji: ${PREMIUM_PLUGINS.length} premium i ${STOCK_PLUGINS.length} wbudowanych w REAPERa.`);
  lines.push('');
  lines.push('Aplikacja nie pobiera, nie instaluje i nie licencjonuje wtyczek — adresy prowadzą do oficjalnych stron producentów.');
  lines.push('');
  const categories = Array.from(new Set(PLUGIN_CATALOG.map((plugin) => plugin.category)))
    .sort((left, right) => left.localeCompare(right, 'pl'));
  for (const category of categories) {
    lines.push(`## ${category}`);
    lines.push('');
    for (const plugin of PLUGIN_CATALOG.filter((entry) => entry.category === category)) {
      lines.push(`- **${plugin.name}** (${plugin.vendor}) — ${entryLabel(plugin)}`);
      lines.push(`  - Plik: ${plugin.file}, format ${plugin.format}`);
      lines.push(`  - Producent: ${plugin.url}`);
    }
    lines.push('');
  }
  lines.push('## Jak używać katalogu');
  lines.push('');
  lines.push('1. Pobierz albo kup wtyczkę wyłącznie ze strony producenta.');
  lines.push('2. Zainstaluj ją jako VST3 i uruchom w REAPERze skanowanie wtyczek.');
  lines.push('3. Wczytaj łańcuch .RfxChain — nazwy wtyczek muszą zgadzać się z tym, co pokazuje REAPER.');
  lines.push('');
  lines.push('Lista nie zawiera danych osobowych, kluczy licencyjnych ani haseł.');
  return `${lines.join('\n')}\n`;
}

function entryLabel(plugin) {
  return plugin.tier === 'stock' ? `${plugin.why} (wbudowana w REAPERa)` : plugin.why;
}

/** Instrukcja dołączana do paczki ZIP. */
export function bundleReadme(plan, { createdAt = null } = {}) {
  const lines = [];
  lines.push('BSXS Manager — Mix Master: paczka łańcuchów FX do REAPERa');
  lines.push('=========================================================');
  lines.push('');
  lines.push(`Utwór: ${plan?.title || 'Nowy utwór'}`);
  lines.push(`BPM: ${plan?.bpm ?? '—'} · Tonacja: ${plan?.keySig || 'nie podano'}`);
  lines.push(`Styl: ${plan?.styleLabel || '—'} · Platforma: ${plan?.platformLabel || '—'}`);
  lines.push(`Cel głośności: ${plan?.target?.lufs ?? '—'} LUFS, ${plan?.target?.truePeak ?? '—'} dBTP`);
  if (createdAt) lines.push(`Wygenerowano: ${createdAt}`);
  lines.push('');
  lines.push('Zawartość paczki');
  lines.push('----------------');
  lines.push('- *.RfxChain — łańcuchy dla obu wariantów (premium i stock)');
  lines.push('- bsxs-mixplan-*-premium.json / *-stock.json — pakiety z łańcuchami i planem');
  lines.push('- bsxs-mixplan-*.md — recepta z ustawieniami wtyczek');
  lines.push('');
  lines.push('Jak wstawić do REAPERa');
  lines.push('----------------------');
  lines.push('1. Rozpakuj archiwum (na telefonie: Pliki → „Rozpakuj”).');
  lines.push('2. Przeciągnij plik .RfxChain na wybraną ścieżkę w REAPERze.');
  lines.push('   Alternatywnie: FX → Add FX → Import FX chain.');
  lines.push('3. Wariant „stock” używa wyłącznie wtyczek wbudowanych — działa od razu.');
  lines.push('4. Brakującą wtyczkę premium REAPER pokaże jako niedostępną (OFFLINE);');
  lines.push('   zainstaluj ją ze strony producenta i wczytaj łańcuch ponownie.');
  lines.push('5. Ustaw parametry według recepty .md — plik przenosi kolejność wtyczek.');
  lines.push('6. Gotowy łańcuch zapisz w REAPERze: FX → Save FX chain.');
  lines.push('');
  lines.push('Bezpieczeństwo');
  lines.push('--------------');
  lines.push('Pliki zawierają wyłącznie nazwy wtyczek i ich kolejność. Nie ma tu nagrań,');
  lines.push('danych osobowych, skryptów ani poleceń systemowych.');
  return `${lines.join('\n')}\n`;
}

/**
 * Paczka „pobierz wszystko”: łańcuchy obu wariantów, dwa pakiety JSON,
 * recepta i instrukcja — gotowa do zapisania jako jeden plik ZIP.
 */
export function bundleFiles(input = {}, { createdAt = null } = {}) {
  const plans = CHAIN_VARIANTS.map((variant) => buildPlan(input, { variant }));
  const files = [];
  for (const plan of plans) {
    for (const chain of chainFiles(plan)) {
      files.push({ name: chain.fileName, text: chain.text });
    }
  }
  for (const plan of plans) {
    files.push({ name: packFileName(plan), text: chainPack(plan, { createdAt }) });
  }
  const primary = plans.find((plan) => plan.variant === 'premium') || plans[0];
  files.push({ name: planFileName(primary, '.md'), text: recipeMarkdown(primary) });
  files.push({ name: 'README.txt', text: bundleReadme(primary, { createdAt }) });

  const names = new Set();
  for (const file of files) {
    if (names.has(file.name)) {
      throw new ValidationError(`Zduplikowana nazwa w paczce: ${file.name}.`);
    }
    names.add(file.name);
  }
  return files;
}

export function bundleFileName(plan) {
  return `bsxs-mixmaster-${slugify(plan?.title || 'bsxs')}.zip`;
}

/** Spójność katalogu i wszystkich kombinacji łańcuchów — używane też w testach. */
export function validateCatalog() {
  const issues = [];
  const seen = new Set();
  for (const plugin of PLUGIN_CATALOG) {
    if (!plugin.id) {
      issues.push('Wtyczka bez identyfikatora.');
      continue;
    }
    if (seen.has(plugin.id)) issues.push(`Zduplikowany identyfikator wtyczki: ${plugin.id}.`);
    seen.add(plugin.id);
    if (!plugin.name || !plugin.vendor) issues.push(`Wtyczka ${plugin.id}: brak nazwy lub producenta.`);
    if (!plugin.file) issues.push(`Wtyczka ${plugin.id}: brak nazwy pliku.`);
    if (!/^https:\/\/[^\s]+$/.test(String(plugin.url || ''))) {
      issues.push(`Wtyczka ${plugin.id}: adres producenta nie jest adresem HTTPS.`);
    }
    if (!plugin.category) issues.push(`Wtyczka ${plugin.id}: brak kategorii.`);
  }
  for (const pack of PLUGIN_PACKS) {
    if (!pack.id || !pack.label) issues.push('Zestaw wtyczek bez identyfikatora lub nazwy.');
    if (!Array.isArray(pack.ids) || pack.ids.length === 0) {
      issues.push(`Zestaw ${pack.id}: brak wtyczek.`);
      continue;
    }
    if (new Set(pack.ids).size !== pack.ids.length) {
      issues.push(`Zestaw ${pack.id}: zduplikowane wtyczki.`);
    }
    for (const id of pack.ids) {
      if (!PLUGIN_BY_ID.has(id)) issues.push(`Zestaw ${pack.id}: nieznana wtyczka ${id}.`);
    }
  }
  for (const variant of CHAIN_VARIANTS) {
    for (const platform of Object.keys(PLATFORMS)) {
      let plan = null;
      try {
        plan = buildPlan({ bpm: 140, style: 'trap', platform, keySig: 'Am' }, { variant });
      } catch (err) {
        issues.push(`Wariant ${variant}/${platform}: ${err.message}`);
        continue;
      }
      if (plan.stages.length !== CHAIN_DEFINITIONS.length) {
        issues.push(`Wariant ${variant}: niepełna liczba etapów.`);
      }
      for (const stage of plan.stages) {
        try {
          const text = rfxChainText(stage);
          if (!text.startsWith('BYPASS 0 0 0')) issues.push(`Etap ${stage.id}: brak nagłówka BYPASS.`);
        } catch (err) {
          issues.push(`Etap ${stage.id} (${variant}): ${err.message}`);
        }
      }
      try {
        const names = chainFiles(plan).map((file) => file.fileName);
        if (new Set(names).size !== names.length) {
          issues.push(`Wariant ${variant}: zduplikowane nazwy plików łańcuchów.`);
        }
      } catch (err) {
        issues.push(`Wariant ${variant}: ${err.message}`);
      }
    }
  }
  return issues;
}
