// POST /api/plays: check the plan, score it on the server, store it.
import { randomUUID } from 'node:crypto';
import {
  type CityId, isCityId, COSTS, type InterventionType, type Placement, type Plan, type ScoreResult, planCost, planProblems, score,
} from '@shared';
import type { GameData } from './data';
import type { PlayRecord } from './db/store';
import { placementRow } from './planner';

export class BadPlay extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}

const TYPES = Object.keys(COSTS) as InterventionType[];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The plan from a request body, with names trimmed and spent recomputed. Throws BadPlay. */
export function readPlan(body: unknown): Plan {
  const plan = isObj(body) ? body.plan : undefined;
  if (!isObj(plan)) throw new BadPlay(['body needs a plan']);
  const problems: string[] = [];
  if (plan.mode !== 'flood' && plan.mode !== 'heat') problems.push('plan.mode must be flood or heat');
  if (!Array.isArray(plan.placements)) problems.push('plan.placements must be an array');
  const placements: Placement[] = [];
  for (const [k, p] of (Array.isArray(plan.placements) ? plan.placements : []).entries()) {
    if (!isObj(p) || !TYPES.includes(p.type as InterventionType)) {
      problems.push(`placement ${k} has no valid type`);
      continue;
    }
    placements.push({
      id: text(p.id, 64) || `p${k}`,
      type: p.type as Placement['type'],
      ...(typeof p.cell === 'number' ? { cell: p.cell } : {}),
      ...(typeof p.siteId === 'string' ? { siteId: p.siteId } : {}),
      ...(typeof p.roadId === 'string' ? { roadId: p.roadId } : {}),
      ...(typeof p.stopId === 'string' ? { stopId: p.stopId } : {}),
    });
  }
  if (problems.length > 0) throw new BadPlay(problems);
  return {
    roomCode: text(plan.roomCode, 32).toUpperCase() || 'SOLO',
    playerId: text(plan.playerId, 64) || 'anon',
    playerName: text(plan.playerName, 40) || 'Anonymous',
    mode: plan.mode as Plan['mode'],
    placements,
    spent: planCost(placements),
    city: cityOf(body),
  };
}

/** The city a request's plan is for (unknown or missing: Raleigh). */
export function cityOf(body: unknown): CityId {
  const plan = isObj(body) ? body.plan : undefined;
  return isObj(plan) && isCityId(plan.city) ? plan.city : 'raleigh';
}

/**
 * A stored play. With game data the server's own score is kept and the plan must be valid;
 * without it (data folder missing) the client's score is kept as sent.
 */
export function buildPlay(body: unknown, data: GameData | null, now = new Date()): PlayRecord {
  const plan = readPlan(body);
  let result: ScoreResult;
  if (data) {
    const problems = planProblems(plan, data.bundle);
    if (problems.length > 0) throw new BadPlay(problems);
    result = score(plan, data.bundle);
  } else {
    const sent = isObj(body) ? body.score : undefined;
    if (!isObj(sent) || typeof sent.score !== 'number') throw new BadPlay(['body needs a score']);
    result = sent as unknown as ScoreResult;
  }
  const placements = plan.placements.map((p) => (data ? placementRow(p, data.bundle) : {
    type: p.type,
    target: p.siteId !== undefined ? `site:${p.siteId}` : p.roadId !== undefined ? `road:${p.roadId}` : p.stopId !== undefined ? `stop:${p.stopId}` : `cell:${p.cell}`,
    cell: p.cell ?? null,
  }));
  return { id: randomUUID(), createdAt: now, plan, score: result, placements };
}
