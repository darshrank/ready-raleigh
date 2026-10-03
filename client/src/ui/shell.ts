import type { GameMap } from '../map/createMap.ts';
import { h, svg } from './dom.ts';
import { icons } from './icons.ts';

export function brand(): HTMLElement {
  return h(
    'header',
    { class: 'card brand' },
    h('div', { class: 'brand__mark' }, svg(icons.mark)),
    h('div', {}, h('div', { class: 'brand__name' }, 'Ready Raleigh'), h('div', { class: 'brand__sub' }, 'Flood & heat, read like a pro')),
  );
}

/** Rotate / compass buttons: every gesture also has a button (PLAN.md §8.5). */
export function cameraControls(gm: GameMap): HTMLElement {
  const compass = h('button', { class: 'cam__btn cam__compass', 'aria-label': 'Face north', title: 'Face north', onclick: () => gm.resetNorth() }, svg(icons.compass));
  const update = () => {
    const icon = compass.firstElementChild as SVGElement | null;
    if (icon) icon.style.transform = `rotate(${-gm.map.getBearing()}deg)`;
  };
  gm.map.on('rotate', update);
  update();
  return h(
    'nav',
    { class: 'card cam', 'aria-label': 'Camera' },
    h('button', { class: 'cam__btn', 'aria-label': 'Rotate left 45°', title: 'Rotate left', onclick: () => gm.rotateBy(-1) }, svg(icons.rotateLeft)),
    compass,
    h('button', { class: 'cam__btn', 'aria-label': 'Rotate right 45°', title: 'Rotate right', onclick: () => gm.rotateBy(1) }, svg(icons.rotateRight)),
  );
}

export function loadingOverlay(): HTMLElement {
  return h(
    'div',
    { class: 'overlay', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'state' },
      h('div', { class: 'loader', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      h('h2', {}, 'Building Raleigh in 3D'),
      h('p', {}, 'Loading streets, buildings and terrain…'),
    ),
  );
}

export function errorOverlay(message: string, retry: () => void): HTMLElement {
  return h(
    'div',
    { class: 'overlay', role: 'alert' },
    h(
      'div',
      { class: 'card state' },
      h('div', { class: 'icon-danger' }, svg(icons.alert)),
      h('h2', {}, 'The map didn’t load'),
      h('p', {}, message),
      h('button', { class: 'btn', onclick: retry }, 'Try again'),
    ),
  );
}
