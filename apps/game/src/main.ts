import { Game } from '@accra/core';
import { createPerfModule } from '@accra/perf';
import { createWorldModule } from '@accra/world';
import { createEnvModule } from '@accra/env';
import { createPlayerModule } from '@accra/player';
import { createLifeModule } from '@accra/life';
import { createEconomyModule } from '@accra/economy';
import { createNpcModule } from '@accra/npc';
import { createVehiclesModule } from '@accra/vehicles';
import { createAudioModule } from '@accra/audio';
import { createSaveModule } from '@accra/save';
import { createUiModule, loadSettings } from '@accra/ui';

const fill = document.getElementById('boot-fill');
const label = document.getElementById('boot-label');
const boot = document.getElementById('boot');

function showError(message: string): void {
  if (label) {
    label.className = 'err';
    label.textContent = message;
  }
}

async function main(): Promise<void> {
  const game = new Game(loadSettings());
  (window as unknown as { __accraGame: Game }).__accraGame = game;

  game.events.on('loadProgress', ({ label: text, fraction }) => {
    if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
    if (label) label.textContent = text;
  });
  game.events.on('phaseChanged', ({ phase }) => {
    if (phase === 'menu') boot?.classList.add('done');
  });

  game
    .register(createPerfModule())
    .register(createWorldModule())
    .register(createEnvModule())
    .register(createPlayerModule())
    .register(createLifeModule())
    .register(createEconomyModule())
    .register(createNpcModule())
    .register(createVehiclesModule())
    .register(createAudioModule())
    .register(createSaveModule())
    .register(createUiModule({ startModules: () => game.startModules() }));

  await game.init();
  game.run();

  // Debug helpers for the browser console: window.accra.teleport(x, z), .setHour(h), .addMoney(n), .setWeather('heavyRain')
  (window as unknown as { accra: unknown }).accra = {
    game,
    teleport: (x: number, z: number) => game.services.get('player').teleport(x, z),
    setHour: (hour: number) => game.services.get('env').setTimeOfDay(hour),
    setWeather: (w: Parameters<ReturnType<typeof game.services.get<'env'>>['setWeather']>[0]) => game.services.get('env').setWeather(w),
    addMoney: (n: number) => game.services.get('economy').earn(n, 'Debug'),
  };
}

main().catch((error) => {
  console.error(error);
  showError(`Could not start the game: ${error instanceof Error ? error.message : String(error)}. Your browser may not support WebGL2.`);
});
