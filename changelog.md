# Accra Life: Changelog

Every agent (module owner) records each merged change here. Newest entries go at the top of the **Unreleased** section. The integration owner moves entries under a version heading at each integration or release.

Format follows "Keep a Changelog" with module tags. Versions use semantic versioning for the game build; each module also keeps its own API version (see `communicate.md`).

## How to write an entry

One line per change, in this form:

```
- [MODULE] Short description of what changed and why. (REQ-ID, #issue/MR, @agent)
```

- `MODULE` = COR, PRF, WLD, ENV, PLY, VEH, NPC, ECO, LIF, UIX, AUD, SAV, AST, ART.
- `REQ-ID` = the requirement from the SRS (for example WLD-010). Use `none` if there is no matching requirement.
- Mark breaking changes with **BREAKING** at the start and add a migration note on the next line.
- Group entries under: Added, Changed, Deprecated, Removed, Fixed, Security, Performance.

### Example

```
### Added
- [CHR] `BodyPhysics`: stagger, fall, tumble, lie dazed, get up, landing squash; pose fields `pitch`, `bank`, `spin`. Pure code with unit tests. (none, @agent-chr)
- [PLY] Wall bonk when sprinting into a wall, knockdown by vehicles and by sprinting into people, landing squash, camera shake, mood penalty on hard falls, input locked while down. (none, @agent-ply)
- [VEH] `VehicleService.collide()`; vehicles are solid for people and brake hard after a hit. (none, @agent-veh)
- [NPC] Pedestrians get bumped, shoved and run over; they fall, lie, get up and look startled; bystanders flinch. (none, @agent-npc)
- [AUD] Thump, crunch and bump sounds for `impact` and `npcImpact`. (none, @agent-aud)
- [COR] Events `impact` (PLY) and `npcImpact` (NPC); `PlayerService.applyImpact/isDown`; `VehicleService`. Core API 0.3.0, backwards compatible. (none, @agent-cor)
- [WLD] Chunk streaming with 256 m chunks and async load/unload. (WLD-010, WLD-011, MR-12, @agent-wld)

### Changed
- [ENV] **BREAKING** `EnvService.now()` now returns `{ day, hour, minute }` instead of a timestamp.
  Migration: use `EnvService.toMinutes(now)` where a number was expected. (ENV-003, MR-31, @agent-env)

### Fixed
- [CHR] Vercel build: cast texture byte arrays to `BufferSource` for newer TypeScript lib typings. (none, @agent-chr)
- [CHR] Offline skeleton solver used a wrong Euler matrix (x rotation sheared limbs). The game rig was not affected. (none, @agent-chr)
- [VEH] Trotro no longer skips the last stop on looped routes. (VEH-010, MR-44, @agent-veh)
```

## Unreleased

### Added
- [CHR] New `@accra/characters` package: semi-realistic procedural people (jointed skeleton, body builds, outfits, hair, accessories) and a pure pose/animation solver (walk, run, idle, talk, wave, startle, jump). (none, @agent-chr)
- [COR] Appearance gains optional `build`, `outfit`, `bottom` and new hair styles; `sanitizeAppearance` for save data. Core API 0.2.0, backwards compatible. (none, @agent-cor)
- [NPC] Behaviour state machine (pause at corners, chat pairs, glances, waves, stepping aside, horn flinch, umbrellas and hurrying in rain), staffed shops and stalls, time-of-day crowd size and pace. (none, @agent-npc)
- [CHR] **Detailed skinned people**: smooth lofted body with sculpted face, ears, eyes, hands with fingers and shaped shoes; fitted clothing shells with folds, collars, plackets, belts and hems; woven fabric textures with normal maps (wax print, kente, stripe, check, denim, canvas); detailed hair (low cut, afro, cornrow tubes, braids, gele head wrap, scarf with knot), caps, glasses, shoulder bags and head-load baskets. 19-bone skeleton with 4-influence skinning. `buildDetailedTemplate(spec)` is a drop-in `PersonTemplate`. (none, @agent-chr)
- [CHR] Satchel bag with a diagonal strap that follows the torso, leather colours; sleeveless tops and dresses are truly sleeveless; plackets, buttons and kaftan trim no longer z-fight; strand and coil hair textures with normal maps; lowcut fade at the hairline; narrower kaftan sleeves. (none, @agent-chr)
- [CHR] **Clay style** (`spec.style = 'clay'`, now the default): soft toy-like people with a big round head, glossy dot eyes with highlights, brows, smile and blush, chunky hands and sneakers, short thick limbs, smooth clothes and sculpted hair shapes, matte clay materials. The `'real'` style is still available. (none, @agent-chr)
- [PLY] Player uses the detailed person. (none, @agent-ply)
- [NPC] People near the player are detailed on medium and high graphics (6 and 10 at once); the low tier and everyone further away keep the light figures. (none, @agent-npc)
- [UIX] Character creator: outfit, trousers colour, build and more hair styles. (none, @agent-uix)

### Changed
- [NPC] Nearby people are full animated figures (8/14/22 by graphics tier); distant ones stay cheap instanced figures. (none, @agent-npc)
- [PLY] Player uses the shared character with proper walk, run, idle and jump animation. (none, @agent-ply)

### Fixed
- [UIX] Mission panel no longer overlaps the minimap on narrow phone screens. (none, @agent-uix)

### Added (scaffold)
- [COR] Initial project scaffold, changelog and agent communication files. (none, @agent-cor)

### Changed

### Deprecated

### Removed

### Fixed

### Security

### Performance

---

## Module API versions

Update this table whenever a module's public API version changes.

| Module | API version | Last changed | Owner |
| --- | --- | --- | --- |
| COR | 0.1.0 | | |
| PRF | 0.1.0 | | |
| WLD | 0.1.0 | | |
| ENV | 0.1.0 | | |
| PLY | 0.1.0 | | |
| VEH | 0.1.0 | | |
| NPC | 0.1.0 | | |
| ECO | 0.1.0 | | |
| LIF | 0.1.0 | | |
| UIX | 0.1.0 | | |
| AUD | 0.1.0 | | |
| SAV | 0.1.0 | | |
| AST | 0.1.0 | | |

---

## [0.0.0] - Project start

- Repository created. SRS drafted.

## 0.1.0 - v1 vertical slice
- Added packages: core, perf, world, env, player, life, economy, npc, vehicles, audio, save, ui and the apps/game shell.
- Not yet installed or run in a browser (no npm access when written).
