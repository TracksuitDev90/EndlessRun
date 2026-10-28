# EndlessRun

An endless runner through worlds within worlds. A young wayfarer in a puffer
jacket and a crimson hooded cape runs into the screen through a storybook world that never stops changing:
scenery unfolds out of the ground like a pop-up book as you approach, and every
half-minute or so a great doorway appears — through it you can already see the
next world, nested inside this one. Run through, and you're in it. Keep
running and the worlds come back around, each time a little stranger — and
the deeper you go, the less they hold their shape: roads corkscrew, forests
melt, skies swirl like wet paint. Every doorway also raises your score
multiplier, so the strangest stretches are the ones worth the most.

Built for phones first (swipe controls, portrait framing, adaptive resolution
to hold 60 fps), and plays just as well on desktop with a keyboard or mouse.

![The six worlds](docs/preview.jpg)

## The worlds

| # | World | Light | Inspired by |
|---|-------|-------|-------------|
| I | **The Cypress Lane** — towering scribbled cypresses, mossy-roofed houses in mustard, mint and teal, a cobbled lane | soft and glowing: wrapped shading, green-gold haze, sun shafts between the trees, leafy dapple on the cobbles | the green forest illustration (this sets the art style for everything) |
| II | **The Deepwood** — colossal mossy trunks on buttress roots under a canopy that closes overhead, a trodden path through long grass, ferns, wildflowers, glowing mushrooms; the way out is two ancient trees grown into an arch, hung with paper lanterns | deep shade: cool dark shadows, heavy vignette, shafts of light through gaps in the leaves pooling warm on the path, ground mist, fog that swallows the far trunks, fireflies | the marsh, the creek through the meadow and the dark forest stream (Ghibli-style painted backgrounds) |
| III | **The Night Rooftops** — a slate walkway over a sleeping city, warm windows, chimney pots, a crescent moon, strings of little lights | high-contrast night: hard moonlight from ahead rims every silhouette, lamps pour warm cones and pools onto the slates, fog pools in the streets below | the night garden illustration |
| IV | **The Hall of Doors** — a coral corridor open to the sky, a checkerboard floor, doors of every colour, nested door frames, doors floating among the clouds | harsh and surreal, like a de Chirico piazza: raking sun, razor-edged shadows — the sunlit wall's shadow falls across the right of the hall (and across you), each lintel throws a crisp bar | the door-in-the-head illustration |
| V | **The Glasshouse** — a white-ribbed greenhouse tunnel of monstera, ferns, hanging blossom and orange trees | the softest: backlit humid haze, sunbeams through the glazing, drifting leaf-dappled floor | the nested garden illustration |
| VI | **The Sky Road** — a sandstone causeway over amber cloud, floating islands, a huge low sun | harsh backlight: the sun dead ahead turns everything into warm silhouettes with blazing gold rims, rays fan out of the sun, shadows stream back at you | Sky Dancer |

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
| Deepwood | firefly night: moonbeams, little white forest spirits watching from the roots, their heads rattling | the toadstool dusk: violet haze, giant glowing toadstools among the trunks, spores drifting up | the dreaming wood: rainbow bark, jellyfish drifting between the trees, aurora through the leaves |
| Night Rooftops | paper sky lanterns drift up, faint aurora | a huge moon, strong aurora | purple night, hot-air balloons |
| Hall of Doors | the books take flight | a tea party at dusk: teal-and-cream floor, teacups and teapots adrift | violet night, the shadows swap sides, clocks float past |
| Glasshouse | butterflies over the beds, pink petals | dusk, rose glass, giant blooms in the beds | bioluminescent night, glowing spores, aurora |
| Sky Road | flocks of birds | a ringed planet in a pink sky | whales swimming through the clouds |

![The Hall of Doors on four visits](docs/laps.jpg)

![The Deepwood on four visits](docs/deepwood.jpg)

### Dream depth

On top of the per-world looks, every doorway takes you one world *deeper*, and
the deeper you are the less the worlds hold their shape. The first world is
always untouched; from the second on, each stretch of the course is dealt its
own seeded *dream recipe* — a handful of distortions, more of them and stronger
the deeper it lies — so no two passes through the same world ever look alike.
A recipe blends into the next as you run up to each doorway, so the world
morphs around you on the approach, and coming through a doorway sends a bloom
of colour out from the centre of the screen and a swell racing down the road.

| Distortion | What happens |
|---|---|
| twist | the road ahead corkscrews about its own axis |
| waves | slow swells roll through the far world |
| melt | the far world wobbles like jelly, the tall things most |
| breathe | props in the distance swell and settle like living things |
| rings | rings of hue roll toward you through the world |
| swirl | the sky stirs like wet paint, banded in rainbow |
| neon | ink lines burn in cycling neon |
| palette | the whole world turns to new hues |

It creeps in gently over the first lap (a little breathing, a sky starting to
swirl), is unmistakable by the second, and is in full flight by the third. Every
so often a deeper world comes up *lucid* — calm, a breather — before it gets
strange again. Past ~0.35 depth the camera starts to sway a little, too.

Two rules keep it fair and readable: every shape distortion grows with distance
from the camera, so the stretch of road you're actually reacting to — and every
obstacle on it — is always exactly where it looks (things far off firm up into
their true shape as they approach); and the runner keeps their own colours
however far the palette shifts, so you never lose yourself. If your system asks
for reduced motion, the shape warps and camera sway are scaled right down (the
colour is left alone). Tunables live in `CONFIG.dream`.

![The dream deepening: worlds 3, 6, 10, 13 and 20 — the last three panels are all the Sky Road](docs/dream.jpg)

## Score

You score **one point per meter × your depth** — ×1 in the first world, ×2
once through the first doorway, ×3 after the next, and so on — plus a **clear
bonus** of 10 × depth for every obstacle you get past without touching it
(double for full-width rows). So surviving deeper is worth far more than
running further: the multiplier is the badge stamped on the end of the score
pill, and it bumps every time you come through a door. Stumbling costs you that
obstacle's bonus; a Continue keeps your score and multiplier.

Your best is saved on the device, shown on the title screen, and the moment you
pass it mid-run a *new best!* ribbon pops under the score with a little run of
chimes. The crash card tallies the run against your best. Tunables live in
`CONFIG.score`.

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
it; *tall and solid* — go around it. In the Deepwood that's a creek banked with
stones (jump it — and since it's water, you can't land on it: drop into it and
you trip), a fallen tree propped on a boulder and a stump, its hanging moss
ending on the duck line (slide under it), and giant mossy boulders, one of them
roped and hung with paper streamers like a shrine stone (go around).

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
| `?world=rooftops` | start in a given world (`village`, `forest`, `rooftops`, `corridor`, `conservatory`, `causeway`) |
| `?visit=2` | start on a later lap's look (0 = first time through) |
| `?dream=1` | pin every world to one dream depth (0 = off, ~1.35 = the deepest); each world still deals its own recipe |
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
- **One skinned runner.** The wayfarer is a single skinned mesh (plus its ink
  hull) — two draw calls, ~23k sculpted triangles plus the cape. Legs are
  placed by IK, the body rides on spring follow-through, the cape is a small
  cloth simulation and the mantle, curls and hip pouch are springs; animation
  and simulation together take about 0.6 ms (see [The runner](#the-runner)).
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

## The runner

![The wayfarer: front, three-quarter, side, back and mid-stride](docs/runner.jpg)

**Modelled as continuous surfaces, not assembled from parts.**
`tools/runner/build.py` sculpts the character offline the way a sculptor
blocks out a figure: each garment (head, hair, puffer, shorts, legs, boots,
hands, mantle, pouch) is one signed-distance field made of volumes blended
smoothly into each other, so shoulders flow into the sleeves, limbs taper and
the shorts wrap the hips. The fields are polygonised (marching cubes),
simplified, and given exact smooth normals from the field; skin weights come
from which volume "owns" each point of the surface, so the mesh bends where the
shapes blend. Proportions follow the reference illustration: about six heads
tall (the head and hair are sculpted in their own space and placed scaled on
the neck), knee a little under a third of the height, high socks and chunky
mid-cut hiking boots with a thick sole and a collar that dips at the front.
Fine linework — quilting seams, laces, the face, trims, the cape's crest — is
not modelled: each vertex carries a few smooth coordinates and the character
shader draws those lines crisply at any distance. Shading is one broad, crisp
shadow shape per surface in a warm shadow tone, a restrained hair highlight
and a thin dark contour tinted by the material under it.

The build writes `assets/runner/runner.json` (skeleton, rig constants, parts)
and `runner.bin` (vertex data), loaded once at boot. To change the character,
edit `build.py` and regenerate (about ten seconds):

```sh
pip install numpy scipy scikit-image fast-simplification
python3 tools/runner/build.py
```

**Animation.** The running legs are placed, not keyed: while a foot is down
the ball of the boot is pinned to the ground and carried back at exactly the
ground speed as the heel peels up over it; in the air the ankle follows a
designed path (heel kicks up under the hips, the knee drives through, the foot
reaches and paws back down), and a two-bone solve turns that into thigh and
knee angles — the knee always bends forward, the pelvis sinks into each
contact, the thighs turn against the pelvis's swing so a planted foot never
twists, and the arms swing against the legs with bent elbows. A 0.6 m leg can
only stay planted for ~0.58 m of ground, which at the game's 12–28 m/s is a few
hundredths of a second: at the starting pace contact has no slip at all; at
higher speeds contact is held for a minimum of ~2.4 frames so the planted pose
reaches the screen, and the leftover slip is straight back along the run inside
those frames (no sinking, floating or sideways skid). Jump and slide are
keyed poses; idle is keyed too but stands on planted feet (IK), easing its
weight from one leg to the other. Poses blend with second-order springs, so
every transition eases in and out.

**Weight and follow-through.** On top of the pose, the torso, head and arms
ride on the pelvis like loose springs, kicked by the pelvis's change of
velocity each frame — the stride's bounce and sway, and the root's lane
changes, jumps, landings and changes of pace (as impulses, so a sudden move
hits equally hard at any frame rate). Every footfall ripples up the spine and
drops the arms a touch; a lane change whips the shoulders across and lets them
swing back through; a take-off folds the body, the flight lets it float open
with the arms rising, and a landing folds it again before it springs up. Arms,
elbows, spine and head also trail their own posed motion on springs, so they
lag and overshoot at every reversal, and the lean into a lane change settles
with a soft overshoot.

**Fabric.** The cape is a 13×13 particle cloth of a light, floaty wool, hung
inside the mantle's hem and kept off the body by capsule colliders. The
headwind streams it back further as the pace rises (about 40° at the starting
pace, 55° at full tilt), long slow waves roll from the shoulders to the hem,
and very little air damping lets every bounce, lane change, take-off and
landing carry on through the cloth. A soft breeze — slow swells from a
wandering direction, with occasional gusts — sways it when he stands still and
keeps working on it while he runs. A soft ceiling stops it from flipping
forward over the shoulders but slopes up behind, so it can billow up and back
when he falls from a jump. The mantle is twelve hinged panels: the arms tip
them up and over, the breeze lifts them, and the hem bobs a beat behind each
footfall. Curls lag and bounce on springs and play in the breeze; the hip
pouch swings on a pendulum.

**Third-party assets.** None. Free bases and animation (Kenney, Quaternius /
Poly Pizza, OpenGameArt, Sketchfab, Mixamo, Poly Haven) were considered, but the
environment this was built in could not reach any of those hosts, so nothing
was downloaded or evaluated; the character, rig, animation and shading here are
all original. A suitable base mesh could still be adopted later: the game only
needs a skinned mesh whose bones are named like the ones `build.py` writes.

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
src/game/                     game loop, player (animation, IK legs, secondary
                              motion, movement), outfit (palette, cape), cloth,
                              runner asset loader, camera, course (world order),
                              chunk streaming, obstacle director, portal, dream
                              (depth recipes and the shared warp uniforms)
tools/runner/build.py         offline sculpt of the runner -> assets/runner/
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
An obstacle spec can also bring companion batches drawn with another material
(`with: ['creekWater']`), lower its collision top (`top`), skip its contact
shadow (`flat`), or be water you can't stand on (`wade`). `b.toon(…, { water:
true })` gives a surface the running-water shader, and ground pattern 6 is the
forest's long grass (pass the chunk distance as `p0` so it runs on seamlessly).

## Not in yet (on purpose)

Keys/collectibles, power-ups, extra characters and most sound effects are
left for the next pass; the ambient soundtrack is generated live with Web Audio.
