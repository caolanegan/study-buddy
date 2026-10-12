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
];

export const itemById = (id: string) => ITEMS.find((i) => i.id === id);
export const slotOf = (item: Item) => item.slot ?? item.id;
