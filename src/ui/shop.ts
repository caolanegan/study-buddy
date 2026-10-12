// Shop: category tabs + item cards (buy / equip / unequip).
import * as actions from '../core/actions';
import { CATEGORIES, ITEMS, slotOf, type Item } from '../core/catalog';
import { balance } from '../core/economy';
import { h, mount } from './dom';
import { formatCoins } from './format';
import { toast } from './overlay';
import { liveMultiplier, shopButton } from './viewmodel';
import type { Ctx } from './context';

const SLOT_NAMES: Record<string, string> = { hat: 'hat', face: 'face', ears: 'ears', top: 'top', monitor: 'monitor', desk: 'desk' };

export function createShopView(ctx: Ctx) {
  const el = h('section', { class: 'view view-shop', 'aria-label': 'Shop' });

  function act(item: Item, action: string) {
    const { store, audio } = ctx;
    const now = ctx.now();
    if (action === 'buy') {
      const r = actions.buy(store.get(), item.id, now);
      if (r.error) return toast('Can’t buy that right now', '🚫');
      store.set(r.state);
      audio.play('purchase');
      toast(`${item.name} is in your room!`, item.icon, 2600, 'shop');
    } else if (action === 'equip') {
      store.set(actions.equip(store.get(), item.id, now));
      audio.play('click');
    } else if (action === 'unequip') {
      store.set(actions.unequip(store.get(), item.id, now));
      audio.play('click');
    }
  }

  function render() {
    const state = ctx.store.get();
    const now = ctx.now();
    const mult = liveMultiplier(state, now);
    const cat = ctx.prefs.shopCategory;
    const tabs = h(
      'div',
      { class: 'cat-tabs', role: 'tablist', 'aria-label': 'Shop categories' },
      CATEGORIES.map((c) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'cat-tab',
            'aria-selected': String(c.id === cat),
            onclick: () => {
              ctx.prefs.shopCategory = c.id;
              ctx.savePrefs();
              render();
            },
          },
          h('span', { 'aria-hidden': 'true' }, c.icon),
          c.name,
        ),
      ),
    );
    const items = ITEMS.filter((i) => i.category === cat).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    const grid = h(
      'div',
      { class: 'item-grid', role: 'tabpanel' },
      items.map((item) => {
        const b = shopButton(state, item, mult);
        const owned = actions.owns(state, item.id);
        const equipped = actions.isEquipped(state, item.id);
        const slot = slotOf(item);
        const shared = ITEMS.some((o) => o.id !== item.id && slotOf(o) === slot);
        return h(
          'article',
          { class: `item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''} ${b.disabled ? 'unavailable' : ''}` },
          h('div', { class: 'item-icon', 'aria-hidden': 'true' }, item.icon),
          h(
            'div',
            { class: 'item-main' },
            h('h3', { class: 'item-name' }, item.name, equipped ? h('span', { class: 'tag tag-on' }, 'In room') : owned ? h('span', { class: 'tag' }, 'Owned') : null),
            h('p', { class: 'item-blurb' }, item.blurb),
            shared ? h('p', { class: 'item-slot muted small' }, `Swaps with other ${SLOT_NAMES[slot] ?? slot} items`) : null,
            b.hint && !owned ? h('p', { class: 'item-hint small' }, b.hint) : null,
          ),
          h(
            'div',
            { class: 'item-buy' },
            h(
              'button',
              {
                type: 'button',
                class: `btn btn-small ${b.action === 'buy' ? 'btn-primary' : b.action === 'equip' ? 'btn-go' : 'btn-ghost'}`,
                disabled: b.disabled,
                'aria-label': `${b.label} — ${item.name}`,
                onclick: () => act(item, b.action),
              },
              b.label,
            ),
          ),
        );
      }),
    );
    mount(
      el,
      h('div', { class: 'view-head' }, h('h2', null, 'Shop'), h('span', { class: 'chip' }, h('span', { 'aria-hidden': 'true' }, '🪙 '), h('b', null, formatCoins(balance(state))))),
      h('p', { class: 'muted small view-intro' }, 'Earn coins by studying, then decorate the room. Purchases appear right away.'),
      tabs,
      grid,
    );
  }

  return { el, render };
}
