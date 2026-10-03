"use client";

import { MousePointerClick } from "lucide-react";
import { SoundToggle, ThemeCycle } from "@/components/hud/Controls";
import { Panel } from "@/components/hud/primitives";
import { cn } from "@/lib/utils";
import { useGame } from "@/stores/game";
import { CommanderButton } from "./AiCommander";
import { useToolHint } from "./Toolbar";

export function BottomDock() {
  const feed = useGame((s) => s.feed);
  const hint = useToolHint();
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 hidden items-end justify-between gap-3 p-4 md:flex">
        <Panel className="pointer-events-auto ml-[248px] max-w-md p-3">
          <div className="flex items-center gap-2 text-[13px] text-white/90">
            <MousePointerClick className="size-4 shrink-0 text-[var(--city)]" /> {hint}
          </div>
          {feed.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {feed.slice(0, 2).map((f) => (
                <li key={f.id} className={cn("truncate font-mono text-[11px]", f.level === "success" ? "text-emerald-300/90" : f.level === "warning" ? "text-amber-300/90" : "text-dim")}>
                  › {f.text}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="pointer-events-auto flex items-center gap-2 p-2">
          <CommanderButton />
          <SoundToggle />
          <ThemeCycle />
        </Panel>
      </div>
      <div className="pointer-events-auto absolute right-2 top-[4.6rem] z-20 flex flex-col gap-1.5 md:hidden">
        <CommanderButton className="size-9 p-0" />
        <SoundToggle className="size-9" />
        <ThemeCycle className="size-9" />
      </div>
    </>
  );
}
