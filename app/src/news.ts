// The storm's two news channels: America News reads it in English, Bharat News in Hindi. Each has
// its own ElevenLabs voice (server/src/voice.ts: ELEVENLABS_VOICE_AMERICA, ELEVENLABS_VOICE_BHARAT)
// and its own anchor (app/public/anchors/<id>.png, a cartoon in the inks until a portrait is
// there). The player's choice is remembered.
import { create } from 'zustand';
import type { Hazard } from './story';
import type { VoiceName } from './ui/voice';

export type Lang = 'en' | 'hi';
export type ChannelId = 'america' | 'bharat';

export interface Channel {
  id: ChannelId;
  name: string;
  /** For the channel tabs on a phone. */
  short: string;
  lang: Lang;
  voice: VoiceName;
}

export const CHANNELS: Channel[] = [
  { id: 'america', name: 'America News', short: 'America', lang: 'en', voice: 'america' },
  { id: 'bharat', name: 'Bharat News', short: 'Bharat', lang: 'hi', voice: 'bharat' },
];
export const channelById = (id: ChannelId): Channel => CHANNELS.find((c) => c.id === id) ?? CHANNELS[0]!;

const KEY = 'ready-raleigh:channel';

function initialChannel(): ChannelId {
  try {
    return localStorage.getItem(KEY) === 'bharat' ? 'bharat' : 'america';
  } catch {
    return 'america';
  }
}

export const useChannel = create<{ id: ChannelId; set: (id: ChannelId) => void }>((set) => ({
  id: initialChannel(),
  set: (id) => {
    set({ id });
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Not remembered; still applies now.
    }
  },
}));

/** How the anchor says one event, in one language. Names (roads, neighborhoods) stay as they are. */
export interface NewsBook {
  road: (name: string) => string;
  /** The neighborhood a step reaches; in the heat, step 2 is the grid failing there. */
  area: (hood: string, step: number) => string;
  cut: (hood: string) => string;
  stranded: (people: number) => string;
  safe: string;
}

/** Spoken numbers, rounded the way an anchor says them: "About 230,000" and "लगभग 2.3 लाख". */
export function aboutEn(n: number): string {
  if (n < 1000) return String(Math.round(n));
  return `About ${Number(n.toPrecision(2)).toLocaleString('en-US')}`;
}
export function aboutHi(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return `लगभग ${Math.round(n / 1000)} हज़ार`;
  return `लगभग ${(n / 100_000).toFixed(1).replace(/\.0$/, '')} लाख`;
}

const cutEn = (h: string) => `${h} is cut off from every hospital.`;
const cutHi = (h: string) => `${h} का हर अस्पताल से संपर्क टूट गया है।`;
const strandedEn = (n: number) => `${aboutEn(n)} stranded so far.`;
const strandedHi = (n: number) => `अब तक ${aboutHi(n)} लोग फँसे हुए हैं।`;

const BOOKS: Record<Lang, Record<Hazard, NewsBook>> = {
  en: {
    flood: {
      road: (r) => `${r} is under water.`,
      area: (h) => `Water reaches ${h}.`,
      cut: cutEn,
      stranded: strandedEn,
      safe: 'So far, everyone has reached safety.',
    },
    quake: {
      road: (r) => `${r} has buckled and is closed.`,
      area: (h) => `The ground is failing in ${h}.`,
      cut: cutEn,
      stranded: strandedEn,
      safe: 'So far, everyone has reached safety.',
    },
    heat: {
      road: (r) => `${r} is closed.`,
      area: (h, step) => (step === 2 ? `The power is out in ${h}.` : `${h} has reached dangerous heat.`),
      cut: cutEn,
      stranded: (n) => `${aboutEn(n)} still without a cool place.`,
      safe: 'So far, everyone has found a cool place.',
    },
  },
  hi: {
    flood: {
      road: (r) => `${r} पानी में डूब गई है।`,
      area: (h) => `पानी ${h} तक पहुँच गया है।`,
      cut: cutHi,
      stranded: strandedHi,
      safe: 'अब तक सभी लोग सुरक्षित जगह पहुँच गए हैं।',
    },
    quake: {
      road: (r) => `${r} में दरारें आ गई हैं, सड़क बंद है।`,
      area: (h) => `${h} में ज़मीन धँस रही है।`,
      cut: cutHi,
      stranded: strandedHi,
      safe: 'अब तक सभी लोग सुरक्षित जगह पहुँच गए हैं।',
    },
    heat: {
      road: (r) => `${r} बंद है।`,
      area: (h, step) => (step === 2 ? `${h} में बिजली गुल हो गई है।` : `${h} में गर्मी ख़तरनाक स्तर पर पहुँच गई है।`),
      cut: cutHi,
      stranded: (n) => `अब तक ${aboutHi(n)} लोगों को ठंडी जगह नहीं मिली है।`,
      safe: 'अब तक सभी को ठंडी जगह मिल गई है।',
    },
  },
};

export const newsBook = (lang: Lang, hazard: Hazard): NewsBook => BOOKS[lang][hazard];
