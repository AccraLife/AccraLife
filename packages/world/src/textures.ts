import * as THREE from 'three';
import { Rng } from '@accra/core';

/**
 * Procedural window textures: one tile is 8 x 6 window cells. The colour map shows the facade;
 * the emissive map lights a random half of the windows at night. No image files to download.
 */
export interface WindowTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

const CELL = 64;
const COLS = 8;
const ROWS = 6;

export function createWindowTextures(seed: number): WindowTextures {
  const rng = new Rng(seed ^ 0x77aa);
  const w = CELL * COLS;
  const h = CELL * ROWS;

  const color = document.createElement('canvas');
  color.width = w;
  color.height = h;
  const c = color.getContext('2d');
  const emissive = document.createElement('canvas');
  emissive.width = w;
  emissive.height = h;
  const e = emissive.getContext('2d');
  if (!c || !e) throw new Error('[world] 2D canvas is not available');

  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, w, h);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * CELL;
      const y = row * CELL;
      // Slightly darker band under each floor and a window set into the wall.
      c.fillStyle = 'rgba(0,0,0,0.07)';
      c.fillRect(x, y + CELL - 5, CELL, 5);
      c.fillStyle = '#d6dde3';
      c.fillRect(x + 12, y + 10, 40, 36);
      const lit = rng.chance(0.5);
      c.fillStyle = lit ? '#7a8a9a' : '#2a3a4c';
      c.fillRect(x + 15, y + 13, 34, 30);
      // Window cross-bar.
      c.fillStyle = '#d6dde3';
      c.fillRect(x + 31, y + 13, 2, 30);
      if (lit) {
        e.fillStyle = rng.chance(0.5) ? '#ffcf86' : '#ffe9b8';
        e.fillRect(x + 15, y + 13, 34, 30);
      }
    }
  }

  const make = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(color), emissive: make(emissive) };
}

/** Cache of text labels drawn on canvases (point-of-interest names). */
export class LabelFactory {
  private cache = new Map<string, THREE.SpriteMaterial>();

  get(text: string, accent: number): THREE.SpriteMaterial {
    const key = `${text}|${accent}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    if (g) {
      const css = `#${accent.toString(16).padStart(6, '0')}`;
      g.fillStyle = 'rgba(10, 14, 22, 0.78)';
      g.beginPath();
      g.roundRect(6, 6, 500, 116, 22);
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = css;
      g.stroke();
      let size = 48;
      g.font = `700 ${size}px system-ui, sans-serif`;
      while (g.measureText(text).width > 460 && size > 20) {
        size -= 2;
        g.font = `700 ${size}px system-ui, sans-serif`;
      }
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 66);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, fog: false, depthWrite: false });
    this.cache.set(key, material);
    return material;
  }

  dispose(): void {
    for (const m of this.cache.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.cache.clear();
  }
}
