import type { GameState } from '../data/types';
import { SANCTUARY_AREAS, SAVE_KEY } from '../data/constants';
import { tickCatNeeds } from './NeedsSystem';

export interface OfflineSummary {
  minutesAway: number;
  loveEarned: number; // Care Points
  starsEarned: number;
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
    offlineStarLevel: 1,
    catPerfumeCount: 0,
    fenceLayout: 'none',
    totalPetsGiven: 0,
    totalLoveEarned: 0,
    totalRehomedCats: 0,
    totalRehomeLoveEarned: 0,
    timeOfDay: 'day',
    weather: 'sunny',
    day: 1,
    plinkoUpgrades: {},
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
      if (typeof state.offlineStarLevel !== 'number' || state.offlineStarLevel < 1) state.offlineStarLevel = 1;
      if (typeof state.catPerfumeCount !== 'number' || state.catPerfumeCount < 0) state.catPerfumeCount = 0;
      if (!state.fenceLayout || !['none', 'horizontal', 'vertical', 'both'].includes(state.fenceLayout)) {
        state.fenceLayout = 'none';
      }
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
      if (!state.plinkoUpgrades || typeof state.plinkoUpgrades !== 'object') state.plinkoUpgrades = {};

      // Ensure cats have valid life stages; promote non-kittens or legacy cats to adults
      if (Array.isArray(state.cats)) {
        for (let i = 0; i < state.cats.length; i++) {
          const cat = state.cats[i];
          if (!cat.stage || cat.growthProgress >= 100 || (cat.ageDays && cat.ageDays >= 1)) {
            cat.stage = 'adult';
            cat.growthProgress = 100;
          }
          if (cat.mutation === undefined) {
            cat.mutation = null;
          }
          // If sanctuary has cats but fewer than 2 adults, promote the oldest ones so breeding is available
          if (state.cats.filter((c) => c.stage === 'adult').length < 2 && i < 2) {
            cat.stage = 'adult';
            cat.growthProgress = 100;
          }
        }
      }

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
   * Applies offline progression:
   * 1. Needs decay & sleep cycling simulated in 5-minute steps (capped at maxMinutes for performance).
   * 2. Passive Care Points: awards 1 CP/kitten, 2 CP/teen, 3 CP/adult ONLY for fully completed 10-minute intervals.
   * 3. Passive Stars: uncapped generation at 1 to 5 Stars/hour based on offlineStarLevel.
   */
  applyOfflineProgress(state: GameState, maxMinutes = 8 * 60): OfflineSummary {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - state.lastSavedAt);
    const totalMinutesAway = elapsedMs / 60000;
    const cappedMinutesAway = Math.min(totalMinutesAway, maxMinutes);

    // 1. Simulate needs & sleep state for cats
    const STEP = 5;
    for (let simulated = 0; simulated < cappedMinutesAway; simulated += STEP) {
      const step = Math.min(STEP, cappedMinutesAway - simulated);
      for (const cat of state.cats) {
        tickCatNeeds(cat, step, state.machines);

        if (cat.energy <= 15 && cat.animationState !== 'sleep') {
          cat.animationState = 'sleep';
        } else if (cat.animationState === 'sleep' && cat.energy >= 95) {
          cat.animationState = 'sit';
        }
      }
    }

    // 2. Care Points: award only for fully completed 10-minute intervals
    const completed10MinIntervals = Math.floor(totalMinutesAway / 10);
    let loveEarned = 0;
    for (const cat of state.cats) {
      const cpPer10Min = cat.stage === 'kitten' ? 1 : cat.stage === 'teen' ? 2 : 3;
      loveEarned += cpPer10Min * completed10MinIntervals;
    }

    state.love += loveEarned;
    state.totalLoveEarned += loveEarned;

    // 3. Passive Stars: uncapped generation based on offlineStarLevel (1..5 stars/hr)
    const starRatePerHour = Math.max(1, Math.min(5, state.offlineStarLevel || 1));
    const hoursAway = totalMinutesAway / 60;
    const starsEarned = Math.floor(hoursAway * starRatePerHour);
    if (starsEarned > 0) {
      state.adoptionTokens = (state.adoptionTokens || 0) + starsEarned;
    }

    // Generate cosmetic headline events
    const headlines: string[] = [];
    if (state.cats.length > 0 && totalMinutesAway > 5) {
      const sampleCats = [...state.cats].sort(() => Math.random() - 0.5).slice(0, 3);
      for (const cat of sampleCats) {
        const options = [
          `${cat.name} napped peacefully and soaked up cozy sanctuary vibes.`,
          `${cat.name} stretched in the warm sunbeams.`,
          `${cat.name} generated love and cared for fellow sanctuary companions.`,
          `${cat.name} watched butterflies drift by the garden.`,
        ];
        headlines.push(options[Math.floor(Math.random() * options.length)]);
      }
    }

    state.lastSavedAt = now;

    return {
      minutesAway: Math.round(totalMinutesAway),
      loveEarned,
      starsEarned,
      headlines,
    };
  }
}
