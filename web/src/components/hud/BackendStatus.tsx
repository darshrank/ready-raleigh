"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBackend } from "@/lib/api";
import { cn } from "@/lib/utils";

const LABELS = { gemini: "Gemini", elevenlabs: "ElevenLabs", database: "Tiger Data", solana: "Solana" } as const;

/** Which live services are connected. The game itself always works offline. */
export function BackendStatus({ className }: { className?: string }) {
  const status = useBackend((s) => s.status);
  const services = useBackend((s) => s.services);
  const online = status === "online";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider", online ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-dim", className)}>
          <span className={cn("size-1.5 rounded-full", online ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-500")} />
          {online ? "SERVER LIVE" : status === "unknown" ? "CONNECTING…" : "OFFLINE MODE"}
          {online && (
            <span className="ml-1 hidden gap-1 sm:flex">
              {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
                <span key={k} className={cn("size-1.5 rounded-full", services[k] ? "bg-emerald-300" : "bg-rose-400/70")} />
              ))}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {online ? (
          <ul className="text-xs">
            {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
              <li key={k}>
                {services[k] ? "●" : "○"} {LABELS[k]}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs">Game server not reachable. Solo play works; rooms, AI and voice need it.</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
