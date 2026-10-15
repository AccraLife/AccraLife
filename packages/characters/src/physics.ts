import { type Pose, clamp, neutralPose } from './pose';

/**
 * Body physics for one person: stagger, falling, being thrown, lying dazed and getting back up.
 * Pure numbers, no three.js. It is a small rigid-body model of the whole figure rotating about its hips,
 * plus scripted limb reactions, which gives believable falls without a full ragdoll solver.
 *
 * Use: call `hit()` when something collides with the person, then every frame call `step(dt, base)`.
 * While `output.locked` is true the owner must ignore input or AI and move the person by `dx, dz` only.
 */

export type HitKind = 'bump' | 'shove' | 'wall' | 'vehicle' | 'slip';
export type BodyMode = 'ok' | 'stagger' | 'fall' | 'tumble' | 'down' | 'rise';

export interface Impact {
  /** World direction the person is pushed (need not be unit length). */
  dirX: number;
  dirZ: number;
  /** Roughly the speed in m/s the push gives. A light nudge is about 1.5, a sprint collision about 5, a car about 9. */
  strength: number;
  kind: HitKind;
}

export interface BodyOutput {
  pose: Pose;
  /** Horizontal movement this step, in metres. Apply it through the world's collision. */
  dx: number;
  dz: number;
  /** True while the person cannot walk or be steered. */
  locked: boolean;
  mode: BodyMode;
  /** 0..1 when the body hit the ground this step (for sound and camera shake), otherwise 0. */
  thud: number;
}

/** Tuning, exported for tests. */
export const BODY = {
  nudgeBelow: 2.2,
  fallAt: 4.2,
  tumbleAt: 7.5,
  gravity: 17,
  /** Hip height when lying on the ground, in metres. */
  lieHeight: 0.17,
  pendulum: 10.5,
  riseTime: 1.5,
} as const;

const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

function hash01(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

type Axis = 'pitch' | 'bank';

export class BodyPhysics {
  mode: BodyMode = 'ok';
  /** Hip height when standing, in metres. */
  private readonly hip: number;
  private t = 0;
  private duration = 0;
  private axis: Axis = 'pitch';
  private ang = 0;
  private angVel = 0;
  private y = 0;
  private vy = 0;
  private vx = 0;
  private vz = 0;
  private spin = 0;
  private spinVel = 0;
  private pf = 0;
  private pl = 0;
  private dizzy = 0;
  private sprawl = 0;
  private strength = 0;
  private bounced = false;
  private landAmount = 0;
  private landT = 0;
  private seed = 0;
  private thudPending = 0;
  private riseFrom = 0;
  private riseY = 0;

  constructor(hipHeight: number) {
    this.hip = hipHeight;
  }

  isDown(): boolean {
    return this.mode === 'fall' || this.mode === 'tumble' || this.mode === 'down' || this.mode === 'rise';
  }

  /** True when the body is close to the ground and a second hit should not restart the fall. */
  isHelpless(): boolean {
    return this.mode === 'fall' || this.mode === 'tumble' || this.mode === 'down';
  }

  /** Put the person upright and in control immediately (teleport, respawn). */
  reset(): void {
    this.mode = 'ok';
    this.settleTarget = 0;
    this.t = this.ang = this.angVel = this.y = this.vy = this.vx = this.vz = this.spin = this.spinVel = 0;
    this.dizzy = this.landAmount = 0;
  }

  /** A jump landing: speed is how fast the person was falling, in m/s. */
  land(speed: number): void {
    const a = clamp((speed - 2.5) / 9, 0, 1);
    if (a <= 0.05) return;
    this.landAmount = Math.max(this.landAmount, a);
    this.landT = 0;
  }

  /** Something hit this person. `yaw` is the way they face (0 = +z, as in the game). */
  hit(i: Impact, yaw: number): void {
    const len = Math.hypot(i.dirX, i.dirZ) || 1;
    const dx = i.dirX / len;
    const dz = i.dirZ / len;
    const s = clamp(i.strength, 0, 14);
    this.seed = hash01(dx * 7.1 + s, dz * 3.3 + yaw);
    // The push in the person's own frame: forward and left.
    const pf = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const pl = dx * Math.cos(yaw) - dz * Math.sin(yaw);

    if (this.isHelpless()) {
      // Already on the ground: just slide a little and twitch.
      this.vx += dx * s * 0.25;
      this.vz += dz * s * 0.25;
      this.dizzy = 1;
      return;
    }
    if (this.mode === 'rise') {
      // Knocked down again while getting up.
      this.mode = 'ok';
    }

    this.strength = s;
    this.pf = pf;
    this.pl = pl;
    const slide = Math.min(s * 0.7, 6.5);
    this.vx = dx * slide;
    this.vz = dz * slide;
    this.t = 0;
    this.bounced = false;
    this.dizzy = i.kind === 'wall' ? 1 : 0.4;

    if (i.kind === 'vehicle' || s >= BODY.tumbleAt) {
      this.mode = 'tumble';
      this.axis = Math.abs(pf) >= Math.abs(pl) ? 'pitch' : 'bank';
      const sign = this.axis === 'pitch' ? Math.sign(pf) || 1 : -(Math.sign(pl) || 1);
      this.ang = 0.1 * sign;
      this.angVel = sign * (5.5 + 0.55 * s);
      this.vy = Math.min(2.4 + 0.33 * s, 6.5);
      this.y = 0;
      this.spin = 0;
      this.spinVel = (this.seed - 0.5) * 7;
      const throwSpeed = Math.min(s * 0.85, 9);
      this.vx = dx * throwSpeed;
      this.vz = dz * throwSpeed;
      this.duration = 0;
      this.thudPending = 0;
    } else if (s >= BODY.fallAt || (i.kind === 'slip' && s >= 2)) {
      this.mode = 'fall';
      this.axis = Math.abs(pf) >= Math.abs(pl) * 0.8 ? 'pitch' : 'bank';
      const sign = this.axis === 'pitch' ? Math.sign(pf) || 1 : -(Math.sign(pl) || 1);
      this.ang = 0.12 * sign;
      this.angVel = sign * (1.0 + 0.4 * s);
      this.y = 0;
      this.vy = 0;
      this.spin = 0;
      this.spinVel = (this.seed - 0.5) * 2;
    } else {
      this.mode = 'stagger';
      this.duration = clamp(0.5 + 0.12 * s + (i.kind === 'wall' ? 0.5 : 0), 0.5, 1.5);
    }
  }

  /** Ground height of the hip joint for the current body angle: standing hip height upright, lying height flat. */
  private floorHip(): number {
    const c = Math.abs(Math.cos(this.ang));
    return BODY.lieHeight + (this.hip - BODY.lieHeight) * c;
  }

  /** Advance by dt seconds. `base` is the normal walking pose (modified and returned while upright). */
  step(dt: number, base: Pose): BodyOutput {
    this.t += dt;
    let thud = 0;
    let dx = 0;
    let dz = 0;
    let pose = base;

    const slide = (friction: number): void => {
      dx = this.vx * dt;
      dz = this.vz * dt;
      const k = Math.exp(-friction * dt);
      this.vx *= k;
      this.vz *= k;
    };

    switch (this.mode) {
      case 'ok': {
        if (this.landAmount > 0) {
          this.landT += dt;
          const a = this.landAmount * Math.exp(-this.landT * 6.5) * (1 + 0.15 * Math.cos(this.landT * 14));
          if (a < 0.01) this.landAmount = 0;
          pose.hipY -= 0.13 * a * this.hip;
          pose.lHip -= 0.6 * a;
          pose.rHip -= 0.6 * a;
          pose.lKnee += 1.1 * a;
          pose.rKnee += 1.1 * a;
          pose.lean += 0.14 * a;
          pose.lShRoll += 0.45 * a;
          pose.rShRoll -= 0.45 * a;
          pose.lEl -= 0.3 * a;
          pose.rEl -= 0.3 * a;
        }
        return { pose, dx: 0, dz: 0, locked: false, mode: 'ok', thud: 0 };
      }

      case 'stagger': {
        const u = clamp(this.t / this.duration, 0, 1);
        const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
        const s = clamp(this.strength / 4, 0.3, 1.2);
        const w = this.t * 15;
        slide(5.5);
        pose = neutralPose();
        pose.lean = this.pf * 0.5 * s * env;
        pose.bank = -this.pl * 0.28 * s * env;
        pose.hipY = -0.03 * this.hip * env;
        // Arms windmill to keep balance.
        pose.lShRoll = (0.8 + 0.45 * Math.sin(w)) * env;
        pose.rShRoll = -(0.8 + 0.45 * Math.sin(w + 2.1)) * env;
        pose.lSh = -0.7 * Math.sin(w + 1) * env;
        pose.rSh = -0.7 * Math.sin(w + 3.2) * env;
        pose.lEl = -0.5 * env;
        pose.rEl = -0.5 * env;
        // A couple of quick catch-up steps.
        pose.lHip = 0.55 * Math.sin(w * 0.95) * env * (1 - u * 0.3);
        pose.rHip = -0.55 * Math.sin(w * 0.95) * env * (1 - u * 0.3);
        pose.lKnee = 0.35 * env + 0.3 * Math.max(0, Math.sin(w * 0.95)) * env;
        pose.rKnee = 0.35 * env + 0.3 * Math.max(0, -Math.sin(w * 0.95)) * env;
        pose.headPitch = this.pf * 0.3 * env - 0.05;
        pose.headYaw = 0.55 * this.dizzy * Math.sin(this.t * 9) * (1 - u);
        if (u >= 1) {
          this.mode = 'ok';
          this.vx = this.vz = 0;
        }
        return { pose, dx, dz, locked: true, mode: this.mode, thud: 0 };
      }

      case 'fall': {
        // Inverted-pendulum fall about the hips.
        const sub = 3;
        const h = dt / sub;
        for (let k = 0; k < sub; k++) {
          const acc = BODY.pendulum * Math.sin(this.ang) * 0.9 - 0.4 * this.angVel;
          this.angVel += acc * h;
          this.ang += this.angVel * h;
          // Always keep falling the same way, even if the first kick was small.
          if (Math.abs(this.angVel) < 0.25) this.angVel = Math.sign(this.ang) * 0.25;
        }
        slide(1.6);
        const LIE = 1.5;
        const dir = Math.sign(this.ang) || 1;
        if (Math.abs(this.ang) >= LIE) {
          this.ang = dir * LIE;
          const impact = Math.abs(this.angVel);
          thud = clamp(impact / 5, 0.15, 1);
          if (!this.bounced && impact > 2.2) {
            this.bounced = true;
            this.angVel = -dir * impact * 0.22;
            this.vx *= 0.7;
            this.vz *= 0.7;
          } else {
            this.angVel = 0;
            this.mode = 'down';
            this.settleTarget = this.ang;
            this.t = 0;
            this.duration = clamp(1.6 + 0.2 * this.strength, 1.8, 3.4);
            this.sprawl = this.seed;
            this.y = this.floorHip() - this.hip;
          }
        }
        if (this.mode === 'fall') this.y = this.floorHip() - this.hip;
        pose = this.fallPose(true);
        return { pose, dx, dz, locked: true, mode: this.mode, thud };
      }

      case 'tumble': {
        // Thrown through the air, rotating, then bouncing to rest.
        this.vy -= BODY.gravity * dt;
        this.y += this.vy * dt;
        this.ang += this.angVel * dt;
        this.spin += this.spinVel * dt;
        slide(0.35);
        const floor = this.floorHip() - this.hip;
        if (this.y <= floor) {
          this.y = floor;
          const impact = Math.abs(this.vy);
          if (impact > 1.6) {
            thud = clamp(impact / 8, 0.25, 1);
            this.vy = impact * 0.3;
            this.angVel *= 0.55;
            this.spinVel *= 0.5;
            this.vx *= 0.65;
            this.vz *= 0.65;
          } else {
            this.vy = 0;
            this.angVel *= Math.exp(-6 * dt);
            this.spinVel *= Math.exp(-6 * dt);
            this.vx *= Math.exp(-4 * dt);
            this.vz *= Math.exp(-4 * dt);
          }
          if (impact <= 1.6 && Math.abs(this.angVel) < 1.6) {
            // Come to rest on whichever side is nearest to flat; 'down' eases the angle there.
            const a = Math.atan2(Math.sin(this.ang), Math.cos(this.ang));
            this.ang = a;
            this.settleTarget = (a >= 0 ? 1 : -1) * 1.5;
            this.mode = 'down';
            this.t = 0;
            this.duration = clamp(1.4 + 0.15 * this.strength, 1.6, 3);
            this.sprawl = this.seed;
            this.angVel = this.vy = 0;
          }
        }
        pose = this.fallPose(false);
        return { pose, dx, dz, locked: true, mode: this.mode, thud };
      }

      case 'down': {
        slide(7);
        this.ang += (this.settleTarget - this.ang) * (1 - Math.exp(-12 * dt));
        this.y = this.floorHip() - this.hip;
        this.spin *= Math.exp(-5 * dt);
        pose = this.fallPose(false);
        const breathe = Math.sin(this.t * 3.2);
        pose.headPitch += 0.05 * breathe;
        if (this.dizzy > 0.05) pose.headYaw += 0.35 * this.dizzy * Math.sin(this.t * 6);
        this.dizzy *= Math.exp(-dt * 0.8);
        if (this.t >= this.duration) {
          this.mode = 'rise';
          this.t = 0;
          this.riseFrom = this.ang;
          this.riseY = this.y;
        }
        return { pose, dx, dz, locked: true, mode: this.mode, thud: 0 };
      }

      case 'rise': {
        slide(8);
        const p = clamp(this.t / BODY.riseTime, 0, 1);
        const e = smooth(p);
        // Push up, sit halfway, then stand.
        const stage = p < 0.5 ? smooth(p / 0.5) * 0.45 : 0.45 + smooth((p - 0.5) / 0.5) * 0.55;
        pose = neutralPose();
        const a = this.riseFrom * (1 - stage);
        if (this.axis === 'pitch') pose.pitch = a;
        else pose.bank = a;
        this.ang = a;
        const hipLow = this.riseY * (1 - e) + 0 * e;
        const crouch = Math.sin(Math.PI * p);
        pose.hipY = hipLow;
        pose.lKnee = 1.3 * crouch;
        pose.rKnee = 1.3 * crouch;
        pose.lHip = -0.9 * crouch;
        pose.rHip = -0.9 * crouch;
        const front = this.riseFrom > 0;
        // Hands push on the ground first, then swing to the sides.
        pose.lSh = (front ? -0.2 : 0.7) * (1 - e) - 0.3 * crouch * 0;
        pose.rSh = (front ? -0.2 : 0.7) * (1 - e);
        pose.lShRoll = 0.4 * crouch;
        pose.rShRoll = -0.4 * crouch;
        pose.lEl = -0.6 * crouch;
        pose.rEl = -0.6 * crouch;
        pose.headPitch = -0.2 * crouch;
        pose.headYaw = 0.25 * Math.sin(this.t * 5) * (1 - p) * this.dizzy;
        if (p >= 1) {
          this.mode = 'ok';
          this.ang = 0;
          this.y = 0;
          this.vx = this.vz = 0;
        }
        return { pose, dx, dz, locked: this.mode !== 'ok', mode: this.mode, thud: 0 };
      }
    }
    return { pose, dx, dz, locked: false, mode: this.mode, thud };
  }

  private settleTarget = 0;

  /** Limbs and body angle while falling, tumbling or lying. */
  private fallPose(falling: boolean): Pose {
    const p = neutralPose();
    const a = this.ang;
    if (this.axis === 'pitch') p.pitch = a;
    else p.bank = a;
    p.spin = this.spin;
    p.hipY = this.y;
    const flail = this.mode === 'tumble' ? 22 : 18;
    const w = this.t * flail;
    const forward = this.axis === 'pitch' && a > 0;
    const amt = falling ? clamp(Math.abs(a) / 1.1, 0.35, 1) : 1;
    if (this.mode === 'down') {
      // Sprawled: arms out, one knee up.
      const sg = this.sprawl > 0.5 ? 1 : -1;
      p.lShRoll = 0.9 + 0.25 * this.sprawl;
      p.rShRoll = -(0.8 + 0.3 * (1 - this.sprawl));
      p.lSh = forward ? -2.5 : 0.2;
      p.rSh = forward ? -2.1 : -0.1;
      p.lEl = forward ? -0.6 : -0.3;
      p.rEl = forward ? -0.5 : -0.4;
      if (!forward) {
        p.lHip = -0.5 * sg;
        p.lKnee = 0.7 * (sg > 0 ? 1 : 0.2);
        p.rHip = -0.5 * -sg;
        p.rKnee = 0.7 * (sg > 0 ? 0.2 : 1);
      } else {
        p.lHip = 0.15;
        p.rHip = -0.1;
        p.lKnee = 0.2;
        p.rKnee = 0.5;
      }
      p.headPitch = forward ? -0.5 : 0.15;
      p.headYaw = (this.sprawl - 0.5) * 0.8;
      return p;
    }
    // Falling or flying: arms flail, knees bend.
    if (forward) {
      // Bracing: arms reach out in front.
      p.lSh = -1.5 * amt + 0.2 * Math.sin(w);
      p.rSh = -1.4 * amt + 0.2 * Math.sin(w + 1);
      p.lShRoll = 0.35 * amt;
      p.rShRoll = -0.35 * amt;
      p.lEl = -0.45;
      p.rEl = -0.45;
    } else {
      p.lSh = -0.9 * amt * Math.sin(w + 0.5);
      p.rSh = -0.9 * amt * Math.sin(w + 2.6);
      p.lShRoll = (1.1 + 0.4 * Math.sin(w)) * amt;
      p.rShRoll = -(1.1 + 0.4 * Math.sin(w + 1.7)) * amt;
      p.lEl = -0.4;
      p.rEl = -0.4;
    }
    p.lKnee = 0.6 + 0.3 * Math.sin(w * 0.8);
    p.rKnee = 0.6 + 0.3 * Math.sin(w * 0.8 + 2);
    p.lHip = -0.3 - 0.25 * Math.sin(w * 0.8);
    p.rHip = -0.3 - 0.25 * Math.sin(w * 0.8 + 2);
    p.headPitch = forward ? -0.45 : 0.35;
    return p;
  }
}
