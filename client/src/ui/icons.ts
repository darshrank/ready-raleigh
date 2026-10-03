const s = (d: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  mark: `<svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 22c3 0 3-2 6-2s3 2 6 2 3-2 6-2 3 2 4 2" stroke="var(--water)" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M9 15l7-6 7 6" stroke="var(--text)" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  rotateLeft: s('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  rotateRight: s('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
  compass: s('<path d="M12 3l3.5 9H8.5z" fill="var(--danger)" stroke="none"/><path d="M12 21l-3.5-9h7z" fill="var(--text-dim)" stroke="none"/>'),
  alert: s('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', 32),
};
