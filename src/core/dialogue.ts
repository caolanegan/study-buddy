// What the buddy says in little speech bubbles. Pure + deterministic given `rnd`.
import type { Weather } from './weather';
import type { ViewId } from './profile';

export type BubbleReason =
  | 'greet' // app opened
  | 'tap' // user tapped the buddy
  | 'start' // session started
  | 'idle-chat' // random thought while idle
  | 'study-chat' // random thought while studying
  | 'break' // pomodoro break began
  | 'back' // break over
  | 'end' // session ended
  | 'milestone' // new sim day / season / big total
  | 'event' // something happened outside
  | 'caught' // caught a shooting star etc.
  | 'pet' // tapped a pet
  | 'letter'; // a letter arrived

export interface BubbleCtx {
  reason: BubbleReason;
  name: string;
  hour: number; // real-world local hour 0..23
  isNight: boolean; // sim night
  season: 0 | 1 | 2 | 3;
  weather: Weather;
  view: ViewId;
  streak: number;
  todayMin: number;
  sessionMin: number;
  goalMin: number;
  /** for 'event' / 'caught' */
  event?: string;
  /** for 'pet' */
  pet?: string;
  /** for 'milestone' */
  milestone?: string;
}

type Line = string | ((c: BubbleCtx) => string | null);

const pick = <T>(arr: T[], rnd: () => number): T => arr[Math.floor(rnd() * arr.length) % arr.length];

const GREET: Line[] = [
  (c) => (c.hour < 5 ? 'Late one, huh? I’ll keep you company.' : c.hour < 12 ? 'Morning! ☀️ Ready when you are.' : c.hour < 18 ? 'Hey, you’re back! 👋' : 'Evening! Cozy study session?'),
  (c) => (c.streak >= 2 ? `${c.streak}-day streak! Let’s keep it going 🔥` : null),
  (c) => (c.todayMin > 0 && c.todayMin < c.goalMin ? `${c.goalMin - c.todayMin} min to today’s goal. We’ve got this.` : null),
  (c) => (c.todayMin >= c.goalMin ? 'Goal done today! Anything extra is a bonus ✨' : null),
  'I saved you the good chair.',
  'I made coffee. Well, I thought about making coffee.',
];

const TAP: Line[] = [
  'Hi! 👋',
  'Oh! You scared me 😄',
  'Mm? I’m listening.',
  'Psst — you’re doing great.',
  'Five more minutes, then a stretch?',
  (c) => (c.sessionMin > 0 ? `${c.sessionMin} minutes in. Nice focus!` : 'Shall we start a session?'),
  (c) => (c.weather === 'rain' ? 'Love the rain. Perfect studying weather.' : null),
  (c) => (c.weather === 'snow' ? 'Snow! ❄️ Hot chocolate after this?' : null),
  (c) => (c.isNight ? 'The stars are out. Make a wish later?' : null),
  (c) => (c.streak >= 3 ? `Day ${c.streak} of the streak. Look at us!` : null),
  'Did you drink some water?',
  'Hehe. That tickles.',
  'I believe in you, you know.',
  'Tell me something you learned today!',
  '*waves enthusiastically*',
  'Don’t forget to blink 👀',
];

const START: Line[] = [
  'Let’s do this! 📚',
  'Focus mode: on.',
  'Phone face down? Okay, go!',
  'I’ll be right here working too.',
  (c) => (c.hour < 9 ? 'Early start — future you says thanks.' : null),
  (c) => (c.hour >= 22 ? 'Night session! Let’s keep it gentle.' : null),
  'One small step at a time.',
];

const STUDY: Line[] = [
  'Mmm, flow state.',
  'Ooh, that makes sense now.',
  'Hm. Let me read that again.',
  'Tiny progress is still progress.',
  '*scribbles notes*',
  (c) => (c.sessionMin >= 50 ? 'Long session! Maybe a stretch soon?' : null),
  (c) => (c.sessionMin >= 25 && c.sessionMin < 30 ? '25 minutes! Nice block.' : null),
  (c) => (c.weather === 'storm' ? 'Wow, listen to that thunder ⛈️' : null),
  (c) => (c.weather === 'fog' ? 'Foggy out. Cozy in here though.' : null),
  (c) => (c.season === 2 ? 'Leaves are turning. Love autumn studying 🍂' : null),
  (c) => (c.season === 0 ? 'Everything’s blooming out there 🌸' : null),
  (c) => (c.season === 1 ? 'Sunny days. Iced coffee energy ☀️' : null),
  (c) => (c.season === 3 ? 'Snowy days are for deep focus ❄️' : null),
  (c) => (c.view === 'seaside' ? 'Hear the waves? So calming.' : null),
  (c) => (c.view === 'city' ? 'City lights make me feel productive.' : null),
  (c) => (c.view === 'forest' ? 'The forest is so quiet today.' : null),
  (c) => (c.view === 'countryside' ? 'The sheep are judging my notes.' : null),
  'Coffee: 60%. Me: 100%.',
];

const IDLE: Line[] = [
  'Whenever you’re ready ☕',
  'I could study a little… with you?',
  (c) => (c.todayMin === 0 ? 'Even 10 minutes today keeps the streak alive.' : null),
  (c) => (c.isNight ? '*yawns*' : 'What a nice day.'),
  'I rearranged my pens. Very productive.',
  (c) => (c.weather === 'rain' ? 'Rain on the window… so cozy.' : null),
  'Pomodoro? 🍅',
];

const BREAK: Line[] = ['Break time! Stretch with me 🙆', 'Rest your eyes — look at something far away.', 'Water break 💧', 'Nice block! Five minutes off.', 'Snack time?'];
const BACK: Line[] = ['Back to it! 💪', 'Refreshed. Let’s go.', 'Next round!', 'Focus up 📚'];
const END: Line[] = [
  (c) => (c.sessionMin >= 60 ? 'Huge session! Proud of you 🎉' : null),
  (c) => (c.sessionMin >= 25 ? 'Great work today!' : 'Every minute counts. Nice!'),
  'Session saved ✨',
  (c) => (c.todayMin >= c.goalMin ? 'Daily goal smashed! 🏁' : null),
];
const CAUGHT: Line[] = [
  (c) => (c.event === 'shooting-star' ? 'You caught a star! Make a wish ✨' : null),
  (c) => (c.event === 'bird-visit' ? 'Aww, the little bird says hi! 🐦' : null),
  (c) => (c.event === 'balloon' ? 'They waved back from the balloon! 🎈' : null),
  (c) => (c.event === 'ufo' ? 'WAS THAT A UFO?! 👽' : null),
  'Nice catch!',
];
const EVENT: Line[] = [
  (c) => (c.event === 'shooting-star' ? 'Shooting star! Quick, tap it!' : null),
  (c) => (c.event === 'rainbow' ? 'Look — a rainbow! 🌈' : null),
  (c) => (c.event === 'balloon' ? 'A hot air balloon! 🎈' : null),
  (c) => (c.event === 'aurora' ? 'The northern lights… wow.' : null),
  (c) => (c.event === 'fireworks' ? 'Fireworks! Happy new year! 🎆' : null),
  (c) => (c.event === 'bird-visit' ? 'A little visitor on the windowsill!' : null),
  (c) => (c.event === 'ufo' ? '…did you see that?' : null),
  (c) => (c.event === 'kite' ? 'Someone’s flying a kite!' : null),
  (c) => (c.event === 'dolphin' || c.event === 'whale' ? 'Did you see that splash?! 🐬' : null),
  (c) => (c.event === 'deer' || c.event === 'fox' ? 'Shh… there’s someone in the trees.' : null),
  (c) => (c.event === 'train' ? 'There goes the train.' : null),
];
const PET: Line[] = [
  (c) => (c.pet === 'cat' ? 'She loves you. Probably. 🐱' : null),
  (c) => (c.pet === 'dog' ? 'Who’s a good study buddy? 🐶' : null),
  (c) => (c.pet === 'fish-tank' ? 'The fish say blub.' : null),
  (c) => (c.pet === 'hamster' ? 'Wheel go brrr 🐹' : null),
  (c) => (c.pet === 'parrot' ? '“Study hard! Squawk!”' : null),
  (c) => (c.pet === 'lizard' ? 'He’s basking. Living his best life.' : null),
];
const MILESTONE: Line[] = [(c) => c.milestone ?? 'Milestone! 🎉'];
const LETTER: Line[] = ['Ooh, a letter came for you! ✉️', 'Mail’s here! 📬'];

const TABLE: Record<BubbleReason, Line[]> = {
  greet: GREET,
  tap: TAP,
  start: START,
  'study-chat': STUDY,
  'idle-chat': IDLE,
  break: BREAK,
  back: BACK,
  end: END,
  event: EVENT,
  caught: CAUGHT,
  pet: PET,
  milestone: MILESTONE,
  letter: LETTER,
};

/** Pick a line for the situation. Context-specific lines are preferred when they apply. */
export function pickLine(c: BubbleCtx, rnd: () => number = Math.random): string {
  const lines = TABLE[c.reason];
  const resolved = lines.map((l) => (typeof l === 'function' ? l(c) : l)).filter((x): x is string => !!x);
  // context lines (functions that returned something) get double weight
  const contextual = lines.filter((l) => typeof l === 'function').map((l) => (l as (c: BubbleCtx) => string | null)(c)).filter((x): x is string => !!x);
  const pool = [...resolved, ...contextual];
  return pool.length ? pick(pool, rnd) : '…';
}
