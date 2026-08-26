import type { GameState } from '../data/types';
import { SANCTUARY_AREAS, SAVE_KEY } from '../data/constants';
import { tickCatNeeds } from './NeedsSystem';

export interface OfflineSummary {
  minutesAway: number;
  loveEarned: number;
  headlines: string[]; // e.g. "Mochi made a new friend."
}

export function createNewGameState(): GameState {
  const now = Date.now();
  return {
    love: 0,
    adoptionTokens: 0,
    cats: [],
    areas: structuredClone(SANCTUARY_AREAS),
    furniture: [],
    machines: {},
    breedingCooldowns: {},
    strayArrivalDueAt: null,
    milestoneClaimedIds: [],
    totalPetsGiven: 0,
    totalLoveEarned: 0,
    totalRehomedCats: 0,
    totalRehomeLoveEarned: 0,
    timeOfDay: 'day',
    weather: 'sunny',
    day: 1,
    lastSavedAt: now,
    createdAt: now,
  };
}

export class SaveManager {
  save(state: GameState): void {
    state.lastSavedAt = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Failed to save game state', err);
    }
  }

  load(): GameState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw) as GameState;

      // Migration checks
      if (typeof state.adoptionTokens !== 'number') state.adoptionTokens = 0;
      if (!Array.isArray(state.furniture)) state.furniture = [];
      if (!state.machines || typeof state.machines !== 'object') state.machines = {};
      if (!state.breedingCooldowns || typeof state.breedingCooldowns !== 'object') state.breedingCooldowns = {};
      if (state.strayArrivalDueAt === undefined) state.strayArrivalDueAt = null;
      if (!Array.isArray(state.milestoneClaimedIds)) state.milestoneClaimedIds = [];
      if (typeof state.totalPetsGiven !== 'number') state.totalPetsGiven = 0;
      if (typeof state.totalLoveEarned !== 'number') state.totalLoveEarned = state.love ?? 0;
      if (typeof state.totalRehomedCats !== 'number') state.totalRehomedCats = 0;
      if (typeof state.totalRehomeLoveEarned !== 'number') state.totalRehomeLoveEarned = 0;
      if (!state.timeOfDay) state.timeOfDay = 'day';
      if (!state.weather) state.weather = 'sunny';

      return state;
    } catch (err) {
      console.warn('Failed to load save', err);
      return null;
    }
  }


  exportToFile(state: GameState): void {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'savegame.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  importFromFile(file: File): Promise<GameState> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result as string) as GameState);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  /**
   * Simulates elapsed time using coarse per-minute steps (needs decay,
   * sleep/wake cycling, and simple passive Love) rather than replaying the
   * full simulation tick-by-tick. Capped to keep load times reasonable.
   */
  applyOfflineProgress(state: GameState, maxMinutes = 8 * 60): OfflineSummary {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - state.lastSavedAt);
    const minutesAway = Math.min(elapsedMs / 60000, maxMinutes);

    let loveEarned = 0;
    const headlines: string[] = [];
    const STEP = 5; // simulate in 5-minute chunks for performance

    for (let simulated = 0; simulated < minutesAway; simulated += STEP) {
      const step = Math.min(STEP, minutesAway - simulated);
      for (const cat of state.cats) {
        tickCatNeeds(cat, step);

        if (cat.energy <= 15 && cat.animationState !== 'sleep') {
          cat.animationState = 'sleep';
        } else if (cat.animationState === 'sleep' && cat.energy >= 95) {
          cat.animationState = 'sit';
        }

        if (cat.animationState === 'sleep') {
          const isLazy = cat.majorTrait === 'lazy' || cat.minorTrait === 'lazy';
          loveEarned += (isLazy ? 0.1 : 0.05) * step;
        }
      }

      // Occasionally surface a headline event while away (cosmetic only).
      if (state.cats.length > 0 && Math.random() < 0.15) {
        const cat = state.cats[Math.floor(Math.random() * state.cats.length)];
        const options = [
          `${cat.name} made a new friend.`,
          `${cat.name} slept soundly.`,
          `${cat.name} found a feather.`,
          `${cat.name} napped in a sunbeam.`,
        ];
        const headline = options[Math.floor(Math.random() * options.length)];
        if (!headlines.includes(headline)) headlines.push(headline);
      }
    }

    state.love += loveEarned;
    state.totalLoveEarned += loveEarned;
    state.lastSavedAt = now;

    return {
      minutesAway,
      loveEarned: Math.round(loveEarned),
      headlines: headlines.slice(0, 5),
    };
  }
}
