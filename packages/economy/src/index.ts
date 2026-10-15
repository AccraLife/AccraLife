import {
  type EconomyService,
  type GameContext,
  type GameModule,
  type MissionService,
  PRICES,
  SHIFT_HOURS,
  START_CASH,
  defineModule,
  isOpen,
  openLabel,
} from '@accra/core';
import { MissionTracker, formatCedis } from './missions';

export * from './missions';

/**
 * ECO: economy, jobs and missions (SRS section 10).
 * Cash wallet, shops, one job, weekly rent and the mission journal.
 */

const MEALS = ['waakye', 'jollof rice with chicken', 'banku and tilapia', 'kenkey and fish', 'fufu with light soup', 'red red'];

export function createEconomyModule(): GameModule {
  let ctx: GameContext;
  let balance = START_CASH;
  let debt = 0;
  const tracker = new MissionTracker();
  const offs: Array<() => void> = [];

  const notify = (text: string, kind: 'info' | 'good' | 'warn' = 'info'): void => {
    ctx.events.emit('notify', { text, kind });
  };

  const publishMission = (): void => {
    const c = tracker.current();
    ctx.events.emit('missionChanged', {
      title: c ? c.def.title : 'All current missions done',
      step: c ? c.step.text : null,
      progress: c ? c.progress : '',
    });
  };

  const change = (delta: number, reason: string): void => {
    balance = Math.round((balance + delta) * 100) / 100;
    ctx.events.emit('moneyChanged', { balance, delta, reason });
  };

  const settleDebt = (): void => {
    if (debt <= 0 || balance <= 0) return;
    const pay = Math.min(debt, balance);
    debt = Math.round((debt - pay) * 100) / 100;
    change(-pay, 'Unpaid rent');
    notify(`${formatCedis(pay)} went to your unpaid rent.${debt > 0 ? ` You still owe ${formatCedis(debt)}.` : ' Rent is paid up.'}`, 'info');
  };

  const economy: EconomyService = {
    balance: () => balance,
    debt: () => debt,
    charge(amount, reason) {
      if (amount > balance + 1e-9) return false;
      change(-amount, reason);
      return true;
    },
    earn(amount, reason) {
      change(amount, reason);
      settleDebt();
    },
    format: formatCedis,
  };

  const missions: MissionService = {
    current() {
      const c = tracker.current();
      return c ? { title: c.def.title, step: c.step.text, progress: c.progress } : null;
    },
    completedCount: () => tracker.completedCount(),
    report(tag) {
      const finished = tracker.report(tag);
      for (const def of finished) {
        economy.earn(def.reward, `Mission: ${def.title}`);
        notify(`Mission complete: ${def.title} (+${formatCedis(def.reward)})`, 'good');
      }
      publishMission();
    },
  };

  const closedMessage = (kind: string, name: string): boolean => {
    const hour = ctx.services.get('env').now().hour;
    if (isOpen(kind, hour)) return false;
    notify(`${name} is closed right now. Open ${openLabel(kind)}.`, 'warn');
    return true;
  };

  const eat = (name: string): void => {
    if (closedMessage('chopbar', name)) return;
    if (!economy.charge(PRICES.chopbar, 'Meal')) {
      notify(`A plate costs ${formatCedis(PRICES.chopbar)} and you only have ${formatCedis(balance)}.`, 'warn');
      return;
    }
    const life = ctx.services.get('life');
    life.restore('hunger', 45);
    life.restore('thirst', 8);
    life.restore('mood', 6);
    ctx.events.emit('activityStarted', { label: 'Eating...', seconds: 1.5 });
    ctx.services.get('env').advanceMinutes(20);
    notify(`You enjoyed ${ctx.rng.pick(MEALS)} at ${name}. (-${formatCedis(PRICES.chopbar)})`, 'good');
    missions.report('ate');
  };

  const drink = (name: string): void => {
    if (closedMessage('kiosk', name)) return;
    if (!economy.charge(PRICES.water, 'Water')) {
      notify(`Water costs ${formatCedis(PRICES.water)}. You are short of cash.`, 'warn');
      return;
    }
    ctx.services.get('life').restore('thirst', 40);
    ctx.services.get('env').advanceMinutes(3);
    notify(`You bought a cold sachet of water. (-${formatCedis(PRICES.water)})`, 'good');
    missions.report('drank');
  };

  const work = (name: string): void => {
    if (closedMessage('work', name)) return;
    const env = ctx.services.get('env');
    const life = ctx.services.get('life');
    if (env.now().hour + SHIFT_HOURS > 19) {
      notify('Too late to start a full shift. Come back tomorrow after 07:00.', 'warn');
      return;
    }
    if (life.need('energy') < 25) {
      notify('You are too tired to work. Get some rest first.', 'warn');
      return;
    }
    ctx.events.emit('activityStarted', { label: `Working a shift at ${name}...`, seconds: 3 });
    env.advanceMinutes(SHIFT_HOURS * 60);
    life.restore('energy', -12);
    life.restore('hygiene', -8);
    const pay = Math.round(PRICES.shiftPay * (life.need('mood') > 70 ? 1.1 : 1));
    economy.earn(pay, 'Shift');
    notify(`Shift done. You earned ${formatCedis(pay)}.`, 'good');
    missions.report('worked');
  };

  return defineModule({
    id: 'economy',
    version: '0.1.0',
    dependsOn: ['env', 'life', 'world', 'player'],

    init(context) {
      ctx = context;
      ctx.services.register('economy', economy);
      ctx.services.register('missions', missions);
      const world = ctx.services.get('world');
      const nameOf = (id: string): string => world.pointsOfInterest().find((p) => p.id === id)?.name ?? 'the shop';

      offs.push(
        ctx.events.on('interactionStarted', ({ kind, targetId }) => {
          if (kind === 'chopbar') eat(nameOf(targetId));
          else if (kind === 'kiosk') drink(nameOf(targetId));
          else if (kind === 'work') work(nameOf(targetId));
        }),
        ctx.events.on('billDue', ({ amount, reason }) => {
          const pay = Math.min(balance, amount);
          if (pay > 0) change(-pay, reason);
          const owed = Math.round((amount - pay) * 100) / 100;
          if (owed > 0) {
            debt = Math.round((debt + owed) * 100) / 100;
            notify(`${reason} was due: ${formatCedis(amount)}. You could only pay ${formatCedis(pay)} and now owe ${formatCedis(debt)}.`, 'warn');
          } else {
            notify(`${reason} paid: ${formatCedis(amount)}.`, 'info');
          }
        }),
        ctx.events.on('playerFainted', () => {
          const fee = Math.min(balance, PRICES.faintFee);
          if (fee > 0) {
            change(-fee, 'Clinic fee');
            notify(`A nurse at the clinic looked you over (${formatCedis(fee)}).`, 'info');
          }
        }),
        ctx.events.on('landmarkDiscovered', ({ id, name }) => {
          notify(`Discovered: ${name}`, 'good');
          missions.report(`landmark:${id}`);
        }),
        ctx.events.on('slept', () => missions.report('slept')),
      );
    },

    start() {
      balance = START_CASH;
      debt = 0;
      tracker.reset();
      ctx.events.emit('moneyChanged', { balance, delta: 0, reason: 'Start' });
      publishMission();
    },

    serialize() {
      return { balance, debt, missions: tracker.serialize() };
    },

    deserialize(data) {
      const d = data as { balance?: number; debt?: number; missions?: { tags?: string[]; done?: string[] } } | null;
      if (!d) return;
      if (typeof d.balance === 'number') balance = d.balance;
      if (typeof d.debt === 'number') debt = d.debt;
      tracker.restore(d.missions);
      ctx.events.emit('moneyChanged', { balance, delta: 0, reason: 'Load' });
      publishMission();
    },

    dispose() {
      for (const off of offs) off();
    },
  });
}
