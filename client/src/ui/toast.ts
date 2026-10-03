import { h } from './dom.ts';

let el: HTMLElement | null = null;
let timer: number | undefined;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  el?.remove();
  el = h('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  document.body.append(el);
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.remove(), 3500);
}
