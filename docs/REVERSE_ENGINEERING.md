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

After loading, `0x403340` **welds seams between objects**. For every pair of
different objects with the same texture name that neither spin nor follow a
route, any two vertices closer than 3 units (Manhattan distance, world space)
are both moved to their midpoint, and their vertex normals become the average
of the two (not renormalised). Face normals used for collisions were computed
before the weld and are not updated. This is the changelog's "no holes between
the objects". It slightly tilts some large floors, and replays depend on it:
castle's best-time replay only matches with the weld applied.

Each **point record** is `0x8E` bytes: name at 0, type at 32 (1 = light,
9/99 = helper), position at 36 stored as **(x, z, y)** relative to vertex
space, colour at 48, light range at 84 (≥ 10000 = everywhere), glow size at 88,
`MOV=`/`SPD=` at 104/108/112, `ROU=XXYY` at 116/120, `RWT=` at 124, `RSP=` at
128 (0 means 100) and route point angles in degrees at 132/136/140.

## Simulation (`0x408B40`)

The game advances in fixed 16 ms ticks (`ms >> 4`, i.e. 62.5 Hz). Per tick:

1. Steering (`0x408ba7`): ±0.1 × (2 for the red ball) relative to the yaw the
   camera update stored last tick (`0x523fbc`). That yaw comes from the
   `angleBetween` helper, which returns 0 when camera and ball X differ by less
   than 1e-4. Keys are applied right, left, down, up, each rounded to float32.
   The code scales by 0.7 when `(up && left) || right`, so pressing Right alone
   is 30% weaker. The shipped replays confirm this.
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

### Timing

`0x40b820` / `0x407280` turn the frame time into ticks (`dt >> 4`, the
remainder carried over); a frame longer than 2 s is dropped entirely. The level
clock (`0x52C810`) is **real milliseconds**, advanced only while diamonds
remain and the level menu is closed. It drives the HUD time, the best-time
comparison and the spin of decorative model parts, so all three stop when the
last diamond has finished shrinking. The FPS read-out is frames per 250 ms of
that clock, followed by the mean of all readings above 2.

The port draws frames interpolated between the last two ticks; the original
draws the latest tick, which judders slightly at 60 Hz. Gameplay is unaffected.

## Replays and best times

`.rep` is an int32 tick count followed by one 28 byte record per tick:
position and velocity (6 × f32, Direct3D space) and the action key byte.
`.rec` is the best time in milliseconds (int32) plus three initials.

## Rendering (Direct3D 6 fixed function)

* Projection: `D3DUtil_SetProjectionMatrix(1.57, 1.0, 1, 3000)`: a square 90°
  frustum stretched over the 4:3 screen.
* Lighting is per vertex. Point lights only, attenuation `1 / (1 + d/range)`
  (range ≥ 10000 means unattenuated), no global ambient. The material emissive
  is the object's "ambient" colour plus self-illumination. Normals go through
  the world matrix without renormalisation. Vertex normals are the normalised
  unweighted sum of the adjacent face normals (`0x402570`).
* Textures modulate the lit colour, bilinear, no mipmaps, wrapping. An object
  with no texture name is never drawn. A texture name whose file is missing
  (city's `bcrome.bmp`) binds a NULL texture, so the object is drawn untextured.
* Blend modes: transparency → SrcAlpha/InvSrcAlpha; additive → One/One;
  subtractive → Zero/InvSrcColor. Blended objects do not write depth. Draw order
  is level, ball, diamonds (opaque pass, then blended pass), then particles,
  lightning and light glows.
* Specular (setup menu) uses power 30 and a specular colour of
  `800 / (1 + 800·amd)`: 800 for "NORMAL", ≈1 for "DX6.1+AMD FIXED". The 800
  compensated for a difference between DX6 driver paths that WebGL cannot
  reproduce, so the port renders both "ON" settings with the intended highlight.
* Background: a full-screen quad drawn first (`0x40cfce`).
  `u = 0.477327·yaw` (+1 across the screen), `v = 0.477327·(pitch − 0.788)`
  (+1 down), so a full turn scrolls three texture widths.
* Light glows: `flare.bmp` billboards of size `25 × glow`, drawn once in the
  light's colour and once in white, additively.
* Particles: `bang.bmp` is a 4×8 animation sheet. Frame column
  `trunc(age/8)·0.25`, row `(age%8)·0.125`, quad size 30, random roll.
  Red ball: 2 sparks per tick; yellow while a jump is active; green while
  braking. Spark offsets and rolls come from the MSVC `rand()` LCG.
* Lightning (blue ball): one triangle from two jittered points at the ball to
  the target, `salama.bmp`, brightness `0.05 × timer`.
* Shadow: the ball model's `SP5` part is placed flat under the ball, at the
  nearest of five downward probes minus 0.4, with subtractive blending.
* Per-ball light: red (1, .2, .2) range 300, blue (0, 0, 1) range 200 (and
  (0.8, 0.8, 1) range 2000 while zapping). Yellow and green ramp up to range 500
  while their ability is active.

## Text and HUD (`0x406550`)

The font is three 4×4 glyph pages (`ifont1..3.bmp`): A–Z, 0–9, then
`:/%!?.+-,§()`, where `§` is the diamond icon. Cell UV size 0.2421875. Each glyph
is an additive quad of the requested size. The advance is
`width[glyph] × size × 0.01796875` and a space is `size/2`. Coordinates are a
640×480 virtual screen.

| Item | Position | Size | Colour |
|---|---|---|---|
| `fps/avg` | centred, y 5 | 16 | 100,255,255 |
| `BEST:s,th NAME` | 5, 5 | 30 | 100,100,255 |
| `TIME:s,th` | 5, 38 | 30 | 100,100,255 |
| `SPEED:nKMH` (n = trunc(\|v\| × 20)) | 5, 71 | 30 | 100,100,255 |
| `§ n` diamonds left | 550, 5 | 30 | 255,255,255 |

## Game flow (`0x40c9c0`)

* Level start: `start.wav` plays (×5) while the level clock is still 0.
* `ESC` opens the level menu (only before the end banner). `R` restarts at
  once. Falling off opens the menu immediately; there is no automatic restart.
* Level menu: five lines at y = 155 + 34i, size 32, cyan, selected red,
  10-tick key repeat. CONTINUE TO NEXT LEVEL is blank in single-map games and
  selectable in the campaign once the level has been completed (it stays
  selectable after restarts). RETURN TO GAME is skipped once the level is over.
  SHOW REPLAY restarts the level playing back the recording; QUIT TO MENU
  reloads the menu.
* End of level: banner timer `t` runs from 0 to 120 ticks. The two lines are
  size `2t` at y = 220 − 2t and 220, coloured `base × (120 − t) / 120`. Green
  LEVEL / COMPLETED, or red BEST / TIME with `endbest.wav` when the time beats
  the record (or there is none, i.e. < 1000 ms).
* Name entry (new record, not in playback): at `t` = 80 the banner holds until
  three letters A–Z are typed, accepting at most one every 15 ticks.
  "ENTER YOUR NAME:" and the name are drawn at size `40 + (t − 80)/2`, colour
  `(255,100,100) × (320 − 2.5t) / 120`. At 120 the `.rec` / `.rep` are written
  and the menu opens with RESTART LEVEL selected.
* Replays record position, velocity and the action key every tick (at most
  `0x2A30` ticks). Playback runs the normal simulation with the recorded action
  key and then overwrites the ball state.
* Campaign: lazer maze, chase, bounce, disco, loops, rollercoaster, city,
  castle, cannon, jump, killer, nightmare. Continuing past the twelfth level
  shows the ending (state 3, `0x410000`): 600 additive `yrgsb.bmp` sprites
  ("You've really got some BALLS") at random positions fly 6 units per tick
  towards the camera at z = −140. The first moves 9 per tick, spins at
  0.005 rad/ms and stops 14 units in front of the camera. ACTION returns to the
  menu.

## Main menu (`0x40b9e0` input, `0x40ed00` drawing)

* `menu.3DO`: a textured sphere, the `SP5` wheel sphere carrying the five
  entries (its X rotation is the wheel angle), a spinning lightning shell and
  the `SP6` "BALLS" logo plane. The camera sits at (0, 0, z) looking at
  (0, 0, 1000).
* Camera z starts at 190 when the program starts, so the first menu flies back
  through the logo. It moves 0.2 units per **millisecond** to −140 on the wheel
  and to −50 on the text pages.
* The wheel turns 2π/5 per entry at 0.05 rad per tick; input waits until it
  stops. Without `setup.dat` (first run) it starts on SETUP.
* Logo wave: every frame `x += 0.008·dt·cos φ`, `y, z += 0.008·dt·sin φ` with
  `φ = 0.0005·ms + 0.01·(x₀ + y₀ + z₀)`.
* Text pages fade in with the camera: colour × `(z + 80)/30`, drawn only above
  z = −80. Lists (SINGLE MAP, TOP SCORES) put row i at
  `y = 34(i − sel) + 444 − 17·count + 4s`. Moving the selection sets
  `s = ±8`, which counts down per tick to scroll smoothly. TOP SCORES rows are
  `NAME s,th (INI)`, and selecting one plays that map's record replay.
* SETUP: `SPECULAR: OFF / ON (NORMAL) / ON (DX6.1+AMD FIXED)`,
  `ANTIALIAS: OFF / FULLSCENE`, `CHANGE CONTROLS`. Note the cursor has four
  positions for three lines. CONTROLS lists the bindings as raw Windows
  virtual-key codes (`UP       38`). ACTION arms a binding (green); the next key
  pressed after a release is stored. Defaults without `keys.dat`: arrows +
  space, which the readme also documents. (The `keys.dat` in the release archive
  binds ACTION to Ctrl, 17; the port follows the code and the readme.)
* ESC from a page returns to the wheel on that page's entry and snaps the wheel.

## Audio

MIDAS plays samples at 22000 Hz, volume 0..63, centre pan, started `count` times
at once. Samples: `boun dia thun end start endbest bnormal bred bgreen bblue
byellow`. Music is `menu.it` in menus and the ending, `game.it` in levels.

## Verification

`tests/replay.test.ts` replays every shipped `.rep`. The original inputs are
not stored, so for each tick it tries every key combination from the recorded
state and compares the best result with the next record. It also checks that
the level finishes within 3% of the recorded best time. Some replays were
recorded with pre-release builds:

* `loops`, `chase`, `rollercoaster` (14 Aug 1999) used no collision look-ahead
  and accepted a ray hit only within the ball radius (v1.0 extends that to
  `max(|v_axis|, 10)`), matching the changelog's "ball no longer passes through
  at high speed" entry for v1.0.
* `lazer maze` (18 Aug 1999) used a look-ahead of `v/2`.

With those settings 14 of the 15 replays are reproduced on every tick (the
first tick excepted: it steers with whatever angle the previous screen left
behind). The test tries all 32 key combinations, because the recorded players
sometimes held opposite keys together. `castlecoaster` matches 99.77%: its four
missed ticks touch level geometry that changed after the replay was made
(`castlecoaster.rep` was saved at 09:35 on 24 Sep 1999, `castlecoaster.3DO` at
15:47 the same day). The original routine reproduces the same contact as the
port on that state, so the shipped map simply isn't the one the replay was
recorded on.

Details that closing the last gaps required, each confirmed in the binary:

* Rotation angles of spinning objects are stored as float32; after a thousand
  ticks the rounding moves fast paddles (bounce) by a visible amount.
* The red ball's ×2 steering multiplier (`0x523ff0`) is written by the
  ability step, which runs after steering, so it applies one tick late.

The physics can't be single-stepped in the original program, so `castle`'s
earlier 89% was investigated by running the original collision routine
(`0x4081f0`) in Unicorn on the recorded state. It found a floor face 0.34
units higher than the file's geometry, which led to the weld above.

Tools used: capstone for disassembly and Unicorn to execute the original's
text, menu, HUD, loader and collision routines with logged arguments, plus the Playwright
screenshots used to check the port's menus, levels and ending.
