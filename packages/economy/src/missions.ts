/**
 * Missions (SRS ECO-030 to ECO-033). Data-driven: each mission is a list of steps, and a step is done
 * when its tag has been reported. Steps can be done in any order, and a tag reported early still counts.
 */
export interface MissionStep {
  tag: string;
  text: string;
}

export interface MissionDef {
  id: string;
  title: string;
  reward: number;
  steps: MissionStep[];
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'settling-in',
    title: 'Settling In',
    reward: 50,
    steps: [
      { tag: 'drank', text: 'Buy water at a kiosk (blue beacon)' },
      { tag: 'ate', text: 'Eat at a chop bar (orange beacon)' },
      { tag: 'worked', text: 'Work a shift at a shop (yellow beacon)' },
    ],
  },
  {
    id: 'know-the-city',
    title: 'Know the City',
    reward: 40,
    steps: [
      { tag: 'landmark:arch', text: 'Visit the Independence Arch' },
      { tag: 'landmark:market', text: 'Walk through Central Market' },
      { tag: 'landmark:lighthouse', text: 'Find the Lighthouse' },
    ],
  },
  {
    id: 'getting-around',
    title: 'Getting Around',
    reward: 30,
    steps: [
      { tag: 'rode', text: 'Ride a trotro (green beacon)' },
      { tag: 'slept', text: 'Sleep at home (purple beacon)' },
    ],
  },
];

export interface MissionProgress {
  def: MissionDef;
  stepIndex: number;
  step: MissionStep;
  progress: string;
}

export class MissionTracker {
  private tags = new Set<string>();
  private done = new Set<string>();

  constructor(private readonly defs: readonly MissionDef[] = MISSIONS) {}

  reset(): void {
    this.tags.clear();
    this.done.clear();
  }

  private isComplete(def: MissionDef): boolean {
    return def.steps.every((s) => this.tags.has(s.tag));
  }

  private activeDef(): MissionDef | null {
    return this.defs.find((d) => !this.done.has(d.id)) ?? null;
  }

  /** Report that something happened. Returns the missions this completed, in order. */
  report(tag: string): MissionDef[] {
    const finished: MissionDef[] = [];
    if (this.tags.has(tag)) return finished;
    this.tags.add(tag);
    for (let guard = 0; guard < this.defs.length; guard++) {
      const def = this.activeDef();
      if (!def || !this.isComplete(def)) break;
      this.done.add(def.id);
      finished.push(def);
    }
    return finished;
  }

  current(): MissionProgress | null {
    const def = this.activeDef();
    if (!def) return null;
    const stepIndex = def.steps.findIndex((s) => !this.tags.has(s.tag));
    const index = stepIndex < 0 ? def.steps.length - 1 : stepIndex;
    const doneCount = def.steps.filter((s) => this.tags.has(s.tag)).length;
    return {
      def,
      stepIndex: index,
      step: def.steps[index] as MissionStep,
      progress: `${doneCount}/${def.steps.length}`,
    };
  }

  completedCount(): number {
    return this.done.size;
  }

  serialize(): { tags: string[]; done: string[] } {
    return { tags: [...this.tags], done: [...this.done] };
  }

  restore(data: { tags?: string[]; done?: string[] } | null | undefined): void {
    this.reset();
    for (const t of data?.tags ?? []) this.tags.add(t);
    for (const d of data?.done ?? []) {
      if (this.defs.some((x) => x.id === d)) this.done.add(d);
    }
  }
}

export function formatCedis(amount: number): string {
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split('.') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}GHS ${grouped}.${cents}`;
}
