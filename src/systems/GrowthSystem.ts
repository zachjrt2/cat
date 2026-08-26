import type { Cat, LifeStage } from '../data/types';
import { sound } from './SoundManager';
import { EventBus } from '../ui/EventBus';

export interface EvolutionEvent {
  cat: Cat;
  prevStage: LifeStage;
  newStage: LifeStage;
  message: string;
}

export class GrowthSystem {
  /**
   * Adds growth experience to a cat (from direct care interactions).
   * Amount is small so spam-clicking can't rush growth.
   */
  addGrowth(cat: Cat, amount: number): EvolutionEvent | null {
    if (cat.stage === 'adult') return null;

    // Scale down interaction-based growth so it's a nudge, not the main driver
    cat.growthProgress += amount * 0.15;

    return this.checkEvolution(cat);
  }

  /**
   * Passive tick — happy, well-cared-for cats grow gently over time.
   * Growth is intentionally slow (~20-35 real minutes per stage) to stay casual.
   * Growth slows when happiness is low (needs neglected) and pauses below 30%.
   */
  tickGrowth(cats: Cat[], deltaMinutes: number): EvolutionEvent[] {
    const events: EvolutionEvent[] = [];
    for (const cat of cats) {
      if (cat.stage === 'adult') continue;

      // Growth pauses if cat is unhappy (needs neglected)
      if (cat.happiness < 30) continue;

      // Soft curve: full rate at happiness 100, half rate at happiness 50, none at 30
      const happinessFactor = Math.max(0, (cat.happiness - 30) / 70);

      // Base rate: ~0.08/min × happiness factor
      // At happiness 100 → 0.08/min → ~21 min to fill 100 (kitten→teen)
      // At happiness 65  → 0.04/min → ~42 min
      // At happiness 30  → 0.00/min → paused
      const growthRate = 0.08 * happinessFactor * deltaMinutes;

      cat.growthProgress = Math.min(99.9, cat.growthProgress + growthRate);

      const evo = this.checkEvolution(cat);
      if (evo) events.push(evo);
    }
    return events;
  }

  private checkEvolution(cat: Cat): EvolutionEvent | null {
    if (cat.growthProgress < 100) return null;

    if (cat.stage === 'kitten') {
      cat.stage = 'teen';
      cat.growthProgress = 0;
      const msg = `🎉 ${cat.name} has grown into an energetic Teen cat!`;
      cat.journal.entries.push({
        day: cat.journal.adoptedDay,
        timestamp: Date.now(),
        message: 'Celebrated birthday and grew into a playful Teen cat!',
      });
      sound.playAdoptFanfare();
      EventBus.emit('toast', { message: msg });
      return { cat, prevStage: 'kitten', newStage: 'teen', message: msg };
    } else if (cat.stage === 'teen') {
      cat.stage = 'adult';
      cat.growthProgress = 100;
      const msg = `👑 ${cat.name} has blossomed into a magnificent Adult cat!`;
      cat.journal.entries.push({
        day: cat.journal.adoptedDay,
        timestamp: Date.now(),
        message: 'Reached full maturity as a proud, beautiful Adult cat!',
      });
      sound.playAdoptFanfare();
      EventBus.emit('toast', { message: msg });
      return { cat, prevStage: 'teen', newStage: 'adult', message: msg };
    }

    return null;
  }
}

