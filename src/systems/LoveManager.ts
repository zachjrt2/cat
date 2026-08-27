import type { Cat, GameState, ToolType } from '../data/types';
import { LOVE_CONFIG, ADOPTION_BASE_COST } from '../data/constants';

export class LoveManager {
  constructor(private state: GameState) {}

  get love(): number {
    return this.state.love;
  }

  add(amount: number): void {
    this.state.love = Math.max(0, this.state.love + amount);
  }

  canAfford(cost: number): boolean {
    return this.state.love >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.state.love -= cost;
    return true;
  }

  /** Cost of the next adoption, scaling gently with sanctuary size. */
  nextAdoptionCost(): number {
    const n = this.state.cats.length;
    return Math.round(ADOPTION_BASE_COST * (1 + n * 0.08));
  }

  /** Love reward for a direct interaction (feed/pet/brush/toy/wash). */
  rewardForInteraction(cat: Cat, tool: ToolType): number {
    let base = LOVE_CONFIG.baseLovePerInteraction;
    const isDiva = cat.majorTrait === 'diva' || cat.minorTrait === 'diva';
    if (isDiva && tool === 'pet') base *= LOVE_CONFIG.divaMultiplier;

    // Mutation perks
    if (cat.mutation === 'giant') base *= 1.5;
    if (cat.mutation === 'gilded') base *= 2.0;

    return Math.round(base);
  }

  /** Passive Love generated this tick from sleeping cats and relationships. */
  tickPassiveLove(deltaMinutes: number): number {
    let generated = 0;
    for (const cat of this.state.cats) {
      if (cat.animationState === 'sleep') {
        const isLazy = cat.majorTrait === 'lazy' || cat.minorTrait === 'lazy';
        const rate = LOVE_CONFIG.sleepingCatLovePerMin * (isLazy ? LOVE_CONFIG.lazySleepingBonusMultiplier : 1);
        generated += rate * deltaMinutes;
      }
      const bestFriendship = Math.max(0, ...Object.values(cat.friendshipIds), 0);
      if (bestFriendship > 60) {
        generated += LOVE_CONFIG.happyRelationshipLovePerMin * deltaMinutes;
      }
    }
    this.add(generated);
    return generated;
  }
}
