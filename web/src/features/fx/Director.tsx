"use client";

import { useEffect } from "react";
import { CITY_PACKS } from "@/cities";
import { sfx } from "@/lib/audio/sfx";
import { mapBus } from "@/lib/map-bus";
import type { SimEvent } from "@/lib/engine/simulate";
import { narrate } from "@/lib/speech";
import { useGame } from "@/stores/game";
import { hideBuildings, pickCollapses } from "./collapse";
import { useFx } from "./fx-store";
import { shake } from "./shake";

const OPENING: Record<string, { title: string; subtitle: string; tone: "storm" | "heat" | "quake" }> = {
  raleigh: { title: "Hurricane landfall", subtitle: "Rain bands over the Triangle. Creeks are rising.", tone: "storm" },
  miami: { title: "Storm surge siege", subtitle: "Surge, rain and canals: three kinds of water, three clocks.", tone: "storm" },
  "new-york": { title: "Heat dome", subtitle: "Heat index above 105°F in Harlem and the South Bronx.", tone: "heat" },
};

/**
 * Turns the simulation clock into sound, shaking, weather and banners.
 * Everything keys off simulated hours, so pausing and scrubbing stay in sync.
 */
export function FxDirector() {
  const phase = useGame((s) => s.phase);
  const sim = useGame((s) => s.sim);

  useEffect(() => {
    if (phase !== "simulating" || !sim) return;
    const st = useGame.getState();
    const data = st.data!;
    const cfg = data.cfg;
    const H = cfg.hazard;
    const type = H.type;
    const fx = useFx.getState();
    const events: SimEvent[] = [...sim.events].sort((a, b) => a.hour - b.hour);
    const peak = H.peakHour;
    const pack = CITY_PACKS[data.cityId];
    let idx = 0;
    let last = -1;
    let lightning: ReturnType<typeof setTimeout> | null = null;
    let crashTimes: number[] = [];
    let crashIdx = 0;
    let quakeCamDone = false;
    let fireOn = false;
    const known = new Set<number>();

    const radio = (e: SimEvent) => {
      if (useGame.getState().radio && (e.level === "critical" || e.level === "success") && sfx.throttle("radio", 6000)) narrate(`${e.title}. ${e.detail}`);
    };

    const addCollapses = () => {
      const m = mapBus.get();
      if (!m || type !== "quake") return;
      const more = pickCollapses(m, data, H.quake!.damageHour, known);
      if (!more.length) return;
      const all = [...useFx.getState().collapses, ...more];
      useFx.getState().set({ collapses: all });
      hideBuildings(m, all.map((c) => c.id));
      const step = Math.max(1, Math.ceil(all.length / 12));
      crashTimes = all
        .map((c) => c.start + 0.03)
        .sort((a, b) => a - b)
        .filter((_, i) => i % step === 0);
      crashIdx = crashTimes.findIndex((h) => h > last);
      if (crashIdx < 0) crashIdx = crashTimes.length;
    };

    const mainshock = () => {
      sfx.rumble(6.5, 1);
      shake(18, 5600);
      sfx.buzz([600, 120, 400, 120, 800]);
      fx.showBanner({ title: "M7.8 Earthquake", subtitle: "San Andreas Fault · buildings fail on liquefied fill in SoMa", tone: "quake" });
      addCollapses();
    };

    const trigger = (e: SimEvent) => {
      const t = e.title;
      if (type === "quake" && /earthquake/i.test(t)) return mainshock();
      if (/aftershock/i.test(t)) {
        sfx.rumble(3, 0.6);
        shake(9, 2400);
        sfx.buzz([250, 80, 300]);
        fx.showBanner({ title: "Aftershock", subtitle: e.detail, tone: "quake" });
        return radio(e);
      }
      if (/^fire reported/i.test(t)) {
        if (!fireOn) {
          fireOn = true;
          sfx.loop("fire", 0.8);
          fx.showBanner({ title: "Fires break out", subtitle: `${t.replace(/^Fire reported near /i, "Near ")}. ${e.detail}`, tone: "danger" });
          sfx.alert("critical");
          radio(e);
        }
        return;
      }
      if (/^blackout/i.test(t)) {
        sfx.powerDown();
        fx.blackout();
        shake(4, 700);
        sfx.buzz([200, 100, 200]);
        fx.showBanner({ title: "Blackout", subtitle: e.detail, tone: "heat" });
        return radio(e);
      }
      if (/storm surge reaches/i.test(t)) {
        sfx.waterRush();
        fx.showBanner({ title: "Surge hits the shore", subtitle: e.detail, tone: "storm" });
        return radio(e);
      }
      if (/no longer passable|overtopped|canal bridge closed/i.test(t)) {
        if (sfx.throttle("water", 1300)) sfx.waterRush();
      }
      if (/isolated|losing access/i.test(t)) {
        if (sfx.throttle("iso", 1600)) sfx.alert("critical");
      } else if (e.level === "critical") {
        if (sfx.throttle("crit", 1200)) sfx.alert("critical");
      } else if (e.level === "success") {
        if (sfx.throttle("ok", 1400)) sfx.alert("success");
        if (/deployed|backup power|held/i.test(t)) fx.showBanner({ title: /deployed/i.test(t) ? "Rescue teams roll" : "Your plan held", subtitle: t, tone: "success" });
      } else if (e.level === "warning" && sfx.throttle("warn", 1500)) sfx.alert("warning");
      if (e.hour === peak && /peak|largest/i.test(t)) fx.showBanner({ title: type === "heat" ? "Heat peaks" : type === "quake" ? "Fires at their largest" : "Flood peak", subtitle: e.detail, tone: type === "heat" ? "heat" : type === "quake" ? "danger" : "storm" });
      radio(e);
    };

    const ambience = (h: number) => {
      if (type === "flood" || type === "coastal") {
        const s = h < peak ? 0.55 + 0.45 * (h / peak) : Math.max(0.08, 1 - (h - peak) / 9);
        if (Math.abs(useFx.getState().rain - s) > 0.03) fx.set({ rain: s });
        sfx.loop("rain", s);
        sfx.loop("wind", s * (type === "coastal" ? 0.9 : 0.6));
      } else if (type === "heat") {
        const k = h < peak ? 0.45 + 0.55 * (h / peak) : Math.max(0.3, 1 - (h - peak) / 22);
        if (Math.abs(useFx.getState().heat - k) > 0.03) fx.set({ heat: k });
        sfx.loop("heat", k);
      } else if (fireOn) {
        sfx.loop("fire", Math.max(0.15, 0.8 - Math.max(0, h - 10) / 14));
      }
      if (h > cfg.orderHour && h < cfg.orderHour + 7 && sfx.throttle("siren", 9000)) sfx.siren();
      if (type === "quake") {
        while (crashIdx < crashTimes.length && crashTimes[crashIdx] <= h) {
          sfx.collapse();
          if (crashIdx % 3 === 0) sfx.buzz(70);
          crashIdx++;
        }
        if (!quakeCamDone && h > 0.62) {
          quakeCamDone = true;
          const b = pack.cameraBookmarks.find((x) => x.id === "overview") ?? pack.cameraBookmarks[0];
          mapBus.flyTo({ center: b.center, zoom: b.zoom + 0.4, pitch: 50, bearing: b.bearing, duration: 4200 });
        }
      }
    };

    const onHour = (h: number) => {
      if (h < last - 1e-6) {
        idx = events.findIndex((e) => e.hour > h);
        if (idx < 0) idx = events.length;
        crashIdx = crashTimes.findIndex((x) => x > h);
        if (crashIdx < 0) crashIdx = crashTimes.length;
        last = h;
        return;
      }
      while (idx < events.length && events[idx].hour <= h) trigger(events[idx++]);
      ambience(h);
      last = h;
    };

    const opening = OPENING[data.cityId];
    if (opening) fx.showBanner(opening);
    if (type === "flood" || type === "coastal") {
      const strike = () => {
        const g = useGame.getState();
        const rain = useFx.getState().rain;
        if (g.playing && rain > 0.45) {
          const dist = Math.random();
          fx.lightning();
          sfx.thunder(dist);
          if (dist < 0.35) {
            sfx.buzz([40, 30, 90]);
            shake(3, 500);
          }
        }
        lightning = setTimeout(strike, 3500 + Math.random() * 6500);
      };
      lightning = setTimeout(strike, 1800);
    }

    const m = mapBus.get();
    const onIdle = () => {
      if (useGame.getState().simHour < 1.5) setTimeout(addCollapses, 0);
    };
    if (type === "quake" && m) m.on("idle", onIdle);

    const unsub = useGame.subscribe((s, prev) => {
      if (s.simHour !== prev.simHour) onHour(s.simHour);
    });
    onHour(useGame.getState().simHour);

    return () => {
      unsub();
      if (lightning) clearTimeout(lightning);
      if (m) {
        m.off("idle", onIdle);
        hideBuildings(m, []);
      }
      sfx.stopLoops(1.5);
      useFx.getState().reset();
    };
  }, [phase, sim]);

  return null;
}
