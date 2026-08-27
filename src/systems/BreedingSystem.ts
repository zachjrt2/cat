import type { Cat, GameState } from '../data/types';
import { generateCat } from '../data/catFactory';
import { sound } from './SoundManager';
import { EventBus } from '../ui/EventBus';

export const BREED_COOLDOWN_MS = 60_000; // 1 minute (60 seconds) cooldown per pair

export interface BreedingResult {
  starsAwarded: number;
  parentA: Cat;
  parentB: Cat;
  message: string;
}

export interface StrayArrivalResult {
  cat: Cat;
  message: string;
}

export class BreedingSystem {
  constructor(private state: GameState) {}

  pairKey(a: Cat, b: Cat): string {
    return [a.id, b.id].sort().join(':');
  }

  getPairCooldownProgress(parentA: Cat, parentB: Cat): { remainingMs: number; ratio: number; isReady: boolean; reason?: string } {
    if (parentA.id === parentB.id) {
      return { remainingMs: 0, ratio: 0, isReady: false, reason: 'Cannot pair a cat with itself.' };
    }
    if (parentA.stage !== 'adult' || parentB.stage !== 'adult') {
      return { remainingMs: 0, ratio: 0, isReady: false, reason: 'Both cats must be fully grown adults.' };
    }
    if (parentA.area !== parentB.area) {
      return { remainingMs: 0, ratio: 0, isReady: false, reason: 'Both cats must be in the same sanctuary area.' };
    }

    const key = this.pairKey(parentA, parentB);
    const lastBredAt = this.state.breedingCooldowns[key];
    if (lastBredAt === undefined) {
      return { remainingMs: 0, ratio: 1.0, isReady: true };
    }

    const elapsed = Date.now() - lastBredAt;
    if (elapsed >= BREED_COOLDOWN_MS) {
      return { remainingMs: 0, ratio: 1.0, isReady: true };
    }

    const remainingMs = BREED_COOLDOWN_MS - elapsed;
    const ratio = Math.max(0, Math.min(1, elapsed / BREED_COOLDOWN_MS));
    const secsLeft = Math.ceil(remainingMs / 1000);
    return { remainingMs, ratio, isReady: false, reason: `Pair is resting (${secsLeft}s left)` };
  }

  canBreed(parentA: Cat, parentB: Cat): { eligible: boolean; reason?: string } {
    const progress = this.getPairCooldownProgress(parentA, parentB);
    if (!progress.isReady) {
      return { eligible: false, reason: progress.reason || 'This breeding pair is on cooldown.' };
    }
    return { eligible: true };
  }

  breed(parentA: Cat, parentB: Cat): BreedingResult | null {
    const check = this.canBreed(parentA, parentB);
    if (!check.eligible) {
      EventBus.emit('toast', { message: check.reason || 'Cannot breed this pair.' });
      return null;
    }

    // Award Stars directly instead of spawning kittens
    const starsAwarded = 1;
    this.state.adoptionTokens = (this.state.adoptionTokens || 0) + starsAwarded;
    EventBus.emit('tokens-changed', { tokens: this.state.adoptionTokens });

    const key = this.pairKey(parentA, parentB);
    this.state.breedingCooldowns[key] = Date.now();

    sound.playAdoptFanfare();
    const message = `✨ ${parentA.name} & ${parentB.name} bonded deeply! (+${starsAwarded} Star ⭐ for Plinko)`;
    EventBus.emit('toast', { message });

    return {
      starsAwarded,
      parentA,
      parentB,
      message,
    };
  }

  /**
   * Safety net check: if cat count drops below 2, a friendly stray adult cat arrives
   * after 1 hour (or when the timer expires) to guarantee breeding is always possible.
   */
  tickStraySafetyNet(): StrayArrivalResult | null {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const now = Date.now();

    if (this.state.cats.length < 2) {
      if (!this.state.strayArrivalDueAt) {
        this.state.strayArrivalDueAt = now + ONE_HOUR_MS;
      } else if (now >= this.state.strayArrivalDueAt) {
        // Stray arrives!
        const usedNames = new Set(this.state.cats.map((c) => c.name));
        const stray = generateCat({
          day: this.state.day,
          usedNames,
          stage: 'adult',
        });
        stray.area = 'yard';
        stray.journal.entries.push({
          day: this.state.day,
          timestamp: now,
          message: 'Found the cozy sanctuary doorstep looking for a warm home and companions.',
        });

        this.state.cats.push(stray);
        this.state.strayArrivalDueAt = null;

        sound.playAdoptFanfare();
        const message = `🐾 A sweet stray adult cat (${stray.name}) arrived at the sanctuary doorstep!`;
        EventBus.emit('toast', { message });

        return { cat: stray, message };
      }
    } else {
      this.state.strayArrivalDueAt = null;
    }

    return null;
  }

  getStrayCountdownSeconds(): number | null {
    if (!this.state.strayArrivalDueAt || this.state.cats.length >= 2) return null;
    const remainingMs = Math.max(0, this.state.strayArrivalDueAt - Date.now());
    return Math.ceil(remainingMs / 1000);
  }
}
