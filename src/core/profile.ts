// The player's buddy (character look) and room style. Pure data shared by
// the renderer, the UI and sync. Colours live here so previews/UI swatches match the room.

export type HairStyle = 'short' | 'curly' | 'long' | 'bun' | 'ponytail' | 'buzz' | 'afro' | 'bob' | 'spiky' | 'braids';
export type ViewId = 'street' | 'seaside' | 'city' | 'countryside' | 'forest';
export type WallId = 'cream-stripe' | 'sage' | 'dusk-blue' | 'blush' | 'brick' | 'wood-panel' | 'night-stars' | 'mint-check';
export type FloorId = 'honey-wood' | 'dark-wood' | 'blue-carpet' | 'checker' | 'tatami' | 'terracotta';
export type CurtainId = 'red' | 'navy' | 'sage' | 'mustard' | 'lilac' | 'blinds';

export interface Swatch<Id extends string = string> {
  id: Id;
  name: string;
  /** main colour, then shade / highlight */
  colors: [string, string, string];
}

export interface Appearance {
  /** The buddy's name, shown in bubbles and on the leaderboard card. */
  name: string;
  skin: string;
  hair: HairStyle;
  hairColor: string;
  /** Default hoodie colour (shop tops override it). */
  top: string;
}

export interface RoomStyle {
  wall: WallId;
  floor: FloorId;
  curtains: CurtainId;
  view: ViewId;
}

export interface Profile {
  appearance: Appearance;
  room: RoomStyle;
  /** Finished the first-run setup. */
  onboarded: boolean;
}

export const SKIN_TONES: Swatch[] = [
  { id: 'porcelain', name: 'Porcelain', colors: ['#f6d2b8', '#e3b597', '#fbe2cf'] },
  { id: 'peach', name: 'Peach', colors: ['#e8b48a', '#d39a70', '#f2c7a2'] },
  { id: 'honey', name: 'Honey', colors: ['#d39a66', '#b9804f', '#e2b07f'] },
  { id: 'tan', name: 'Tan', colors: ['#b97d4f', '#9c653c', '#cc9363'] },
  { id: 'brown', name: 'Brown', colors: ['#8d5a3a', '#74482d', '#a26c48'] },
  { id: 'deep', name: 'Deep', colors: ['#5e3b27', '#4a2d1d', '#734a31'] },
];

export const HAIR_COLORS: Swatch[] = [
  { id: 'espresso', name: 'Espresso', colors: ['#3b2a20', '#2a1d16', '#4e392c'] },
  { id: 'black', name: 'Black', colors: ['#1d1b22', '#121116', '#2e2b35'] },
  { id: 'chestnut', name: 'Chestnut', colors: ['#6b3d24', '#542e1a', '#84502f'] },
  { id: 'ginger', name: 'Ginger', colors: ['#b5562a', '#93431f', '#cd6c3a'] },
  { id: 'blonde', name: 'Blonde', colors: ['#d9b062', '#bb934a', '#ecc87b'] },
  { id: 'silver', name: 'Silver', colors: ['#b9b9c4', '#9696a3', '#d5d5de'] },
  { id: 'pink', name: 'Pink', colors: ['#e07aa5', '#c25f89', '#f19cbf'] },
  { id: 'teal', name: 'Teal', colors: ['#3f9a9a', '#2f7b7b', '#57b5b3'] },
];

export const HAIR_STYLES: { id: HairStyle; name: string }[] = [
  { id: 'short', name: 'Short' },
  { id: 'curly', name: 'Curly' },
  { id: 'long', name: 'Long' },
  { id: 'bob', name: 'Bob' },
  { id: 'bun', name: 'Bun' },
  { id: 'ponytail', name: 'Ponytail' },
  { id: 'braids', name: 'Braids' },
  { id: 'afro', name: 'Afro' },
  { id: 'spiky', name: 'Spiky' },
  { id: 'buzz', name: 'Buzz cut' },
];

export const TOP_COLORS: Swatch[] = [
  { id: 'blue', name: 'Blue', colors: ['#4a7fc1', '#3d6aa3', '#5b90d2'] },
  { id: 'mustard', name: 'Mustard', colors: ['#d9a23a', '#b9862a', '#e8b752'] },
  { id: 'lilac', name: 'Lilac', colors: ['#9a7cc4', '#7f63a6', '#b096d6'] },
  { id: 'coral', name: 'Coral', colors: ['#e0745c', '#c25c46', '#ee8d77'] },
  { id: 'teal', name: 'Teal', colors: ['#3f9a8f', '#2f7d73', '#55b3a7'] },
  { id: 'grey', name: 'Grey', colors: ['#8a8d99', '#6f727d', '#a2a5b0'] },
  { id: 'cream', name: 'Cream', colors: ['#e9dcc3', '#cdbfa5', '#f5ecd9'] },
];

export const WALLS: (Swatch<WallId> & { pattern: 'stripes' | 'plain' | 'dots' | 'brick' | 'planks' | 'stars' | 'check' })[] = [
  { id: 'cream-stripe', name: 'Cream stripes', colors: ['#d9c3a5', '#d0b897', '#c7ab86'], pattern: 'stripes' },
  { id: 'sage', name: 'Sage', colors: ['#a9b99a', '#9aab8b', '#8c9d7d'], pattern: 'plain' },
  { id: 'dusk-blue', name: 'Dusk blue', colors: ['#7f8fb3', '#7383a7', '#66769a'], pattern: 'dots' },
  { id: 'blush', name: 'Blush', colors: ['#e2b8b0', '#d6aaa2', '#c99a92'], pattern: 'stripes' },
  { id: 'brick', name: 'Exposed brick', colors: ['#a5604a', '#8f513e', '#c9b9a6'], pattern: 'brick' },
  { id: 'wood-panel', name: 'Cabin wood', colors: ['#a77b52', '#946a44', '#b98c61'], pattern: 'planks' },
  { id: 'night-stars', name: 'Starry night', colors: ['#3b4470', '#333b63', '#e8d58a'], pattern: 'stars' },
  { id: 'mint-check', name: 'Mint check', colors: ['#b7d6c6', '#a8c9b8', '#9bbcab'], pattern: 'check' },
];

export const FLOORS: Swatch<FloorId>[] = [
  { id: 'honey-wood', name: 'Honey wood', colors: ['#8b5a3c', '#734a31', '#9c6b4a'] },
  { id: 'dark-wood', name: 'Dark wood', colors: ['#5a3b2b', '#462d20', '#6b4836'] },
  { id: 'blue-carpet', name: 'Blue carpet', colors: ['#4c5f86', '#435477', '#56698f'] },
  { id: 'checker', name: 'Checker tiles', colors: ['#d8d2c4', '#3d3b45', '#c4bdb0'] },
  { id: 'tatami', name: 'Tatami', colors: ['#c2b27a', '#a99a64', '#d0c28c'] },
  { id: 'terracotta', name: 'Terracotta', colors: ['#b5674a', '#9c573d', '#c47a5c'] },
];

export const CURTAINS: Swatch<CurtainId>[] = [
  { id: 'red', name: 'Cranberry', colors: ['#b5484a', '#9a3a3d', '#c75a5c'] },
  { id: 'navy', name: 'Navy', colors: ['#34477a', '#293965', '#41568c'] },
  { id: 'sage', name: 'Sage', colors: ['#7e9a6e', '#68825a', '#93ad83'] },
  { id: 'mustard', name: 'Mustard', colors: ['#d9a23a', '#b9862a', '#e8b752'] },
  { id: 'lilac', name: 'Lilac', colors: ['#9a7cc4', '#7f63a6', '#b096d6'] },
  { id: 'blinds', name: 'Wooden blinds', colors: ['#c9a777', '#a98a5f', '#dcc095'] },
];

export const VIEWS: { id: ViewId; name: string; icon: string; blurb: string }[] = [
  { id: 'street', name: 'Quiet street', icon: '🏘️', blurb: 'Neighbours, dog walkers and the odd car.' },
  { id: 'seaside', name: 'Seaside', icon: '🌊', blurb: 'Waves, sailboats, gulls and a lighthouse.' },
  { id: 'city', name: 'City skyline', icon: '🌆', blurb: 'Towers, a rooftop view and passing trains.' },
  { id: 'countryside', name: 'Countryside', icon: '🌾', blurb: 'Rolling hills, sheep and a windmill.' },
  { id: 'forest', name: 'Forest cabin', icon: '🌲', blurb: 'Pines, deer, fireflies and mountain mist.' },
];

export interface RoomPreset {
  id: string;
  name: string;
  icon: string;
  room: RoomStyle;
}

export const ROOM_PRESETS: RoomPreset[] = [
  { id: 'cozy', name: 'Cozy bedroom', icon: '🛏️', room: { wall: 'cream-stripe', floor: 'honey-wood', curtains: 'red', view: 'street' } },
  { id: 'seaside', name: 'Seaside studio', icon: '🐚', room: { wall: 'mint-check', floor: 'terracotta', curtains: 'blinds', view: 'seaside' } },
  { id: 'loft', name: 'City loft', icon: '🏙️', room: { wall: 'brick', floor: 'dark-wood', curtains: 'navy', view: 'city' } },
  { id: 'cottage', name: 'Country cottage', icon: '🌻', room: { wall: 'sage', floor: 'checker', curtains: 'mustard', view: 'countryside' } },
  { id: 'cabin', name: 'Forest cabin', icon: '🪵', room: { wall: 'wood-panel', floor: 'dark-wood', curtains: 'sage', view: 'forest' } },
  { id: 'dreamy', name: 'Night owl', icon: '🌙', room: { wall: 'night-stars', floor: 'blue-carpet', curtains: 'lilac', view: 'city' } },
];

export interface CharacterPreset {
  id: string;
  appearance: Appearance;
}

export const CHARACTER_PRESETS: CharacterPreset[] = [
  { id: 'sam', appearance: { name: 'Sam', skin: 'peach', hair: 'short', hairColor: 'espresso', top: 'blue' } },
  { id: 'mei', appearance: { name: 'Mei', skin: 'porcelain', hair: 'bun', hairColor: 'black', top: 'lilac' } },
  { id: 'kofi', appearance: { name: 'Kofi', skin: 'deep', hair: 'afro', hairColor: 'black', top: 'mustard' } },
  { id: 'riya', appearance: { name: 'Riya', skin: 'tan', hair: 'braids', hairColor: 'black', top: 'coral' } },
  { id: 'finn', appearance: { name: 'Finn', skin: 'porcelain', hair: 'curly', hairColor: 'ginger', top: 'teal' } },
  { id: 'luz', appearance: { name: 'Luz', skin: 'honey', hair: 'ponytail', hairColor: 'chestnut', top: 'grey' } },
  { id: 'jay', appearance: { name: 'Jay', skin: 'brown', hair: 'spiky', hairColor: 'teal', top: 'cream' } },
  { id: 'nova', appearance: { name: 'Nova', skin: 'peach', hair: 'bob', hairColor: 'pink', top: 'blue' } },
];

export const DEFAULT_PROFILE: Profile = {
  appearance: { ...CHARACTER_PRESETS[0].appearance },
  room: { ...ROOM_PRESETS[0].room },
  onboarded: false,
};

const byId = <T extends { id: string }>(list: T[], id: string, fallback: T) => list.find((x) => x.id === id) ?? fallback;
export const skinOf = (id: string) => byId(SKIN_TONES, id, SKIN_TONES[1]);
export const hairColorOf = (id: string) => byId(HAIR_COLORS, id, HAIR_COLORS[0]);
export const topColorOf = (id: string) => byId(TOP_COLORS, id, TOP_COLORS[0]);
export const wallOf = (id: string) => byId(WALLS, id, WALLS[0]);
export const floorOf = (id: string) => byId(FLOORS, id, FLOORS[0]);
export const curtainOf = (id: string) => byId(CURTAINS, id, CURTAINS[0]);

/** Repairs a profile loaded from storage / another device / a share link. */
export function normalizeProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Profile>;
  const a = (r.appearance ?? {}) as Partial<Appearance>;
  const rm = (r.room ?? {}) as Partial<RoomStyle>;
  const d = DEFAULT_PROFILE;
  const oneOf = <T extends string>(v: unknown, list: { id: string }[], def: T): T => (typeof v === 'string' && list.some((x) => x.id === v) ? (v as T) : def);
  return {
    appearance: {
      name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 20) : d.appearance.name,
      skin: oneOf(a.skin, SKIN_TONES, d.appearance.skin),
      hair: oneOf(a.hair, HAIR_STYLES, d.appearance.hair),
      hairColor: oneOf(a.hairColor, HAIR_COLORS, d.appearance.hairColor),
      top: oneOf(a.top, TOP_COLORS, d.appearance.top),
    },
    room: {
      wall: oneOf(rm.wall, WALLS, d.room.wall),
      floor: oneOf(rm.floor, FLOORS, d.room.floor),
      curtains: oneOf(rm.curtains, CURTAINS, d.room.curtains),
      view: oneOf(rm.view, VIEWS, d.room.view),
    },
    onboarded: !!r.onboarded,
  };
}
