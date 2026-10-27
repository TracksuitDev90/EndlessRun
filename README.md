# EndlessRun

An endless runner through worlds within worlds. A boy in a bright orange coat
runs into the screen through a storybook world that never stops changing:
scenery unfolds out of the ground like a pop-up book as you approach, and every
half-minute or so a great doorway appears — through it you can already see the
next world, nested inside this one. Run through, and you're in it. Keep
running and the worlds come back around, each time a little stranger.

Built for phones first (swipe controls, portrait framing, adaptive resolution
to hold 60 fps), and plays just as well on desktop with a keyboard or mouse.

![The five worlds](docs/preview.jpg)

## The worlds

| # | World | Light | Inspired by |
|---|-------|-------|-------------|
| I | **The Cypress Lane** — towering scribbled cypresses, mossy-roofed houses in mustard, mint and teal, a cobbled lane | soft and glowing: wrapped shading, green-gold haze, sun shafts between the trees, leafy dapple on the cobbles | the green forest illustration (this sets the art style for everything) |
| II | **The Night Rooftops** — a slate walkway over a sleeping city, warm windows, chimney pots, a crescent moon, strings of little lights | high-contrast night: hard moonlight from ahead rims every silhouette, lamps pour warm cones and pools onto the slates, fog pools in the streets below | the night garden illustration |
| III | **The Hall of Doors** — a coral corridor open to the sky, a checkerboard floor, doors of every colour, nested door frames, doors floating among the clouds | harsh and surreal, like a de Chirico piazza: raking sun, razor-edged shadows — the sunlit wall's shadow falls across the right of the hall (and across you), each lintel throws a crisp bar | the door-in-the-head illustration |
| IV | **The Glasshouse** — a white-ribbed greenhouse tunnel of monstera, ferns, hanging blossom and orange trees | the softest: backlit humid haze, sunbeams through the glazing, drifting leaf-dappled floor | the nested garden illustration |
| V | **The Sky Road** — a sandstone causeway over amber cloud, floating islands, a huge low sun | harsh backlight: the sun dead ahead turns everything into warm silhouettes with blazing gold rims, rays fan out of the sun, shadows stream back at you | Sky Dancer |

The first lap always nests inward in that order; after that the order shuffles
(never the same world twice in a row). Each doorway is painted the colour of
the world it leads to.

### Coming back around

Every time you return to a world it has changed — the changes layer up, and
past the third return the colours start to drift and the far end of the world
rolls in slow waves:

| | 2nd visit | 3rd visit | 4th visit |
|---|---|---|---|
| Cypress Lane | golden hour, blossom trees, flower beds, petals on the wind | lilac dusk, moon, fireflies, giant flowers over the lane | teal-and-pink dream, aurora, cypresses changing colour |
| Night Rooftops | paper sky lanterns drift up, faint aurora | a huge moon, strong aurora | purple night, hot-air balloons |
| Hall of Doors | the books take flight | a tea party at dusk: teal-and-cream floor, teacups and teapots adrift | violet night, the shadows swap sides, clocks float past |
| Glasshouse | butterflies over the beds, pink petals | dusk, rose glass, giant blooms in the beds | bioluminescent night, glowing spores, aurora |
| Sky Road | flocks of birds | a ringed planet in a pink sky | whales swimming through the clouds |

![The Hall of Doors on four visits](docs/laps.jpg)

## Controls

| | Touch | Keyboard | Mouse |
|---|---|---|---|
| Jump | swipe up | ↑ / W / Space | drag up |
| Slide | swipe down (in the air: dive and slide on landing) | ↓ / S / Shift | drag down |
| Change lane | swipe left / right | ← → / A D | drag left / right |
| Pause | ⏸ button | Esc / P | ⏸ button |

Swipes fire the moment your finger has travelled far enough — you don't have
to lift it — which is what makes the controls feel instant. A jump pressed just
before landing is buffered.

**Hits:** clipping something from the side, or tripping over a low obstacle /
bumping a high one, makes you *stumble* (ink creeps in from the screen edges
while you're vulnerable). A second hit within ~4.5 s, or running head-on into
a wall, knocks you down. You get one free **Continue** per run (configurable).

**Speed** starts at 12 m/s and eases toward 28 m/s over several minutes.
Obstacles start out roughly 3 seconds apart and close in gradually to about a
second, with the odd longer breather; combinations (two walls, zigzags,
tunnels) unlock as the run goes on. All of it is tunable in `CONFIG.obstacles`.

**Reading obstacles.** Every world draws its obstacles with the same grammar:
*low and solid to the ground* — jump it; *a frame or overhang with clear floor
beneath, its lowest edge on the same duck line in every world* — slide under
it; *tall and solid* — go around it.

## Run it locally

No build step and no dependencies to install — it's plain ES modules with
three.js vendored in `vendor/three`. Any static file server works (browsers
won't load modules from `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

To try it on your phone, serve it on your local network (e.g.
`python3 -m http.server 8000 --bind 0.0.0.0`) and open your computer's IP.

## Publish on GitHub Pages

1. Push this branch / merge it to `main`.
2. In the repository: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<your-user>.github.io/<repo>/` on your phone. It can be added
   to the home screen and launches full-screen.

## Debug flags

Append to the URL:

| Flag | Effect |
|---|---|
| `?debug` | FPS, draw calls, triangles, pixel ratio, distance overlay. **N** skips to just before the next doorway, **G** toggles god mode |
| `?world=rooftops` | start in a given world (`village`, `rooftops`, `corridor`, `conservatory`, `causeway`) |
| `?visit=2` | start on a later lap's look (0 = first time through) |
| `?seed=42` | reproducible layout |
| `?god` | no collisions |
| `?dpr=1.5` | force a pixel ratio (disables adaptive resolution) |
| `?manual` | no render loop; drive frames with `__step(frames, dt)` from the console (used for automated tests) |

## How it holds 60 fps

- **Everything is instanced.** Each prop type (a cypress, a house, a hedge…) is
  one `InstancedMesh`; a world draws in roughly 30–60 draw calls including ink
  outlines. Placements live in plain records and are only re-uploaded when
  chunks stream in/out — steady-state frames do no buffer work. The game logic
  takes well under a millisecond per frame.
- **Procedural generation is cheap here.** The track streams in 16 m chunks
  just ahead of you and recycles them behind, so only ~15 chunks exist at once
  no matter how far you run. A floating origin keeps float precision perfect
  over unlimited distance.
- **Animation happens on the GPU.** The pop-up unfolding, buildings rising,
  doors swinging, foliage swaying, wings and book covers flapping, drifting
  props and the curved-world bend are all done in the vertex shader from
  distance and time — no per-object CPU updates.
- **One skinned runner.** The boy is a single skinned mesh (plus its ink hull)
  on a ~60-bone skeleton — two draw calls. Keyframed run / jump / slide poses
  are layered with springs (follow-through on the head, wrists and hair), a
  hinged coat skirt pushed aside by his legs, verlet scarf tails in the air
  stream and a pendulum satchel; the whole simulation costs a fraction of a
  millisecond.
- **Cheap, painterly shading.** Hand-written toon shader with a per-world
  lighting model: terminator softness and wrap (harsh vs soft worlds), rim /
  back light, low-lying mist, leaf dapple, an analytic wall shadow, colour
  grade and a tinted vignette — no shadow maps, no post-processing passes.
  Light shafts and lamp cones are soft additive volumes; cast shadows are
  decals. Ink lines use the inverted-hull trick.
- **No hitches.** All shaders are compiled during the loading screen; no
  allocations in the hot loop.
- **Adaptive resolution.** Renders at up to 2× device pixels and steps down in
  0.25 increments if the frame rate dips below ~52 fps.

The doorway effect renders in two passes while a door is in view: the doorway
shape writes a stencil mask and the *next* world draws only inside it; then the
current world draws normally with the doorway "plugged" in the depth buffer,
so the old world continues around the door frame while the new one shows
through it.

## Project layout

```
index.html, css/style.css     page shell, overlay UI
src/config.js                 every gameplay / feel / camera tunable
src/main.js                   boot, render loop, adaptive resolution, input wiring
src/core/                     input (swipes + keys), ambient audio, seeded RNG
src/render/                   shaders, geometry kit, instanced batches, textures, particles
src/world/                    world runtime + one file per world (art, lighting, lap
                              variations, layout, obstacles, doorway); whimsy.js holds
                              the shared later-lap props and light volumes
src/game/                     game loop, player (model + animation + movement),
                              camera, course (world order), chunk streaming,
                              obstacle director, portal
vendor/three/                 three.js r185 (MIT)
```

### Adding a world

Create `src/world/<name>.js` exporting `{ id, name, doorColor, env, visits,
gate, build(b), chunk(ctx), obstacles }` (copy any existing world as a
template) and add it to `src/world/index.js`. `env` sets the palette and the
lighting (`light.soft` / `wrap` for harsh vs soft light, `rim`, `mist`,
`dapple`, `grade`, `skyFx`, …); `visits` lists partial `env` overrides for
each return. `build` registers prop batches from the geometry kit (`b.toon`,
`b.beam` for light volumes, `b.pool`, `b.shadow`); `chunk` places scenery for
each 16 m chunk and can check `ctx.visit` to add later-lap props; `obstacles`
maps the three gameplay kinds (L = jump over, H = slide under, W = go around)
to your themed props — keep H obstacles' lowest edge at `CONFIG.duckLine`.

## Not in yet (on purpose)

Score, keys/collectibles, power-ups, extra characters and sound effects are
left for the next pass; the ambient soundtrack is generated live with Web Audio.
