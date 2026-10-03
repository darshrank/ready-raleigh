"use client";

import { Moon, Sun, SunMoon, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sfx } from "@/lib/audio/sfx";
import { cn } from "@/lib/utils";
import { useGame, type Theme } from "@/stores/game";

const NEXT: Record<Theme, Theme> = { auto: "day", day: "night", night: "auto" };
const THEME_LABEL: Record<Theme, string> = { auto: "Auto (follows the scenario clock)", day: "Day", night: "Night" };

export function SoundToggle({ className }: { className?: string }) {
  const sound = useGame((s) => s.sound);
  const setPref = useGame((s) => s.setPref);
  return (
    <Button
      size="icon-sm"
      variant="outline"
      aria-pressed={sound}
      aria-label={sound ? "Mute sound" : "Turn sound on"}
      title={sound ? "Sound on" : "Sound off"}
      onClick={() => {
        sfx.unlock();
        setPref("sound", !sound);
        if (!sound) setTimeout(() => sfx.click(), 50);
      }}
      className={cn("border-white/10 bg-black/40", !sound && "text-dim", className)}
    >
      {sound ? <Volume2 /> : <VolumeX />}
    </Button>
  );
}

/** Auto → Day → Night. Auto follows each scenario's clock. */
export function ThemeCycle({ className }: { className?: string }) {
  const theme = useGame((s) => s.theme);
  const setTheme = useGame((s) => s.setTheme);
  const Icon = theme === "day" ? Sun : theme === "night" ? Moon : SunMoon;
  return (
    <Button size="icon-sm" variant="outline" aria-label={`Lighting: ${THEME_LABEL[theme]}`} title={`Lighting: ${THEME_LABEL[theme]}`} onClick={() => setTheme(NEXT[theme])} className={cn("border-white/10 bg-black/40", className)}>
      <Icon />
    </Button>
  );
}
