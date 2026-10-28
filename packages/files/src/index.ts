import fs from 'node:fs';
export { lockDirectory, processOwnsLock } from './process-lock.js';
export { publicFetch, publicAddress, privateAddress, configuredFetch, type PublicFetchOptions } from './network.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function readJson(file: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}
export function appendJsonl(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf8');
}
export function readJsonl(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      if (index === lines.length - 1) return [];
      throw new Error(`JSONL 损坏：${path.basename(file)}:${index + 1}`);
    }
  });
}
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const output: Record<string, unknown> = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || /^has[A-Z]/.test(key)) continue;
    output[key] =
      value && typeof value === 'object' && !Array.isArray(value) ? deepMerge(output[key], value) : value;
  }
  return output;
}
export * from './secrets.js';
export * from './browse-lock.js';
export { modelImage, firstGifFrame } from './images.js';
