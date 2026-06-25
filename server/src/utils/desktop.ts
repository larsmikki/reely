import type { DesktopId } from '../types/index.js';

// Parse a desktop id from query/body input; anything that isn't 2 means 1.
export function parseDesktopId(value: unknown): DesktopId {
  return value === 2 || value === '2' ? 2 : 1;
}
