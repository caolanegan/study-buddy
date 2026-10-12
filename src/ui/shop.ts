// Shop: category tabs (plus a ✨ Limited tab while an event is live) + item cards (buy / equip / unequip).
import * as actions from '../core/actions';
import type { AppState } from '../core/types';
import { CATEGORIES, ITEMS, isAvailable, slotOf, type Item } from '../core/catalog';
import { balance } from '../core/economy';
import { h, mount } from './dom';
import { formatCoins } from './format';
import { toast } from './overlay';
import { liveMultiplier, shopButton } from './viewmodel';
import { comingUp, eventIcon, formatEventDate, limitedBadge, liveEvents, visibleInCategory, type LimitedEvent } from './goalsvm';
import type { ShopTab } from './prefs';
import type { Ctx } from './context';

const SLOT_NAMES: Record<string, string> = { hat: 'hat', face: 'face', ears: 'ears', top: 'top', monitor: 'monitor', desk: 'desk' };

const byPrice = (a: Item, b: Item) => a.price - b.price || a.name.localeCompare(b.name);

export function createShopView(ctx: Ctx) {
  const el = h('section', { class: 'view view-shop', 'aria-label': 'Shop' });

  function act(item: Item, action: string) {
    const { store, audio } = ctx;
    const now = ctx.now();
    if (action === 'buy') {
      const r = actions.buy(store.get(), item.id, now);
      if (r.error) return toast(r.error === 'expired' ? `${item.name} is out of season` : 'Can’t buy that right now', '🚫');
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

  function card(state: AppState, item: Item, mult: number, now: number) {
    const b = shopButton(state, item, mult, now);
    const owned = actions.owns(state, item.id);
    const equipped = actions.isEquipped(state, item.id);
    const slot = slotOf(item);
    const shared = ITEMS.some((o) => o.id !== item.id && slotOf(o) === slot);
    const badge = item.limited ? limitedBadge(item, now) : null;
    const urgent = badge !== null && /Last day|^[1-3] day/.test(badge);
    return h(
      'article',
      { class: `item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''} ${b.disabled ? 'unavailable' : ''} ${item.limited ? 'is-limited' : ''}` },
      h('div', { class: 'item-icon', 'aria-hidden': 'true' }, item.icon),
      h(
        'div',
        { class: 'item-main' },
        h('h3', { class: 'item-name' }, item.name, equipped ? h('span', { class: 'tag tag-on' }, 'In room') : owned ? h('span', { class: 'tag' }, 'Owned') : null),
        item.limited && !owned
          ? h(
              'p',
              { class: 'item-limited' },
              h('span', { class: `ltag ltag-time ${urgent ? 'urgent' : ''}`, title: `${item.limited.event} limited edition` }, `${eventIcon(item.limited.event)} ${badge ?? item.limited.event}`),
            )
          : item.limited
            ? h('p', { class: 'item-limited' }, h('span', { class: 'ltag ltag-owned' }, `${eventIcon(item.limited.event)} ${item.limited.event} edition`))
            : null,
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
  }

  function upcoming(ev: LimitedEvent, now: number) {
    const days = Math.max(1, Math.ceil((ev.from! - now) / 86_400_000));
    return h(
      'div',
      { class: 'coming-up' },
      h('div', { class: 'cu-icon', 'aria-hidden': 'true' }, eventIcon(ev.event)),
      h(
        'div',
        { class: 'cu-text' },
        h('div', { class: 'cu-title' }, h('span', { class: 'muted small' }, 'Coming up · '), h('b', null, ev.event)),
        h('div', { class: 'muted small' }, `Arrives ${formatEventDate(ev.from!)} · in ${days} day${days === 1 ? '' : 's'}`),
      ),
      h('div', { class: 'cu-items', 'aria-label': ev.items.map((i) => i.name).join(', ') }, ev.items.map((i) => h('span', { title: i.name }, i.icon))),
    );
  }

  function eventBanner(ev: LimitedEvent) {
    const d = ev.daysLeft ?? 0;
    return h(
      'div',
      { class: `event-banner ev-${ev.event.toLowerCase().replace(/[^a-z]+/g, '-')}` },
      h('span', { class: 'eb-icon', 'aria-hidden': 'true' }, eventIcon(ev.event)),
      h('div', { class: 'eb-text' }, h('b', null, `${ev.event} collection`), h('span', { class: 'small' }, 'Only in the shop for a limited time — yours to keep forever.')),
      h('span', { class: `eb-time ${d <= 3 ? 'urgent' : ''}` }, d <= 0 ? 'Last day!' : `${d} day${d === 1 ? '' : 's'} left`),
    );
  }

  function render() {
    const state = ctx.store.get();
    const now = ctx.now();
    const mult = liveMultiplier(state, now);
    const live = liveEvents(now);
    const next = comingUp(now);
    let cat: ShopTab = ctx.prefs.shopCategory;
    if (cat === 'limited' && !live.length) cat = 'computer';
    const tabDefs: { id: ShopTab; name: string; icon: string }[] = [...(live.length ? [{ id: 'limited' as const, name: 'Limited', icon: '✨' }] : []), ...CATEGORIES];
    const tabs = h(
      'div',
      { class: `cat-tabs ${live.length ? 'has-limited' : ''}`, role: 'tablist', 'aria-label': 'Shop categories' },
      tabDefs.map((c) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `cat-tab ${c.id === 'limited' ? 'cat-limited' : ''}`,
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
    let content: Node[];
    if (cat === 'limited') {
      content = live.map((ev) =>
        h('div', { class: 'event-block' }, eventBanner(ev), h('div', { class: 'item-grid', role: 'tabpanel' }, [...ev.items].sort(byPrice).map((i) => card(state, i, mult, now)))),
      );
      if (next) content.push(upcoming(next, now));
    } else {
      const items = ITEMS.filter((i) => i.category === cat && visibleInCategory(i, actions.owns(state, i.id), now)).sort(
        (a, b) => Number(!!b.limited && isAvailable(b, now)) - Number(!!a.limited && isAvailable(a, now)) || byPrice(a, b),
      );
      content = [h('div', { class: 'item-grid', role: 'tabpanel' }, items.map((i) => card(state, i, mult, now)))];
    }
    mount(
      el,
      h('div', { class: 'view-head' }, h('h2', null, 'Shop'), h('span', { class: 'chip' }, h('span', { 'aria-hidden': 'true' }, '🪙 '), h('b', null, formatCoins(balance(state))))),
      h('p', { class: 'muted small view-intro' }, 'Earn coins by studying, then decorate the room. Purchases appear right away.'),
      !live.length && next ? upcoming(next, now) : null,
      tabs,
      content,
    );
  }

  return { el, render };
}
