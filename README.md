# Cozy Cat Sanctuary

A relaxing cat collection/idle sim, built per the GDD v1.0 (Phaser 3 + TypeScript + Vite, static site, no backend).

This is a **working scaffold**: it runs, saves, and is playable end-to-end (adopt, feed/pet/brush/toy/wash, watch cats wander/sleep, offline progress), using **procedurally-drawn placeholder cats** in place of the licensed asset pack referenced in the GDD.

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```


## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`. In the repo settings, set **Pages → Source → GitHub Actions**. `vite.config.ts` uses `base: './'` so the build works whether it's served from a project subpath (`username.github.io/repo/`) or a custom domain.

## Project structure

```
src/
  data/            Static definitions & procedural generation (no Phaser deps)
    types.ts          Cat / GameState / SanctuaryArea interfaces (matches the GDD's Cat Data Model)
    traits.ts          The 9 personality traits + effect descriptions
    catAssets.ts        Color/pattern/name pools (10 MVP colors, room for the full 50+)
    constants.ts         Tunable rates: need decay, Love generation, area capacities
    catFactory.ts        generateCat() — procedural cat generation

  systems/          Pure(ish) gameplay logic, framework-agnostic
    NeedsSystem.ts        Hunger/cleanliness/affection/fun/energy decay + happiness
    LoveManager.ts         Currency: earning, spending, adoption pricing
    RelationshipSystem.ts  Friendship/rival tracking (-100..100)
    JournalSystem.ts       Per-cat history log ("Cat Journal" from the GDD)
    EventSystem.ts         Dynamic events: Found Feather, Zoomies, Shared Nap, etc.
    InteractionSystem.ts   Tool application: food/pet/brush/toy/wash
    SaveManager.ts         localStorage save/load, offline progress simulation, export/import

  entities/
    CatSprite.ts     Phaser Container: placeholder art + wander/sleep state machine

  scenes/
    BootScene.ts       Seam for loading the real asset pack later
    SanctuaryScene.ts  Main game loop: spawns cats, ticks systems, wires input

  ui/               DOM overlay (NOT Phaser UI) — large mobile-friendly buttons per the GDD
    EventBus.ts       Typed Phaser.Events.EventEmitter connecting scene <-> DOM UI
    UIManager.ts       HUD, bottom toolbar, adopt button, toasts, journal & save modals
    ui.css              Mobile-first styling, safe-area aware
```

The UI toolbar/HUD is deliberately built as a DOM overlay rather than Phaser
game objects — it's much less code to get "large tap targets, single-thumb
interaction, no hover" right with CSS than with Phaser UI primitives, and it
keeps `SanctuaryScene` focused on simulation + rendering. The two layers only
ever talk through `EventBus`.

## Integrating the real asset pack

Right now every cat is drawn procedurally in `CatSprite.draw()` (colored
ellipse body + ears + a couple of pattern accents) using the hex values in
`data/catAssets.ts`. To swap in the licensed pack described in the GDD:

1. Drop the spritesheet/atlas into `public/assets/cats/`.
2. Load it in `BootScene.preload()` (there's a commented example already).
3. Replace `CatSprite`'s constructor/`draw()`/`update()` with a real
   `Phaser.GameObjects.Sprite` and swap animation keys using the mapping
   table from the GDD:

   | Animation   | Behavior         |
   |-------------|------------------|
   | Sit         | Idle             |
   | Look Around | Curious          |
   | Lay Down    | Relax            |
   | Sleep       | Recover Energy   |
   | Walk        | Wander           |
   | Run         | Zoomies          |
   | Play        | Toy Interaction  |

   `cat.animationState` already tracks which of these seven states each cat
   is in, so the mapping is a drop-in swap — no changes needed to
   `NeedsSystem`, `EventSystem`, etc.

## What's implemented (MVP v0.1 scope from the GDD)

- ✅ 10 cat colors + 6 patterns, procedurally combined
- ✅ 9 personality traits (major + minor per cat)
- ✅ Adoption (Love-gated, capacity-gated to the Yard)
- ✅ Feed / Pet / Brush / Toy / Wash interactions
- ✅ Love currency generation (interactions, sleeping cats, happy relationships)
- ✅ Offline progress (simulated in 5-minute steps, capped at 8 hours, summarized on return)
- ✅ Cat Journal (favorite food/toy, longest nap, pets received, best friend, event log)
- ✅ Save system (autosave every 30s to localStorage + manual export/import of `savegame.json`)
- ✅ Wander/sleep AI, relationship building (shared naps), dynamic events

## What's intentionally NOT implemented yet (per MVP scope)

Decorations, Adoption Token prestige loop, weather, visitors/Cat Café, rare
cats (Golden/Ghost/Heterochromia/Royal), and the Shelter/Sunroom/Café areas
beyond their unlock thresholds being defined in `constants.ts`. The data
model (`GameState.areas`, `Cat.isRare`/`rareType`) already has room for all
of these — `SANCTUARY_AREAS` and `RareCatType` are ready to be wired up
without further schema changes.

## Design notes / where to look for specific systems

- **Low stress, no fail states**: `NeedsSystem` never reduces `happiness` to
  zero from a single missed need, and low needs only throttle Love
  generation — see `computeHappiness()`.
- **Personality first**: every gameplay system (`NeedsSystem`,
  `LoveManager`, `RelationshipSystem`, `EventSystem`) reads
  `cat.majorTrait`/`cat.minorTrait` to modulate behavior, so traits have
  systemic effects rather than being cosmetic flavor text.
- **Watching is gameplay**: `CatSprite.update()` runs an idle/wander/sleep
  state machine independent of player input; `EventSystem` fires ambient
  events (nap together, zoomies, found a feather) without any tap required.
