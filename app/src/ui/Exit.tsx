// The way out of a game: back to the main menu (the landing page) from any phase.
import { usePlan } from '../plan/store';
import { navigate } from '../router';
import { hush } from './voice';

/** Stop talking, forget the game, and go to the main menu. */
export function leaveGame() {
  hush();
  usePlan.getState().restart();
  navigate('/');
}

/**
 * "Main menu" in the style of the other HUD buttons. While planning with pieces placed it asks
 * first, so a stray tap does not throw a plan away.
 */
export function MenuButton({ wide = false }: { wide?: boolean }) {
  const onClick = () => {
    const { phase, placements } = usePlan.getState();
    if (phase === 'planning' && placements.length > 0 && !window.confirm('Leave this game? Your plan will be lost.')) return;
    leaveGame();
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Main menu"
      className={
        'pointer-events-auto h-10 border-(length:--rule) border-ink bg-bond px-3 text-15 font-semibold whitespace-nowrap shadow-piece hover:bg-chalk' +
        (wide ? ' w-full' : '')
      }
    >
      {/* Short on phones, where the row of map buttons is tight. */}
      <span className="sm:hidden">Menu</span>
      <span className="hidden sm:inline">Main menu</span>
    </button>
  );
}
