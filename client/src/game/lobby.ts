// Lobby (PLAN §4, §8.3 #2): big code + QR, avatars, host settings tiles, ready states.
import { ROUND_COUNTS, TIMERS_S, type GameSettings, type PublicState } from '@rr/shared';
import { call } from '../net/socket.ts';
import { h } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';

const RULES: Record<GameSettings['rules'], string> = { normal: 'Normal', no_lenses: 'No lenses', pro: 'Pro' };
const RULE_HINT: Record<GameSettings['rules'], string> = { normal: 'Lenses cost 10% each', no_lenses: 'No lenses', pro: 'No lenses, no street photo' };

export function lobbySheet(s: PublicState, opts: { tv: boolean }): HTMLElement {
  const me = s.players.find((p) => p.seat === s.you);
  const host = s.you === s.hostSeat;
  const err = (e: Error) => toast(e.message, 'error');
  const set = (patch: Partial<GameSettings>) => call('room:settings', { settings: patch }).catch(err);

  const tile = <T extends string | number>(label: string, value: T, opts2: readonly T[], fmt: (v: T) => string, key: keyof GameSettings) =>
    h(
      'div',
      { class: 'tile' },
      h('div', { class: 'tile__label' }, label),
      h('div', { class: 'tile__opts', role: 'radiogroup', 'aria-label': label }, ...opts2.map((v) => h('button', { class: `seg__opt ${v === value ? 'is-on' : ''}`, role: 'radio', 'aria-checked': String(v === value), disabled: !host, onclick: () => set({ [key]: v } as Partial<GameSettings>) }, fmt(v)))),
    );

  const code = h('div', { class: 'lobby__code num', 'aria-label': `Room code ${s.code.split('').join(' ')}` }, s.code);
  const qr = h('img', { class: 'lobby__qr', src: `/qr/${s.code}.png`, alt: `QR code to join room ${s.code}`, width: '148', height: '148' });
  const waiting = s.players.filter((p) => p.connected && p.seat !== s.hostSeat && !p.ready);
  const start = h('button', { class: 'btn btn--big', 'data-start': '', disabled: waiting.length > 0, onclick: () => call('room:start', {}).catch(err) }, waiting.length ? `Waiting for ${waiting.length} player${waiting.length > 1 ? 's' : ''}…` : 'Start game');
  const ready = h('button', { class: `btn btn--big ${me?.ready ? 'btn--ghost' : ''}`, 'data-ready-btn': '', onclick: () => call('player:ready', { ready: !me?.ready }).catch(err) }, me?.ready ? 'Ready ✓ (tap to undo)' : 'I’m ready');

  return h(
    'div',
    { class: `lobby ${opts.tv ? 'lobby--tv' : ''}` },
    h(
      'div',
      { class: 'lobby__join' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Join on your phone'), code, h('div', { class: 'lobby__url' }, s.joinUrl.replace(/^https?:\/\//, ''))),
      qr,
    ),
    h(
      'ul',
      { class: 'avatars', 'aria-label': 'Players' },
      ...s.players.map((p) =>
        h(
          'li',
          { class: `avatar ${p.connected ? '' : 'is-away'}`, style: `--pc:${p.color}` },
          h('span', { class: 'avatar__hat', 'aria-hidden': 'true' }, p.shape),
          h('span', { class: 'avatar__name' }, p.name, p.seat === s.hostSeat ? h('span', { class: 'avatar__tag' }, 'host') : '', p.seat === s.you ? h('span', { class: 'avatar__tag' }, 'you') : ''),
          h('span', { class: `avatar__ready ${p.ready || p.seat === s.hostSeat ? 'is-on' : ''}` }, p.seat === s.hostSeat || p.ready ? 'Ready' : p.connected ? 'Not ready' : 'Away'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'tiles' },
      tile('Map', s.settings.area, ['crabtree'], () => 'Crabtree Creek', 'area'),
      h('div', { class: 'tile' }, h('div', { class: 'tile__label' }, 'Mode'), h('div', { class: 'tile__opts' }, h('button', { class: 'seg__opt is-on', disabled: true }, 'Flood'), h('button', { class: 'seg__opt', disabled: true }, 'Heat', h('span', { class: 'pill pill--soon' }, 'Soon')))),
      tile('Rounds', s.settings.rounds, ROUND_COUNTS, String, 'rounds'),
      tile('Timer', s.settings.timerS, TIMERS_S, (v) => `${v}s`, 'timerS'),
      tile('Rules', s.settings.rules, ['normal', 'no_lenses', 'pro'] as const, (v) => RULES[v], 'rules'),
      h('div', { class: 'tile__hint' }, RULE_HINT[s.settings.rules]),
    ),
    opts.tv ? h('p', { class: 'lobby__tvhint' }, `${s.players.length} player${s.players.length === 1 ? '' : 's'} · the host starts the game from their phone`) : host ? start : ready,
    !opts.tv && !s.tvConnected ? h('a', { class: 'chip lobby__tvlink', href: `/tv/${s.code}`, target: '_blank', rel: 'noopener' }, 'Show on a TV ↗') : '',
  );
}
