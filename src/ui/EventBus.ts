import Phaser from 'phaser';

/**
 * Single shared emitter connecting the Phaser scene (game logic + rendering)
 * to the DOM-based UI overlay (toolbar, HUD, journal). Keeping the toolbar
 * in the DOM rather than as Phaser objects makes it trivial to hit the
 * "Large mobile-friendly buttons / single-thumb interaction" requirement
 * from the GDD using plain CSS.
 */
export const EventBus = new Phaser.Events.EventEmitter();

export type ToolSelectedPayload = { tool: string | null };
export type LoveChangedPayload = { love: number };
export type CatSelectedPayload = { catId: string | null };
export type OfflineSummaryPayload = { minutesAway: number; loveEarned: number; headlines: string[] };
export type ToastPayload = { message: string };
export type CatsChangedPayload = { count: number };

export function isAnyModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('.modal-backdrop, .modal, .plinko-modal-backdrop, .glossary-modal-backdrop'));
}

