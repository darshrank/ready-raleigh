type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

/** Tiny element helper: h('button', { class: 'btn', onclick }, 'Go'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

export function svg(markup: string): Node {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild!;
}
