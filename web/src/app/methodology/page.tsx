import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { money } from "@/lib/format";
import { CITY_ORDER, CITY_PACKS } from "@/cities";
import { BRAND, CITY_SCENARIOS, ROUND, SCORE_LABELS, SCORE_WEIGHTS } from "@/config/game";
import type { CityMeta } from "@/lib/data/city-data";
import { COOLING_WALK_MINUTES } from "@/lib/engine/achilles";
import type { CityId } from "@/types";

export const metadata: Metadata = { title: `Methodology · ${BRAND.name}` };

const PIPELINE = ["Data", "Geospatial processing", "City graph", "Scenario engine", "Player actions", "Simulation", "Scoring", "Crowd intelligence", "Planner action map"];

async function getMeta(city: CityId): Promise<CityMeta | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), `public/data/${city}/meta.json`), "utf8")) as CityMeta;
  } catch {
    return null;
  }
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-white/8 py-10">
      <h2 className="font-display text-3xl font-black uppercase tracking-[0.12em] text-white">{title}</h2>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-white/80">{children}</div>
    </section>
  );
}

export default async function Methodology() {
  const metas = await Promise.all(CITY_ORDER.map(async (c) => [c, await getMeta(c)] as const));
  const R = CITY_SCENARIOS.raleigh;
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="font-mono text-xs tracking-widest text-dim hover:text-white">
          ← BACK TO THE GAME
        </Link>
        <h1 className="mt-6 font-display text-6xl font-black uppercase tracking-[0.12em] text-white">Methodology</h1>
        <p className="mt-3 max-w-2xl text-lg text-white/75">
          How {BRAND.name} turns open data into playable, honest scenarios. {BRAND.disclaimer}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-2">
          {PIPELINE.map((p, i) => (
            <span key={p} className="flex items-center gap-2">
              <span className="rounded-md border border-white/12 bg-white/5 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-white">{p}</span>
              {i < PIPELINE.length - 1 && <span className="text-dim">→</span>}
            </span>
          ))}
        </div>

        <Section id="sources" title="Source datasets">
          <p>
            Every layer keeps its source. Each city pack is built offline by <code className="text-sky-300">data-prep/build_city.py</code>. The basemap and 3D buildings come from OpenFreeMap
            vector tiles (OpenMapTiles schema) and are display only.
          </p>
          {metas.map(([city, meta]) => (
            <div key={city} className="mt-6">
              <h3 className="font-display text-xl font-bold uppercase tracking-[0.14em]" style={{ color: CITY_PACKS[city].accent }}>
                {CITY_PACKS[city].name} · {CITY_PACKS[city].scenarioTitle}
              </h3>
              {meta ? (
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-dim">
                      <tr>
                        <th className="py-2 pr-4 font-normal">Dataset</th>
                        <th className="py-2 pr-4 font-normal">Role in the simulation</th>
                        <th className="py-2 pr-4 font-normal">Version</th>
                        <th className="py-2 font-normal">Limitations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meta.sources.map((src) => (
                        <tr key={src.id} className="border-t border-white/8 align-top">
                          <td className="py-3 pr-4">
                            <a href={src.url} className="text-white underline decoration-white/30 underline-offset-2" target="_blank" rel="noreferrer">
                              {src.name}
                            </a>
                            <div className="text-xs text-dim">{src.publisher}</div>
                          </td>
                          <td className="py-3 pr-4 text-white/75">{src.role}</td>
                          <td className="py-3 pr-4 font-mono text-xs text-white/75">
                            {src.vintage ? `${src.vintage}, ` : ""}retrieved {src.retrieved}
                          </td>
                          <td className="py-3 text-white/65">{src.limitations}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 font-mono text-xs text-dim">
                    {meta.counts.tracts} tracts · {meta.counts.population.toLocaleString()} residents · {meta.counts.atRisk.toLocaleString()} at risk · {meta.counts.nodes.toLocaleString()} intersections ·{" "}
                    {meta.counts.edges.toLocaleString()} road segments · {meta.counts.floodCells.toLocaleString()} H3 hazard cells (res {meta.h3Res}) · {meta.counts.crossings} protectable roads ·{" "}
                    {meta.counts.shelterSites} shelter sites · {meta.counts.busStops.toLocaleString()} bus stops · generated {meta.generatedAt}
                  </p>
                </div>
              ) : (
                <p className="text-dim">City data not generated yet.</p>
              )}
            </div>
          ))}
        </Section>

        <Section id="hazards" title="Hazard models">
          <p>Every scenario is a stress test, not a forecast. Timing parameters live in one config file and are listed here for Raleigh as an example.</p>
          <p>
            <span className="text-white">Raleigh (flood):</span> FEMA floodway, 1% and 0.2% zones become H3 cells. Water arrives at t0[zone] + distance to the stream ÷ spread rate (t0 of{" "}
            {R.hazard.sources[0].t0[1]}, {R.hazard.sources[0].t0[2]} and {R.hazard.sources[0].t0[3]} hours, spread {R.hazard.sources[0].spread[1]}, {R.hazard.sources[0].spread[2]} and{" "}
            {R.hazard.sources[0].spread[3]} m/h). Roads close when water reaches them, later on bigger roads, which have more freeboard. Motorways and trunk roads stay open.
          </p>
          <p>
            <span className="text-white">Miami (compound coastal flooding):</span> FEMA V, A and 0.2% zones are split by source. Cells near the coastline flood with the storm surge, which moves
            inland fast. Cells next to canals overflow mid-storm. Inland low spots fill with rain from their deepest point outward. Barriers only stop surge, and pumps only clear rain and canal water.
          </p>
          <p>
            <span className="text-white">New York (heat):</span> each H3 cell gets a heat score from the lack of green and blue space within 300 m (OSM) and population density (ACS). Hotter blocks
            become dangerous earlier in the afternoon. A seeded blackout cuts power to a cluster of neighborhoods: residents there lose home cooling, and cooling centers without a backup generator close.
            Residents walk to cooling or take a cooling bus. Nobody drives away.
          </p>
          <p>
            <span className="text-white">San Francisco (earthquake):</span> the USGS/ABAG liquefaction scenario for a San Andreas rupture marks High and Moderate hazard. Roads through High hazard and
            bridges on liquefiable ground fail at the mainshock, and a share of residents there is trapped until search and rescue arrives. Fires start at seeded points in fuel-dense blocks and spread
            cell by cell, faster where residential density is higher and stopping at parks and water. An aftershock closes more damaged roads.
          </p>
          <p>
            Random events are seeded so every plan in a room faces the same disaster: a creek rising early and a culvert overtopping in Raleigh, early surge and a canal pump failure in Miami, a
            blackout in New York, fire ignitions and an aftershock in San Francisco. Planning estimates never see them.
          </p>
        </Section>

        <Section id="population" title="Population and risk normalization">
          <p>
            Census tract counts come from the ACS 5-year estimates. Inside each tract, people are spread along residential streets (dasymetric mapping weighted by road class), so greenways, parks
            and rail yards hold no one. Residents in or near the hazard area are grouped into household clusters, and every 100 to 200 residents become one animated agent.
          </p>
          <p>
            In the flood and earthquake cities each cluster is split by car access (ACS households without a vehicle). Some car households look for a public shelter and the rest drive to safer
            neighborhoods. Households without a car need a shelter within walking distance or a pickup point. In New York the at-risk group is residents 65+ or below the poverty line, scaled by the
            NYC Heat Vulnerability Index for the share without reliable home cooling. An assumed {Math.round((CITY_SCENARIOS["new-york"].hazard.heat?.selfCoolShare ?? 0) * 100)}% of them reach a
            cooler place on their own, such as family or a cooled public space, if they leave before their block becomes dangerous. The rest walk to a cooling center or a parked cooling bus.
            Departures follow a seeded delay curve, and older adults leave later.
          </p>
        </Section>

        <Section id="routing" title="Network routing">
          <p>
            The OSMnx drive network is kept as a directed graph with one-way rules and imputed speeds. Every agent routes with Dijkstra on the network as it stands when it leaves. If a road ahead
            closes before the agent clears it, the agent reroutes. If nothing is reachable, it is stranded. Search trees are cached in 30-minute buckets, and closures within a bucket are treated as
            already closed.
          </p>
          <p>
            The Achilles&apos; heel scan follows every neighborhood&apos;s fastest route to a hospital or safe ground. It counts the people on each crossing, then removes the busiest crossings one by one
            to measure who loses access within 30 minutes. In New York, where roads stay open, the scan looks for cooling deserts instead: vulnerable clusters with no possible cooling site within a
            {` ${COOLING_WALK_MINUTES}`}-minute walk at an older adult&apos;s pace ({CITY_SCENARIOS["new-york"].coverage.walkSpeedMps} m/s).
          </p>
        </Section>

        <Section id="interventions" title="Interventions">
          {CITY_ORDER.map((city) => (
            <div key={city}>
              <div className="font-display text-lg font-bold uppercase tracking-wider" style={{ color: CITY_PACKS[city].accent }}>
                {CITY_PACKS[city].name}
              </div>
              <ul className="mb-3 list-inside list-disc space-y-1">
                {CITY_SCENARIOS[city].interventions.map((i) => (
                  <li key={i.id}>
                    <span className="text-white">{i.label}</span> ({money(i.cost)}): {i.description}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p>Budget {money(ROUND.budget)} per round. Costs, capacities and radii are game parameters, not engineering estimates.</p>
        </Section>

        <Section id="scoring" title="Scoring (game scoring model)">
          <ul className="list-inside list-disc space-y-1">
            {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k) => (
              <li key={k}>
                <span className="text-white">{SCORE_LABELS[k]}</span> × {SCORE_WEIGHTS[k]}
              </li>
            ))}
          </ul>
          <p>
            Population protection is the share of at-risk residents who reached safety or cooling. Vulnerable protection counts each person once per group they belong to (65+, below poverty, no car),
            so plans that reach vulnerable households score higher. Accessibility is the share of all residents who can reach care within 30 minutes at the hazard peak. Network resilience rewards
            protecting the crossings the bottleneck scan ranks highest (in New York, keeping cooling centers powered). Budget efficiency compares vulnerability-weighted gain per $1M with the best single
            intervention. Equity compares how vulnerable groups fared with everyone else.
          </p>
          <p>The weights are design choices. They are not scientifically canonical.</p>
        </Section>

        <Section id="optimization" title="Optimization and the crowd">
          <p>
            The reference plan comes from a greedy search over ranked candidate sites using the planning estimate (reachability at two reference hours, with capacity limits). It then runs through the
            full simulation like any player, so a player can beat it.
          </p>
          <p>
            The crowd map compares where the room placed interventions with where the data says unprotected, vulnerable residents are. It produces four classes: consensus priority, data blind spot,
            community signal and low priority. Until realtime rooms exist, the room is filled with clearly labelled simulated players.
          </p>
        </Section>

        <Section id="limitations" title="Limitations">
          <ul className="list-inside list-disc space-y-1">
            <li>Hazard timing is a scenario proxy, not a hydraulic, heat-transfer or seismic model.</li>
            <li>No traffic congestion. Travel times are free-flow.</li>
            <li>ACS estimates have margins of error, and demographic shares are assumed uniform within a tract.</li>
            <li>OpenStreetMap facility coverage is incomplete. Some hospitals and shelters may be missing.</li>
            <li>Shelter-seeking rates, cooling access shares, trapped shares, capacities and costs are placeholders to tune.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
