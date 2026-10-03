"use client";

import dynamic from "next/dynamic";

const Experience = dynamic(() => import("./Experience").then((m) => m.Experience), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="font-display text-2xl font-bold uppercase tracking-[0.4em] text-dim">Loading</div>
    </div>
  ),
});

export function ExperienceLoader() {
  return <Experience />;
}
