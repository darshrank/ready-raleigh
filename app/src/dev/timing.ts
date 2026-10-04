// Dev only: performance.measure() timings for the trace scripts cost real time, so they are
// opt-in with ?fxtime (app/src/dev/fx.ts counts writes either way).
export const FX_TIMING = import.meta.env.DEV && typeof location !== 'undefined' && /[?&]fxtime\b/.test(location.search);
