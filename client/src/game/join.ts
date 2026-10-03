// Party entry: create a room, or join one by code / QR link (/r/CODE).
import { h } from '../ui/dom.ts';

const NAME_KEY = 'rr.name';
export const savedName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

/** A small card asking for a name (and a code when joining without a link). */
export function joinCard(opts: { title: string; code?: string; askCode: boolean; cta: string; onSubmit: (name: string, code: string) => Promise<void>; onCancel: () => void }): HTMLElement {
  const name = h('input', { class: 'field', id: 'join-name', maxlength: '20', autocomplete: 'nickname', placeholder: 'Your name', value: savedName(), required: true }) as HTMLInputElement;
  const code = h('input', { class: 'field field--code', id: 'join-code', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'CODE', value: opts.code ?? '', required: true }) as HTMLInputElement;
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn--big', type: 'submit', 'data-join-submit': '' }, opts.cta) as HTMLButtonElement;
  const form = h(
    'form',
    { class: 'card join-card', 'aria-label': opts.title },
    h('h2', {}, opts.title),
    opts.askCode ? h('label', { for: 'join-code', class: 'field-label' }, 'Room code') : '',
    opts.askCode ? code : opts.code ? h('div', { class: 'join-card__code num' }, opts.code) : '',
    h('label', { for: 'join-name', class: 'field-label' }, 'Your name'),
    name,
    err,
    submit,
    h('button', { type: 'button', class: 'chip', onclick: opts.onCancel }, 'Back'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    const c = (opts.askCode ? code.value : opts.code ?? '').trim().toUpperCase();
    if (!n || (opts.askCode && c.length !== 4)) {
      err.hidden = false;
      err.textContent = !n ? 'Enter a name so others know who you are.' : 'Room codes are 4 letters.';
      return;
    }
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {}
    submit.disabled = true;
    submit.textContent = 'Joining…';
    try {
      await opts.onSubmit(n, c);
    } catch (ex) {
      err.hidden = false;
      err.textContent = (ex as Error).message;
      submit.disabled = false;
      submit.textContent = opts.cta;
    }
  });
  queueMicrotask(() => (opts.askCode && !opts.code ? code : name).focus());
  return h('div', { class: 'join-wrap' }, form);
}
