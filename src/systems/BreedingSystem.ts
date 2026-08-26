import type { Cat, GameState } from '../data/types';
import { breedCats, generateCat } from '../data/catFactory';
import { sound } from './SoundManager';
import { EventBus } from '../ui/EventBus';

export interface BreedingResult {
  kitten: Cat;
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

  private pairKey(a: Cat, b: Cat): string {
    return [a.id, b.id].sort().join(':');
  }

  canBreed(parentA: Cat, parentB: Cat): { eligible: boolean; reason?: string } {
    if (parentA.id === parentB.id) {
      return { eligible: false, reason: 'Cannot pair a cat with itself.' };
    }

    if (parentA.stage !== 'adult' || parentB.stage !== 'adult') {
      return { eligible: false, reason: 'Both cats must be fully grown adults to breed.' };
    }

    if (parentA.area !== parentB.area) {
      return { eligible: false, reason: 'Both cats must be residing in the same sanctuary area.' };
    }

    const areaState = this.state.areas[parentA.area];
    const catsInArea = this.state.cats.filter((c) => c.area === parentA.area).length;
    if (areaState && catsInArea >= areaState.capacity) {
      return { eligible: false, reason: 'This sanctuary area is currently at maximum capacity!' };
    }

    const key = this.pairKey(parentA, parentB);
    const lastBred = this.state.breedingCooldowns[key];
    if (lastBred !== undefined && lastBred === this.state.day) {
      return { eligible: false, reason: 'This pair has already had a kitten today. Try again tomorrow!' };
    }

    return { eligible: true };
  }


  breed(parentA: Cat, parentB: Cat): BreedingResult | null {
    const check = this.canBreed(parentA, parentB);
    if (!check.eligible) {
      EventBus.emit('toast', { message: check.reason || 'Cannot breed this pair.' });
      return null;
    }

    const usedNames = new Set(this.state.cats.map((c) => c.name));
    const kitten = breedCats(parentA, parentB, this.state.day, usedNames);

    this.state.cats.push(kitten);
    const key = this.pairKey(parentA, parentB);
    this.state.breedingCooldowns[key] = this.state.day;

    sound.playAdoptFanfare();
    const rarityLabel = kitten.isRare ? '✨ Rare ' : '';
    const message = `🎉 ${parentA.name} & ${parentB.name} welcomed a sweet new ${rarityLabel}kitten: ${kitten.name}!`;
    EventBus.emit('toast', { message });

    return {
      kitten,
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
