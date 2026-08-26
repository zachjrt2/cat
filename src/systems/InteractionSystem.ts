import type { Cat, ToolType } from '../data/types';
import { LoveManager } from './LoveManager';
import { JournalSystem } from './JournalSystem';

const NEED_RESTORE_AMOUNT = 30;

export interface InteractionResult {
  loveEarned: number;
  message: string;
}

/**
 * Implements the GDD's "Interaction System": Food / Pet / Brush / Toy / Wash.
 * Each tool restores the associated need and grants Love.
 */
export class InteractionSystem {
  constructor(
    private love: LoveManager,
    private journal: JournalSystem,
  ) {}

  applyTool(cat: Cat, tool: ToolType): InteractionResult {
    switch (tool) {
      case 'food':
        cat.hunger = Math.min(100, cat.hunger + NEED_RESTORE_AMOUNT);
        break;
      case 'pet':
        cat.affection = Math.min(100, cat.affection + NEED_RESTORE_AMOUNT);
        break;
      case 'brush':
        cat.cleanliness = Math.min(100, cat.cleanliness + NEED_RESTORE_AMOUNT);
        break;
      case 'toy':
        cat.fun = Math.min(100, cat.fun + NEED_RESTORE_AMOUNT);
        if (cat.animationState !== 'sleep') cat.animationState = 'play';
        break;
      case 'wash':
        cat.cleanliness = Math.min(100, cat.cleanliness + NEED_RESTORE_AMOUNT * 1.5);
        break;
    }

    const loveEarned = this.love.rewardForInteraction(cat, tool);
    this.love.add(loveEarned);
    this.journal.recordInteraction(cat, tool);

    return { loveEarned, message: this.messageFor(cat, tool) };
  }

  private messageFor(cat: Cat, tool: ToolType): string {
    switch (tool) {
      case 'food':
        return `${cat.name} enjoyed a meal.`;
      case 'pet':
        return `${cat.name} purrs happily.`;
      case 'brush':
        return `${cat.name} looks tidy now.`;
      case 'toy':
        return `${cat.name} is playing!`;
      case 'wash':
        return `${cat.name} is squeaky clean.`;
    }
  }
}
