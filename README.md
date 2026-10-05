# I've got some BALLS (three.js port)

A browser port of **"I've got some BALLS" v1.02**, Sebastian Aaltonen's 1999
freeware 3D ball-rolling game, built with [three.js](https://threejs.org) and
TypeScript. Roll a small ball through 12 levels, collect every diamond as fast
as you can, and use coloured gates to turn into a red (fast), yellow (jumping),
blue (zaps diamonds from a distance) or green (brakes) ball.

The goal is an authentic port, not a remake. The original shipped only as a
Direct3D 6 executable, so its physics, rendering setup, menus, HUD, timing and
sounds were recovered from `BALLS.EXE` by disassembly and emulation, and the
physics is checked against the best-time replays that shipped with the game.
See [docs/REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md). The 15
original levels, textures, sounds and music are used in their original formats,
so levels made with the original `MAKEMAP.EXE` work too.

## Running

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (relative paths, host anywhere)
npm run preview    # serve dist/
```

Click or press a key once to enable sound (browsers block audio until then).

### Controls

The defaults are the original's (see `docs/original/ballseng.txt`):

| Key | Action |
|---|---|
| Arrow keys | Accelerate the ball in that direction, relative to the camera |
| Space | Ball ability (jump, brake, …) and menu select |
| R | Restart the level |
| Esc | Level menu; back in menus |

Keys can be changed in **SETUP → CHANGE CONTROLS**. As in 1999, the bindings
are shown as Windows virtual-key codes. A gamepad also works (d-pad or stick,
A = action, Start/B = Esc, Y = restart).

As the original manual says, the arrow keys don't steer: each one adds speed
in its own direction.

### Menus

* **START GAME** plays the 12 levels in the original order, ending with the
  original finale.
* **SINGLE MAP** plays any level.
* **TOP SCORES** lists best times, starting with the 1999 records that came
  with the game. Select a row to watch its replay.
* **SETUP**: SPECULAR, ANTIALIAS and CHANGE CONTROLS, as in the original.

Best times, initials and best-time replays are saved in the browser's
`localStorage`. Replays use the original `.rep` format.

### Custom levels

Drag a `.3do` level compiled with the original `MAKEMAP.EXE` (see
`docs/original/makemape.txt`) onto the page, together with any textures it
uses that the game doesn't ship (`.bmp` or `.png`).

### URL options

* `?map=chase` starts a level directly.
* `?replay=chase` plays a level's best-time replay.

## Project layout

```
public/assets/   converted original assets (PNG textures, WAV, OGG/M4A music,
                 original .3do/.rep/.rec files)
src/core/        .3DO and replay readers, vectors, coordinates, MSVC rand()
src/sim/         deterministic simulation: World (ball, collisions, routes,
                 gates, diamonds, particles), SimObject, RouteTable
src/render/      Direct3D 6-style material (per-vertex lighting, blend modes),
                 level/menu/ending views, background, bitmap font
src/game/        app shell and timing, main menu, level session (HUD, level
                 menu, banners, name entry, replays), audio, input, storage
tests/           physics checked against the original replays
tools/           convert_assets.py rebuilds public/assets/ from the release
docs/            reverse-engineering notes and the original readme files
```

The simulation has no rendering dependencies and runs at the original fixed
16 ms tick. The renderer interpolates between ticks.

## Tests

```sh
npm test           # replays all 15 original .rep files through the physics
npm run typecheck
```

## Rebuilding the assets

`public/assets/` was generated from the original release archive with:

```sh
pip install pillow   # ffmpeg with libopenmpt is also needed for the music
python3 tools/convert_assets.py path/to/extracted/ivegotsomeballs
```

## Differences from the original

* Frames are interpolated between simulation ticks for smooth motion on any
  display. The original drew the latest tick.
* The picture keeps the original 4:3 shape (letterboxed) but renders at the
  window's resolution instead of 640×480.
* Both SPECULAR "ON" settings render the intended highlight; the original's two
  settings worked around a DirectX 6.1 driver difference.
* Music is the original Impulse Tracker modules, pre-rendered and looped.
* QUIT can't close a browser tab, so it blanks the screen until a key is
  pressed.
* Additions: gamepad support, `?map=` / `?replay=` URLs, and drag-and-drop
  custom levels. F2 (Direct3D device selection) and F12 (quick quit) have no
  browser equivalent.

## Credits

*I've got some BALLS* © 1999 Sebastian Aaltonen, released as freeware with
permission to redistribute. Design, programming, 3D models and levels:
Sebastian Aaltonen. Textures: Sebastian Aaltonen, Jaakko and Jukka Tapio,
Heikki Väisänen. Sound effects: Tommi Lahtinen. Music: Tommi Lahtinen and
Sebastian Aaltonen. English documents: Ismo Horppu. Beta testing: Andrei
Stepanov and Sebastian Aaltonen. The original used the MIDAS Digital Audio
System 1.1.2 (© 1996–1997 Housemarque Inc.). The original documentation is in
`docs/original/`.

This port is an unofficial fan project. All original assets belong to their
authors.
