import type { WorldService } from '@accra/core';
import { cssHex } from './dom';

/** Marker colours match the beacons in the world. */
export const MARKER_COLORS: Record<string, number> = {
  chopbar: 0xff8a2b,
  kiosk: 0x2bb3ff,
  work: 0xffd23b,
  home: 0xb67bff,
  trotro: 0x35e08a,
};

export const MARKER_NAMES: Record<string, string> = {
  chopbar: 'Chop bar',
  kiosk: 'Water kiosk',
  work: 'Work',
  home: 'Home',
  trotro: 'Trotro',
};

export interface MapView {
  /** World point at the centre of the canvas. */
  cx: number;
  cz: number;
  /** Canvas pixels per metre. */
  scale: number;
}

/**
 * Draw the street grid, landmarks and points of interest. Used by the minimap (small, follows the player)
 * and the full map (whole district).
 */
export function drawMap(
  g: CanvasRenderingContext2D,
  size: number,
  world: WorldService,
  view: MapView,
  player: { x: number; z: number; yaw: number },
  options: { labels: boolean; dot: number },
): void {
  const pitch = world.chunkSize / 2;
  const roadHalf = 6;
  const toX = (x: number): number => size / 2 + (x - view.cx) * view.scale;
  const toY = (z: number): number => size / 2 + (z - view.cz) * view.scale;

  g.fillStyle = '#2d2a24';
  g.fillRect(0, 0, size, size);

  // Blocks inside the district bounds.
  const b = world.bounds;
  g.fillStyle = '#3a362e';
  g.fillRect(toX(b.minX), toY(b.minZ), (b.maxX - b.minX) * view.scale, (b.maxZ - b.minZ) * view.scale);

  // Roads.
  g.fillStyle = '#8f8a7c';
  const first = Math.ceil(b.minX / pitch);
  const last = Math.floor(b.maxX / pitch);
  const w = Math.max(2, roadHalf * 2 * view.scale);
  for (let i = first; i <= last; i++) {
    g.fillRect(toX(i * pitch) - w / 2, toY(b.minZ), w, (b.maxZ - b.minZ) * view.scale);
    g.fillRect(toX(b.minX), toY(i * pitch) - w / 2, (b.maxX - b.minX) * view.scale, w);
  }

  // Landmarks.
  g.font = `${options.labels ? 12 : 9}px system-ui, sans-serif`;
  g.textAlign = 'center';
  for (const l of world.landmarks()) {
    const x = toX(l.x);
    const y = toY(l.z);
    g.fillStyle = '#f4efe6';
    g.beginPath();
    g.moveTo(x, y - options.dot - 2);
    g.lineTo(x + options.dot, y + options.dot);
    g.lineTo(x - options.dot, y + options.dot);
    g.closePath();
    g.fill();
    if (options.labels) g.fillText(l.name, x, y - options.dot - 6);
  }

  // Points of interest.
  for (const p of world.pointsOfInterest()) {
    const x = toX(p.x);
    const y = toY(p.z);
    if (x < -10 || y < -10 || x > size + 10 || y > size + 10) continue;
    g.fillStyle = cssHex(MARKER_COLORS[p.kind] ?? 0xffffff);
    g.beginPath();
    g.arc(x, y, options.dot, 0, Math.PI * 2);
    g.fill();
  }

  // Player arrow. Forward is (sin yaw, cos yaw) in (x, z).
  const px = toX(player.x);
  const py = toY(player.z);
  const fx = Math.sin(player.yaw);
  const fz = Math.cos(player.yaw);
  const s = options.dot + 3;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#c8402f';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px + fx * s * 1.4, py + fz * s * 1.4);
  g.lineTo(px - fx * s + -fz * s * 0.8, py - fz * s + fx * s * 0.8);
  g.lineTo(px - fx * s - -fz * s * 0.8, py - fz * s - fx * s * 0.8);
  g.closePath();
  g.fill();
  g.stroke();
}
