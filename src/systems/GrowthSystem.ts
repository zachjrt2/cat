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
   * Calculates the sanctuary-wide average care percentage and the corresponding growth speed multiplier.
   * At 10% average care -> 1.0x baseline speed.
   * At 100% average care -> 10.0x maximum speed.
   * Never drops below 1.0x.
   */
  calculateGrowthMultiplier(cats: Cat[]): { avgCare: number; multiplier: number } {
    if (cats.length === 0) return { avgCare: 100, multiplier: 10.0 };

    const totalCare = cats.reduce((sum, c) => {
      const catCare = (c.hunger + c.cleanliness + c.affection + c.fun) / 4;
      return sum + catCare;
    }, 0);

    const avgCare = totalCare / cats.length;
    // Linear scaling: 10% -> 1.0x, 100% -> 10.0x, min 1.0x
    const multiplier = Math.max(1.0, avgCare / 10);

    return { avgCare, multiplier };
  }

  /**
   * Passive tick — happy, well-cared-for cats grow gently over time.
   * Growth speed scales dynamically based on the average care percentage across all owned cats (1x to 10x).
   * Growth pauses if individual cat's happiness is below 30%.
   */
  tickGrowth(cats: Cat[], deltaMinutes: number): EvolutionEvent[] {
    const { multiplier } = this.calculateGrowthMultiplier(cats);
    const events: EvolutionEvent[] = [];

    for (const cat of cats) {
      if (cat.stage === 'adult') continue;

      // Growth pauses if cat is unhappy (needs neglected)
      if (cat.happiness < 30) continue;

      // Soft curve: full rate at happiness 100, half rate at happiness 50, none at 30
      const happinessFactor = Math.max(0, (cat.happiness - 30) / 70);

      // Base rate scaled by the sanctuary-wide care multiplier (1x to 10x)
      const baseRate = 0.08 * happinessFactor * deltaMinutes;
      const growthRate = baseRate * multiplier;

      cat.growthProgress = Math.min(99.9, cat.growthProgress + growthRate);

      const evo = this.checkEvolution(cat);
      if (evo) events.push(evo);
    }
    return events;
  }

  /**
   * Instantly advances a cat to its next life stage (Kitten -> Teen, Teen -> Adult).
   */
  instantGrow(cat: Cat): EvolutionEvent | null {
    if (cat.stage === 'adult') return null;
    cat.growthProgress = 100;
    return this.checkEvolution(cat);
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

