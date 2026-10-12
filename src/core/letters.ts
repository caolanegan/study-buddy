// A little letter slips under the door once per real day. Opening it gives a few
// coins and a kind word from someone in the buddy's world.
import type { AppState } from './types';
import type { ViewId } from './profile';
import { dayKey } from './time';
import { hash01 } from './weather';
import { claimBonus } from './actions';

export interface Letter {
  id: string; // bonus id
  from: string;
  icon: string;
  body: string;
  reward: number;
}

const COMMON: { from: string; icon: string; body: string }[] = [
  { from: 'Grandma', icon: '👵', body: 'Little steps every day add up to big things. I baked cookies — come visit when exams are over!' },
  { from: 'Future You', icon: '🔮', body: 'Hey. It’s me. Thanks for sitting down today — I’m living in the result of it, and it’s lovely here.' },
  { from: 'The Cat', icon: '🐾', body: 'mrrp. the warm spot on your desk is mine. you may study next to it. 🐟' },
  { from: 'Your Desk Plant', icon: '🌱', body: 'I grow a little every time you study. We’re doing this together, you know.' },
  { from: 'Mum', icon: '💌', body: 'Proud of you for showing up. Remember to drink water and eat something green.' },
  { from: 'The Neighbour', icon: '🏡', body: 'Saw your lamp on late again. Whatever you’re working on — it’s going to be worth it.' },
  { from: 'Professor Owl', icon: '🦉', body: 'Understanding is not a race. Read it twice, explain it once, and you’ll own it forever.' },
  { from: 'The Postie', icon: '📮', body: 'Delivered 214 letters today. Yours is my favourite. Keep going!' },
  { from: 'Your Coffee Mug', icon: '☕', body: 'I believe in you. Also please wash me.' },
  { from: 'A Friend', icon: '🧡', body: 'Studying alongside you in spirit. One more page, then a stretch?' },
  { from: 'The Moon', icon: '🌙', body: 'I’ve watched a lot of students work late. The ones who rest well do best. Sleep is studying too.' },
  { from: 'The Sun', icon: '☀️', body: 'Good morning! Open the curtains, take a breath, and begin with the easiest task.' },
  { from: 'Coach', icon: '📣', body: 'Consistency beats intensity. 25 focused minutes today is a win. Go get it.' },
  { from: 'The Library', icon: '📚', body: 'Every expert was once confused by page one. Turn it anyway.' },
  { from: 'Your Notebook', icon: '📓', body: 'I’ve got space for whatever you learn today. Even the messy bits.' },
  { from: 'The Rain', icon: '🌧️', body: 'Perfect weather for focusing. I’ll keep the world quiet for a while.' },
  { from: 'A Tiny Robot', icon: '🤖', body: 'BEEP. ANALYSIS: YOU ARE DOING GREAT. RECOMMENDATION: CONTINUE. BOOP.' },
  { from: 'The Stars', icon: '✨', body: 'We took billions of years to shine. You’re allowed to take your time too.' },
  { from: 'Past You', icon: '⏪', body: 'Remember when this subject felt impossible? Look how far you’ve come.' },
  { from: 'The Kettle', icon: '🫖', body: 'Break time is part of the plan. Tea in five?' },
];

const BY_VIEW: Record<ViewId, { from: string; icon: string; body: string }[]> = {
  street: [{ from: 'The Dog Walker', icon: '🐕', body: 'Biscuit waves at your window every morning. She says good luck!' }],
  seaside: [
    { from: 'The Lighthouse Keeper', icon: '🗼', body: 'I keep the light on so ships find their way home. Keep yours on too.' },
    { from: 'A Seagull', icon: '🐦', body: 'SKREE. (Translation: proud of you. Also, chips?)' },
  ],
  city: [{ from: 'The Night Train', icon: '🚆', body: 'I pass your window at the same time every night. Steady rhythm gets you anywhere.' }],
  countryside: [
    { from: 'The Farmer', icon: '🧑‍🌾', body: 'You can’t rush a harvest. Plant a little every day and trust the season.' },
    { from: 'A Sheep', icon: '🐑', body: 'baa. (Counting you as one of the hardworking ones.)' },
  ],
  forest: [
    { from: 'The Old Pine', icon: '🌲', body: 'I grew one ring a year. Slow and steady made me tall.' },
    { from: 'A Fox', icon: '🦊', body: 'Saw your light through the trees. Clever creatures keep learning.' },
  ],
};

/** Coins for today's letter: a little more when you're on a streak. */
export function letterReward(streak: number): number {
  return 20 + Math.min(streak, 10) * 2;
}

export function todaysLetter(state: AppState, now: number, streak: number): Letter {
  const key = dayKey(now);
  const pool = [...COMMON, ...(BY_VIEW[state.profile.room.view] ?? []), ...(BY_VIEW[state.profile.room.view] ?? [])];
  const seed = [...key].reduce((a, c) => a * 33 + c.charCodeAt(0), 11);
  const pick = pool[Math.floor(hash01(seed) * pool.length)];
  return { id: `letter:${key}`, ...pick, reward: letterReward(streak) };
}

export function letterWaiting(state: AppState, now: number): boolean {
  return !state.bonuses.some((b) => b.id === `letter:${dayKey(now)}`);
}

export function openLetter(state: AppState, letter: Letter, now: number) {
  return claimBonus(state, { id: letter.id, kind: 'letter', reward: letter.reward, label: `Letter from ${letter.from}` }, now);
}
