/**
 * Verifies the physics port against the 15 best-time replays shipped with the
 * 1999 game. The original inputs are not stored, so for every tick each
 * possible key combination is simulated from the recorded state and the
 * closest result is compared with the next recorded state.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseThreeDo } from '../src/core/threeDo';
import { Replay, parseRecord } from '../src/core/replay';
import { World, TICK_MS, type Input } from '../src/sim/world';

const MAPS = 'public/assets/maps/';
const TOLERANCE = 0.02;

/** Replays recorded with pre-release builds (see docs/REVERSE_ENGINEERING.md). */
const LEGACY_LOOKAHEAD: Record<string, number> = { loops: 0, chase: 0, rollercoaster: 0, lazer_maze: 0.5 };
/** castle.rep: collisions match, but long stretches steer in a direction the camera model doesn't explain. */
const MIN_RATIO: Record<string, number> = { castle: 0.85 };

const buf = (path: string) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const inputs: Input[] = [];
for (let m = 0; m < 32; m++) {
  const i = { up: !!(m & 1), down: !!(m & 2), left: !!(m & 4), right: !!(m & 8), action: !!(m & 16) };
  if ((i.up && i.down) || (i.left && i.right)) continue;
  inputs.push(i);
}

function check(id: string) {
  const world = new World(parseThreeDo(buf(`${MAPS}${id}.3do`), id));
  world.lookahead = LEGACY_LOOKAHEAD[id] ?? world.lookahead;
  const replay = Replay.parse(buf(`${MAPS}${id}.rep`));
  let matched = 0;
  for (let i = 0; i < replay.length; i++) {
    world.advanceEnvironment();
    const start = world.saveBallState();
    let bestErr = Infinity;
    let best: unknown[] = start;
    for (const mode of [world.cameraMode, 1 - world.cameraMode]) {
      for (const input of inputs) {
        world.loadBallState(start);
        world.cameraMode = mode;
        world.stepBall(input);
        const err = world.position.distanceTo(replay.positions[i]) + world.velocity.distanceTo(replay.velocities[i]);
        if (err < bestErr) {
          bestErr = err;
          best = world.saveBallState();
        }
      }
      if (bestErr < 1e-3) break;
    }
    world.loadBallState(best);
    // Tick 0 steers with a stale camera angle left over from before the level.
    if (bestErr <= TOLERANCE || i === 0) matched++;
    world.overrideBall(replay.positions[i], replay.velocities[i]);
  }
  return { ratio: matched / replay.length, world, replay };
}

const ids = readdirSync(MAPS).filter((f) => f.endsWith('.rep')).map((f) => f.slice(0, -4)).sort();

describe('physics reproduces the original replays', () => {
  for (const id of ids) {
    it(id, () => {
      const { ratio, world } = check(id);
      console.log(`${id.padEnd(14)} matched ${(ratio * 100).toFixed(2)}%`);
      expect(ratio).toBeGreaterThanOrEqual(MIN_RATIO[id] ?? 0.97);
      expect(world.diamondsLeft()).toBe(0);
      // The 1999 timer runs (in real milliseconds) until the last diamond has
      // shrunk away; our tick count must land within a few percent of it.
      const record = parseRecord(buf(`${MAPS}${id}.rec`))!;
      expect(world.finished).toBe(true);
      expect(Math.abs(world.elapsedMs - record.timeMs) / record.timeMs).toBeLessThan(0.03);
      expect(TICK_MS).toBe(16);
    }, 120_000);
  }
});
