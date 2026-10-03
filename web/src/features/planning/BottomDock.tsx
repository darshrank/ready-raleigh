"use client";

import { Bot, Building2, Layers, Radio, Waves } from "lucide-react";
import { Panel } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/features/map/ThemeToggle";
import { cn } from "@/lib/utils";
import { useGame, type LayerKey } from "@/stores/game";
import type { CameraMode } from "@/types";

const CAMERA: { id: CameraMode; label: string }[] = [
  { id: "analysis", label: "2D Analysis" },
  { id: "city", label: "3D City" },
  { id: "tactical", label: "Tactical" },
  { id: "shadow", label: "Shadow City" },
];

const LAYERS: { id: LayerKey; label: string }[] = [
  { id: "flood", label: "Hazard layer" },
  { id: "zones", label: "Neighborhoods" },
  { id: "atRisk", label: "At-risk residents" },
  { id: "roads", label: "Fragile roads" },
  { id: "facilities", label: "Hospitals" },
  { id: "buildings", label: "3D buildings" },
];

export function CameraModes({ allowShadow }: { allowShadow: boolean }) {
  const cameraMode = useGame((s) => s.cameraMode);
  const setCameraMode = useGame((s) => s.setCameraMode);
  return (
    <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="radiogroup" aria-label="Camera mode">
      {CAMERA.map((c) => {
        const disabled = c.id === "shadow" && !allowShadow;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={cameraMode === c.id}
            disabled={disabled}
            title={disabled ? "Shadow City shows what stays reachable during the simulation" : undefined}
            onClick={() => setCameraMode(c.id)}
            className={cn(
              "rounded-md px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wider transition",
              cameraMode === c.id ? (c.id === "shadow" ? "bg-violet-500/30 text-violet-100" : "bg-white/12 text-white") : "text-dim hover:text-white",
              disabled && "opacity-35",
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

export function LayerMenu() {
  const layers = useGame((s) => s.layers);
  const toggle = useGame((s) => s.toggleLayer);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="border-white/10 bg-black/30">
          <Layers /> Layers
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" className="hud-panel w-60 border-white/10 p-3">
        <div className="hud-label mb-2">Map layers</div>
        {LAYERS.map((l) => (
          <label key={l.id} className="flex items-center justify-between py-1 text-sm text-white">
            {l.label}
            <Switch checked={layers[l.id]} onCheckedChange={() => toggle(l.id)} />
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function CommandButtons() {
  const radio = useGame((s) => s.radio);
  const setPref = useGame((s) => s.setPref);
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button size="sm" variant="outline" disabled className="border-violet-400/30 bg-violet-400/10 text-violet-100">
              <Bot /> AI Commander
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Gemini with tool calls on this engine. Arrives with the backend pass.</TooltipContent>
      </Tooltip>
      <Button
        size="sm"
        variant="outline"
        aria-pressed={radio}
        onClick={() => setPref("radio", !radio)}
        className={cn("border-white/10 bg-black/30", radio && "border-rose-400/40 bg-rose-400/15 text-rose-100")}
      >
        <Radio /> Radio {radio ? "on" : "off"}
      </Button>
    </div>
  );
}

export function BottomDock() {
  const feed = useGame((s) => s.feed);
  const activeTool = useGame((s) => s.activeTool);
  const data = useGame((s) => s.data);
  const spec = data && activeTool ? data.cfg.interventions.find((i) => i.id === activeTool) : null;
  const HINT: Record<string, string> = {
    crossing: "Click a highlighted road. Red fails first, yellow later.",
    shelterSite: data?.cfg.hazard.type === "heat" ? "Click a site. Libraries, schools and community centers can cool people." : "Click a site. Green is outside the hazard area, orange is inside it.",
    busStop: spec?.effect === "shield" ? "Click a stop to set up water and shade." : "Click a yellow stop near households without a car.",
    fireStation: "Click a fire station to stage the team.",
    shieldPoint: spec?.shieldKind === "surge" ? "Click a teal shoreline site to hold back surge." : "Click a blue low-lying block to pump out rain and canal water.",
    zone: "Click a neighborhood on liquefiable ground to retrofit it.",
  };
  const hint = spec ? HINT[spec.snapsTo] : "Pick an intervention, or click a neighborhood to inspect it.";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3 p-3 sm:p-4">
      <Panel className="pointer-events-auto hidden w-[340px] p-3 md:block">
        <div className="flex items-center gap-2 text-[12.5px] text-white/90">
          <Waves className="size-4 text-[var(--city)]" /> {hint}
        </div>
        <ul className="mt-2 flex flex-col gap-0.5">
          {feed.slice(0, 3).map((f) => (
            <li
              key={f.id}
              className={cn(
                "truncate font-mono text-[11px]",
                f.level === "success" ? "text-emerald-300/90" : f.level === "warning" ? "text-amber-300/90" : f.level === "critical" ? "text-rose-300" : "text-dim",
              )}
            >
              › {f.text}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className="pointer-events-auto flex items-center gap-2 p-2">
        <CameraModes allowShadow={false} />
        <ThemeToggle />
        <LayerMenu />
        <Button
          size="sm"
          variant="outline"
          className="border-white/10 bg-black/30"
          onClick={() => useGame.getState().toggleLayer("buildings")}
          aria-label="Toggle 3D buildings"
        >
          <Building2 />
        </Button>
      </Panel>
      <Panel className="pointer-events-auto p-2">
        <CommandButtons />
      </Panel>
    </div>
  );
}
