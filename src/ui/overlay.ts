// Modals (bottom sheet on phones, dialog on wide screens) and toasts.
import { h, type Child } from './dom';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'danger' | 'ghost' | 'go';
  /** Return false to keep the modal open. */
  onClick?: () => void | boolean | Promise<void | boolean>;
  autofocus?: boolean;
}

export interface ModalOptions {
  title: string;
  icon?: string;
  body?: Child;
  actions?: ModalAction[];
  /** Esc / backdrop closes it (default true). */
  dismissable?: boolean;
  onClose?: () => void;
  className?: string;
}

export interface ModalHandle {
  close(): void;
  el: HTMLElement;
  isOpen(): boolean;
}

const stack: { handle: ModalHandle; opts: ModalOptions }[] = [];
let root: HTMLElement;
let toastRoot: HTMLElement;

export function initOverlays(modalRoot: HTMLElement, toasts: HTMLElement) {
  root = modalRoot;
  toastRoot = toasts;
  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape' && top.opts.dismissable !== false) {
      e.preventDefault();
      top.handle.close();
    } else if (e.key === 'Tab') {
      // keep focus inside the top-most dialog
      const f = [...top.handle.el.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter(
        (x) => !x.hasAttribute('disabled'),
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

export function modalOpen(): boolean {
  return stack.length > 0;
}

let seq = 0;
export function openModal(opts: ModalOptions): ModalHandle {
  const prevFocus = document.activeElement as HTMLElement | null;
  const titleId = `modal-title-${++seq}`;
  let open = true;
  const actions = (opts.actions ?? []).map((a) => {
    const b = h('button', { class: `btn btn-${a.kind ?? 'ghost'}`, type: 'button' }, a.label);
    b.addEventListener('click', async () => {
      const r = a.onClick ? await a.onClick() : undefined;
      if (r !== false) handle.close();
    });
    return { a, b };
  });
  const card = h(
    'div',
    { class: `modal ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    opts.icon ? h('div', { class: 'modal-icon', 'aria-hidden': 'true' }, opts.icon) : null,
    h('h2', { id: titleId, class: 'modal-title' }, opts.title),
    opts.body ? h('div', { class: 'modal-body' }, opts.body) : null,
    actions.length ? h('div', { class: 'modal-actions' }, actions.map((x) => x.b)) : null,
  );
  const backdrop = h('div', { class: 'backdrop' }, card);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && opts.dismissable !== false) handle.close();
  });
  const handle: ModalHandle = {
    el: card,
    isOpen: () => open,
    close() {
      if (!open) return;
      open = false;
      const i = stack.findIndex((x) => x.handle === handle);
      if (i >= 0) stack.splice(i, 1);
      backdrop.classList.add('closing');
      const done = () => backdrop.remove();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
      else setTimeout(done, 160);
      opts.onClose?.();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    },
  };
  stack.push({ handle, opts });
  root.appendChild(backdrop);
  const focusTarget = actions.find((x) => x.a.autofocus)?.b ?? card.querySelector<HTMLElement>('input, select') ?? actions[actions.length - 1]?.b;
  requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
  return handle;
}

export function confirmDialog(title: string, text: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title,
      body: h('p', null, text),
      actions: [
        { label: 'Cancel', kind: 'ghost', autofocus: true },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => void (result = true) },
      ],
      onClose: () => resolve(result),
    });
  });
}

/** `key`: a newer toast with the same key replaces the older one. */
export function toast(text: string, icon = '✨', ms = 4200, key?: string) {
  if (key) toastRoot.querySelector(`[data-key="${key}"]`)?.remove();
  const el = h('div', { class: 'toast', role: 'status', 'data-key': key }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon), h('span', null, text));
  toastRoot.appendChild(el);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild?.remove();
  setTimeout(() => {
    el.classList.add('closing');
    setTimeout(() => el.remove(), 250);
  }, ms);
}
