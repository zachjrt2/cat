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
   * Adds growth experience to a cat (from care interactions or time).
   */
  addGrowth(cat: Cat, amount: number): EvolutionEvent | null {
    if (cat.stage === 'adult') return null;

    cat.growthProgress += amount;

    if (cat.growthProgress >= 100) {
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
    }

    return null;
  }

  /**
   * Passive tick for cats in sanctuary (happy cats grow gently with time).
   */
  tickGrowth(cats: Cat[], deltaMinutes: number): EvolutionEvent[] {
    const events: EvolutionEvent[] = [];
    for (const cat of cats) {
      if (cat.stage === 'adult') continue;

      // Happy, well-fed cats grow steadily
      const happinessFactor = (cat.happiness / 100);
      const growthRate = 0.35 * happinessFactor * deltaMinutes; // ~5-6 minutes of happy gameplay to transition stage
      const evo = this.addGrowth(cat, growthRate);
      if (evo) events.push(evo);
    }
    return events;
  }
}
