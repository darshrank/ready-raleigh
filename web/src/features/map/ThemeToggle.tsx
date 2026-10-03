"use client";

import { Moon, Sun, SunMoon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGame, type Theme } from "@/stores/game";

const OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "auto", label: "Follow the scenario clock", icon: SunMoon },
  { id: "day", label: "Day", icon: Sun },
  { id: "night", label: "Night", icon: Moon },
];

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useGame((s) => s.theme);
  const setTheme = useGame((s) => s.setTheme);
  return (
    <div className={cn("flex rounded-lg border border-white/10 bg-black/30 p-0.5", className)} role="radiogroup" aria-label="Day and night">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={theme === o.id}
          aria-label={o.label}
          title={o.label}
          onClick={() => setTheme(o.id)}
          className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider transition", theme === o.id ? "bg-white/15 text-white" : "text-dim hover:text-white")}
        >
          <o.icon className="size-3.5" />
          <span className="hidden xl:inline">{o.id}</span>
        </button>
      ))}
    </div>
  );
}
