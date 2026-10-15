# Accra Life (v0.1.0 prototype)

A single-player 3D life simulation of Accra, Ghana, in the browser. TypeScript + Three.js, npm-workspaces monorepo, one package per module, deployed as a static site on Vercel.

## Run it

```bash
npm install
npm run typecheck
npm test
npm run dev        # http://localhost:5173
```

**Status:** this code was written without access to the npm registry, so it has NOT been installed, built or opened in a browser yet. The pure logic (core, world grid/layout, env, life, economy missions, save, settings) has the unit tests (80 so far) passing. The Three.js and DOM code is only type-checked loosely. Expect a round of small fixes on first run. Once you can run `npm install` somewhere, commit `package-lock.json` and switch the Vercel install command to `npm ci`.

## Deploy on Vercel

1. Push to GitHub and import the repo in Vercel. `vercel.json` already sets the install command, build command (`npm run build -w @accra/game`) and output folder (`apps/game/dist`).
2. No environment variables or database are needed for v1. Saves live in the player's browser (IndexedDB), with export/import.

## Controls

WASD/arrows move, Shift runs, Space jumps, E interacts, M map, R radio, F3 debug, Esc pause.

## What is in v1

A walkable procedural district with a day/night cycle and weather, needs (hunger, thirst, energy, hygiene, mood), cash, a shift job, chop bars, water kiosks, weekly rent, power cuts (dumsor), sleeping, a trotro between two stations, crowds and traffic, three missions, synthesised sound and radio, menus, character creator, map, settings and saves.

## Structure

`packages/core` contract (module interface, events, services) | `perf` renderer | `world` | `env` | `player` | `life` | `economy` | `npc` | `vehicles` | `audio` | `save` | `ui` | `apps/game` shell.
Modules talk only through events and services declared in core. Read `communicate.md` and `changelog.md` before changing a contract.

## Known gaps

- Streets, buildings and landmarks are stylised placeholders, not real Accra. They need local cultural review; shop names are fictional.
- No traffic lights, pedestrian-vehicle collisions or NPC dialogue yet.
- Never tested in a real browser or on mobile.
