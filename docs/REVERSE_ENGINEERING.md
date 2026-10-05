# How the original works

The 1999 release ships no source code, so everything below was recovered by
disassembling `BALLS.EXE` v1.02 (x86, MSVC, Direct3D 6) and checking the
results against the 15 best-time replays that ship with the game. Addresses
refer to that executable (image base `0x400000`).

## `.3DO` files (`LOAD_3DO`, `0x4038D0`)

All values little endian.

| Offset | Type | Meaning |
|---|---|---|
| 0 | f32 | version, must be ≥ 4.0 |
| 4 | i32 | object count |
| 8 | i32 | material count |
| 12 | i32 | point record count |
| 16 | char[20] | background bitmap |

Each **object** is a `0x218C` byte header followed by `n_uv` × (u, v),
`n_vert` × (x, y, z) and `n_face` × 7 ints (v0, v1, v2, uv0, uv1, uv2, smooth).

| Header offset | Meaning |
|---|---|
| `0x00` | name (first tag of the 3DS MAX object name) |
| `0x20` | pivot, vertices are absolute |
| `0x2C/0x30/0x34` | vertex / uv / face counts |
| `0x38..0x40` | `ROX=`, `ROY=`, `ROZ=` rotation speeds |
| `0x44` | material index |
| `0x48` | `SP?` special: 1 = `NOCOL`, 2..6 = normal/red/yellow/blue/green gate (5 also marks shadow planes in models) |
| `0x4C/0x50/0x54` | `MOV=XXYY` route and first point, `SPD=` speed |
| `0x74..0x7C` | `ADS=` boost vector (floats) |
| `0x80..0x2153` | pre-built triangle strips (unused by the port) |
| `0x2154` | blend: 1 normal, 2 additive, 3 subtractive |
| `0x2158` | transparency |
| `0x215C` | self illumination (added to the glow colour) |
| `0x2160` | two sided |
| `0x2164` | diffuse RGB |
| `0x2170` | ambient RGB ("glow") |
| `0x2180` | texture file name |

Each **point record** is `0x8E` bytes: name at 0, type at 32 (1 = light,
9/99 = helper), position at 36 stored as **(x, z, y)** relative to vertex
space, colour at 48, light range at 84 (≥ 10000 = everywhere), glow size at 88,
`MOV=`/`SPD=` at 104/108/112, `ROU=XXYY` at 116/120, `RWT=` at 124, `RSP=` at
128 (0 means 100) and route point angles in degrees at 132/136/140.

## Simulation (`0x408B40`)

The game advances in fixed 16 ms ticks (`ms >> 4`, i.e. 62.5 Hz). Per tick:

1. Steering: ±0.1 × (2 for the red ball) along the camera's forward/right
   axes. The code scales by 0.7 when `(up && left) || right`, so pressing
   Right alone is 30% weaker. The shipped replays confirm this.
2. Gravity: `vy -= 0.1`.
3. Ball abilities. Yellow: if touching anything and the 60 tick cooldown is
   over, `vy += 5`. Blue: every diamond within 150 units is zapped. Green: while
   the action key is held, `v *= 0.9`.
4. `pos += v + carry; v *= 0.996`.
5. Objects and points on routes move `0.01 × SPD × RSP` units towards the next
   route point and interpolate the route point angles.
6. Collision: a probe `pos + v/3` casts axis-aligned lines (Y, then X, then Z)
   through every nearby triangle (two-sided Möller–Trumbore). A hit with
   `|t| < max(|v_axis|, 10)` is a contact with depth `|t| - 10`.
7. Only the deepest contact with a solid object and the deepest contact with
   a moving/rotating object respond:
   * carry velocity from the face's motion this tick,
   * a softened reflection `v' = |v| (v̂ + 2c n)` with
     `c = -sin(0.8 asin(n·v̂))`, which gives ≈0.9 restitution head-on and ≈0.6 at
     grazing angles. The bounce sound plays if `|Δv| > 2`, at volume ∝ `|Δv|`,
   * `pos -= n × depth`, `v *= 0.999`,
   * `ADS=` pads: `v = 0.86 (v + 0.04 (-ax, ay, -az))` if any component > 0.
   Gate contacts change the ball type instead.
8. `v += carry_previous - carry`.
9. Diamonds within 23 units (`(27 + 44) / 3`, from the ball and diamond model
   sizes) are collected and fade out over 20 ticks.
10. Camera: keeps 100 units horizontal distance (snapping only beyond 50)
    and 100 units above the ball.
11. Rotating objects turn `0.0032 × ROX/ROY/ROZ` radians per tick, applied as
    `Ry · Rx · Rz`.

The ball is lost when it falls 100 units below the lowest point of every
object.

## Replays and best times

`.rep` is an int32 tick count followed by one 28 byte record per tick:
position and velocity (6 × f32, Direct3D space) and the action key byte.
`.rec` is the best time in milliseconds (int32) plus three initials.

## Verification

`tests/replay_check.gd` replays every shipped `.rep`. The original inputs are
not stored, so for each tick it tries every key combination from the recorded
state and compares the best result with the next record. Some replays were
recorded with pre-release builds:

* `loops`, `chase`, `rollercoaster` (14 Aug 1999) used no collision look-ahead,
  matching the changelog's "ball no longer passes through at high speed" entry
  for v1.0.
* `lazer maze` (18 Aug 1999) used a look-ahead of `v/2`.

With those settings 14 of the 15 replays are reproduced on at least 98.7% of
ticks (most at 99.6–100%). The exceptions are the stale-camera first tick and
a handful of high-speed wall hits. `castle` reaches 89%: every collision
matches, but over long stretches the steering direction differs from the
camera model, and the cause has not been identified.
