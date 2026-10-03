"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/features/map/ThemeToggle";
import { useGame } from "@/stores/game";

export function SettingsMenu() {
  const reducedMotion = useGame((s) => s.reducedMotion);
  const highContrast = useGame((s) => s.highContrast);
  const radio = useGame((s) => s.radio);
  const setPref = useGame((s) => s.setPref);
  const rows: { key: "reducedMotion" | "highContrast" | "radio"; label: string; hint: string; value: boolean }[] = [
    { key: "reducedMotion", label: "Reduced motion", hint: "No camera shake, calmer animation", value: reducedMotion },
    { key: "highContrast", label: "High contrast", hint: "Stronger borders and text", value: highContrast },
    { key: "radio", label: "Radio mode", hint: "Spoken alerts for critical events", value: radio },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings" className="text-dim hover:text-white">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="hud-panel w-72 border-white/10 p-3">
        <div className="hud-label mb-2">Day and night</div>
        <ThemeToggle className="mb-4 w-fit" />
        <div className="hud-label mb-2">Accessibility & audio</div>
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor={r.key} className="text-sm text-white">
                  {r.label}
                </Label>
                <div className="text-xs text-dim">{r.hint}</div>
              </div>
              <Switch id={r.key} checked={r.value} onCheckedChange={(v) => setPref(r.key, v)} />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
