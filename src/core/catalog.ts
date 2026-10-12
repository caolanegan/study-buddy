export type Category = 'computer' | 'attire' | 'pets' | 'furniture';

export interface Item {
  id: string;
  name: string;
  category: Category;
  price: number;
  icon: string;
  /** Items sharing a slot are mutually exclusive (e.g. hats). Defaults to the item's own id. */
  slot?: string;
  /** Must own this item first. */
  requires?: string;
  /** Unlocked by an achievement instead of bought. */
  achievement?: string;
  /** Limited-time: only buyable inside this real-calendar window (MM-DD, inclusive, may wrap the new year). Kept forever once bought. */
  limited?: { from: string; to: string; event: string };
  blurb: string;
}

export const CATEGORIES: { id: Category; name: string; icon: string }[] = [
  { id: 'computer', name: 'Computer', icon: '🖥️' },
  { id: 'attire', name: 'Attire', icon: '🧢' },
  { id: 'pets', name: 'Pets', icon: '🐱' },
  { id: 'furniture', name: 'Furniture', icon: '🛋️' },
];

export const ITEMS: Item[] = [
  // computer
  { id: 'rgb-keyboard', name: 'RGB Keyboard', category: 'computer', price: 250, icon: '⌨️', blurb: 'Clicky keys that glow in the dark.' },
  { id: 'dual-monitor', name: 'Dual Monitors', category: 'computer', price: 400, icon: '🖥️', slot: 'monitor', blurb: 'Notes on one screen, work on the other.' },
  { id: 'monitor-light', name: 'Monitor Light Bar', category: 'computer', price: 300, icon: '💡', blurb: 'A soft glow above the screen.' },
  { id: 'pc-tower', name: 'Gaming PC Tower', category: 'computer', price: 900, icon: '🗄️', blurb: 'RGB fans spinning under the desk.' },
  { id: 'ultrawide', name: 'Ultrawide Monitor', category: 'computer', price: 1200, icon: '🖥️', slot: 'monitor', blurb: 'So much screen.' },
  { id: 'triple-monitor', name: 'Triple Monitors', category: 'computer', price: 2200, icon: '🖥️', slot: 'monitor', requires: 'dual-monitor', blurb: 'Mission control.' },
  // attire
  { id: 'beanie', name: 'Red Beanie', category: 'attire', price: 150, icon: '🧶', slot: 'hat', blurb: 'Cosy and classic.' },
  { id: 'cap', name: 'Baseball Cap', category: 'attire', price: 150, icon: '🧢', slot: 'hat', blurb: 'Backwards, obviously.' },
  { id: 'glasses', name: 'Glasses', category: 'attire', price: 200, icon: '👓', slot: 'face', blurb: 'For that scholarly look.' },
  { id: 'headphones', name: 'Headphones', category: 'attire', price: 300, icon: '🎧', slot: 'ears', blurb: 'Lo-fi beats to study to.' },
  { id: 'hoodie-green', name: 'Green Hoodie', category: 'attire', price: 120, icon: '🟢', slot: 'top', blurb: 'Fresh new colour.' },
  { id: 'hoodie-black', name: 'Black Hoodie', category: 'attire', price: 120, icon: '⚫', slot: 'top', blurb: 'Hacker mode.' },
  { id: 'sweater', name: 'Knitted Sweater', category: 'attire', price: 250, icon: '🧥', slot: 'top', blurb: 'Grandma approved.' },
  { id: 'wizard-hat', name: 'Wizard Hat', category: 'attire', price: 600, icon: '🧙', slot: 'hat', blurb: 'Studying is basically magic.' },
  { id: 'crown', name: 'Golden Crown', category: 'attire', price: 0, icon: '👑', slot: 'hat', achievement: 'hours-100', blurb: 'Reward for 100 hours studied.' },
  // pets
  { id: 'fish-tank', name: 'Fish Tank', category: 'pets', price: 500, icon: '🐠', blurb: 'Bubbles and little fish.' },
  { id: 'cat', name: 'Cat', category: 'pets', price: 800, icon: '🐱', blurb: 'Naps, wanders, sits on your keyboard.' },
  { id: 'lizard', name: 'Lizard Terrarium', category: 'pets', price: 900, icon: '🦎', blurb: 'Basks under a heat lamp.' },
  { id: 'dog', name: 'Dog', category: 'pets', price: 1000, icon: '🐶', blurb: 'Wags, sleeps, and wants walks.' },
  // furniture
  { id: 'poster', name: 'Poster', category: 'furniture', price: 150, icon: '🖼️', blurb: 'Something to look at.' },
  { id: 'rug', name: 'Round Rug', category: 'furniture', price: 200, icon: '🟠', blurb: 'Ties the room together.' },
  { id: 'desk-lamp', name: 'Desk Lamp', category: 'furniture', price: 250, icon: '🪔', blurb: 'Warm light for late nights.' },
  { id: 'big-plant', name: 'Big Plant', category: 'furniture', price: 250, icon: '🪴', blurb: 'A leafy friend.' },
  { id: 'fairy-lights', name: 'Fairy Lights', category: 'furniture', price: 300, icon: '✨', blurb: 'Twinkly vibes.' },
  { id: 'floor-lamp', name: 'Floor Lamp', category: 'furniture', price: 350, icon: '🛋️', blurb: 'Reading nook energy.' },
  { id: 'beanbag', name: 'Beanbag', category: 'furniture', price: 500, icon: '🫘', blurb: 'For break time.' },
  { id: 'bookshelf', name: 'Tall Bookshelf', category: 'furniture', price: 600, icon: '📚', blurb: 'Show off your reading.' },
  { id: 'standing-desk', name: 'Standing Desk', category: 'furniture', price: 1500, icon: '🧍', slot: 'desk', blurb: 'He stands up during pomodoro breaks.' },
  { id: 'tv', name: 'TV', category: 'furniture', price: 1500, icon: '📺', blurb: 'For well-earned breaks.' },
  { id: 'sofa', name: 'Sofa', category: 'furniture', price: 1800, icon: '🛋️', blurb: 'Comfy.' },
  { id: 'ps5', name: 'PS5', category: 'furniture', price: 2000, icon: '🎮', requires: 'tv', blurb: 'He plays it when you take breaks.' },
  // more everyday things
  { id: 'neon-sign', name: 'Neon Sign', category: 'furniture', price: 450, icon: '🌟', blurb: 'A buzzing "STUDY" sign that glows at night.' },
  { id: 'coffee-machine', name: 'Coffee Machine', category: 'furniture', price: 500, icon: '☕', blurb: 'Fresh refills — he pops over on breaks.' },
  { id: 'record-player', name: 'Record Player', category: 'furniture', price: 700, icon: '🎶', blurb: 'Spins while the lo-fi plays.' },
  { id: 'guitar', name: 'Guitar', category: 'furniture', price: 800, icon: '🎸', blurb: 'He strums a little on breaks.' },
  { id: 'telescope', name: 'Telescope', category: 'furniture', price: 1100, icon: '🔭', blurb: 'Stargazing on clear nights.' },
  { id: 'hamster', name: 'Hamster', category: 'pets', price: 600, icon: '🐹', blurb: 'Runs on its wheel, naps in its bedding.' },
  { id: 'robot-vacuum', name: 'Robot Vacuum', category: 'pets', price: 900, icon: '🤖', blurb: 'Bumps around the floor. The cat rides it sometimes.' },
  { id: 'parrot', name: 'Parrot', category: 'pets', price: 1200, icon: '🦜', blurb: 'Perches by the window and whistles along.' },
  // limited-time (real calendar)
  { id: 'pumpkin-lantern', name: 'Jack-o’-Lantern', category: 'furniture', price: 300, icon: '🎃', limited: { from: '10-01', to: '10-31', event: 'Halloween' }, blurb: 'Flickers spookily at night.' },
  { id: 'witch-hat', name: 'Witch Hat', category: 'attire', price: 350, icon: '🧹', slot: 'hat', limited: { from: '10-01', to: '10-31', event: 'Halloween' }, blurb: 'Pointy, purple-banded, very studious.' },
  { id: 'ghost-plush', name: 'Friendly Ghost', category: 'furniture', price: 250, icon: '👻', limited: { from: '10-01', to: '10-31', event: 'Halloween' }, blurb: 'Bobs around the room saying boo (quietly).' },
  { id: 'bat-garland', name: 'Bat Garland', category: 'furniture', price: 200, icon: '🦇', limited: { from: '10-01', to: '10-31', event: 'Halloween' }, blurb: 'Paper bats strung across the wall.' },
  { id: 'harvest-wreath', name: 'Harvest Wreath', category: 'furniture', price: 250, icon: '🍂', limited: { from: '11-01', to: '11-30', event: 'Harvest' }, blurb: 'Autumn leaves and berries on the wall.' },
  { id: 'festive-tree', name: 'Festive Tree', category: 'furniture', price: 600, icon: '🎄', limited: { from: '12-01', to: '01-06', event: 'Winter festival' }, blurb: 'Twinkling lights and a star on top.' },
  { id: 'santa-hat', name: 'Santa Hat', category: 'attire', price: 300, icon: '🎅', slot: 'hat', limited: { from: '12-01', to: '01-06', event: 'Winter festival' }, blurb: 'Ho ho homework.' },
  { id: 'snow-globe', name: 'Snow Globe', category: 'furniture', price: 250, icon: '🔮', limited: { from: '12-01', to: '01-06', event: 'Winter festival' }, blurb: 'Swirls when you tap the desk.' },
  { id: 'red-lanterns', name: 'Red Lanterns', category: 'furniture', price: 350, icon: '🏮', limited: { from: '01-20', to: '02-20', event: 'Lunar New Year' }, blurb: 'Glowing paper lanterns for good fortune.' },
  { id: 'heart-lamp', name: 'Heart Lamp', category: 'furniture', price: 300, icon: '💖', limited: { from: '02-01', to: '02-20', event: 'Valentine’s' }, blurb: 'A soft pink glow.' },
  { id: 'flower-vase', name: 'Tulip Vase', category: 'furniture', price: 200, icon: '🌷', limited: { from: '03-15', to: '04-30', event: 'Spring bloom' }, blurb: 'Fresh tulips on the desk.' },
  { id: 'bunny-ears', name: 'Bunny Ears', category: 'attire', price: 200, icon: '🐰', slot: 'hat', limited: { from: '03-15', to: '04-30', event: 'Spring bloom' }, blurb: 'Floppy and fabulous.' },
  { id: 'desk-fan', name: 'Desk Fan', category: 'furniture', price: 250, icon: '🌀', limited: { from: '06-15', to: '08-31', event: 'Summer' }, blurb: 'Whirrs away the heat.' },
  { id: 'sunglasses', name: 'Sunglasses', category: 'attire', price: 200, icon: '😎', slot: 'face', limited: { from: '06-15', to: '08-31', event: 'Summer' }, blurb: 'Too cool for school (but still studying).' },
  { id: 'study-globe', name: 'Desk Globe', category: 'furniture', price: 300, icon: '🌍', limited: { from: '09-01', to: '09-30', event: 'Back to school' }, blurb: 'Spins slowly while he thinks.' },
];

const mmdd = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Is a limited item in its window right now? (Always true for regular items.) */
export function isAvailable(item: Item, now: number): boolean {
  if (!item.limited) return true;
  const today = mmdd(now);
  const { from, to } = item.limited;
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
}

/** Whole days left in a limited item's window (0 on the last day), or null if not limited / not available. */
export function daysLeft(item: Item, now: number): number | null {
  if (!item.limited || !isAvailable(item, now)) return null;
  const d = new Date(now);
  const [m, day] = item.limited.to.split('-').map(Number);
  let end = new Date(d.getFullYear(), m - 1, day);
  if (end.getTime() < new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) end = new Date(d.getFullYear() + 1, m - 1, day);
  return Math.round((end.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
}

/** Next date (epoch ms, local midnight) a limited item becomes available. */
export function nextAvailable(item: Item, now: number): number | null {
  if (!item.limited) return null;
  const d = new Date(now);
  const [m, day] = item.limited.from.split('-').map(Number);
  let start = new Date(d.getFullYear(), m - 1, day);
  if (start.getTime() <= now) start = new Date(d.getFullYear() + 1, m - 1, day);
  return start.getTime();
}

export const itemById = (id: string) => ITEMS.find((i) => i.id === id);
export const slotOf = (item: Item) => item.slot ?? item.id;
