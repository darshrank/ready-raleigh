// Source sheet (PLAN §8.3 #9): opened from any number. Dataset, date, method, link.
import type { Source } from '@rr/shared';
import { h } from './dom.ts';

let open: HTMLElement | null = null;

export function showSource(title: string, value: string, src: Source, extra?: string): void {
  close();
  const sheet = h(
    'div',
    { class: 'srcsheet-backdrop', onclick: (e: Event) => e.target === e.currentTarget && close() },
    h(
      'section',
      { class: 'card srcsheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Source for ${title}` },
      h('div', { class: 'srcsheet__head' }, h('div', {}, h('div', { class: 'eyebrow' }, title), h('div', { class: 'srcsheet__value num' }, value)), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      h('dl', { class: 'srcsheet__dl' }, h('dt', {}, 'Dataset'), h('dd', {}, src.dataset), h('dt', {}, 'Date'), h('dd', {}, src.date), h('dt', {}, 'Method'), h('dd', {}, src.method)),
      ...(extra ? [h('p', { class: 'srcsheet__extra' }, extra)] : []),
      h('a', { class: 'btn btn--ghost srcsheet__link', href: src.url, target: '_blank', rel: 'noopener' }, 'Open source ↗'),
    ),
  );
  document.body.append(sheet);
  open = sheet;
  (sheet.querySelector('.icon-btn') as HTMLElement).focus();
  document.addEventListener('keydown', onKey);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

export function close(): void {
  open?.remove();
  open = null;
  document.removeEventListener('keydown', onKey);
}

/** A tappable number that opens its source sheet. */
export function sourced(text: string, title: string, src: Source, extra?: string, cls = ''): HTMLElement {
  return h('button', { class: `sourced num ${cls}`, title: 'Where does this number come from?', onclick: (e: Event) => { e.stopPropagation(); showSource(title, text, src, extra); } }, text);
}
