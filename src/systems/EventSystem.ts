import type { Cat, GameState } from '../data/types';
import { LoveManager } from './LoveManager';
import { JournalSystem } from './JournalSystem';
import { RelationshipSystem } from './RelationshipSystem';

export interface SanctuaryEvent {
  catId: string;
  catName: string;
  message: string;
}

/**
 * Rolls for the "Dynamic Events" described in the GDD: Found Feather, Stole
 * Toy, Shared Nap, Zoomies, Sunbeam Nap. Kept intentionally rare and low
 * stakes; every outcome is positive (Pillar 1: No punishment).
 */
export class EventSystem {
  constructor(
    private state: GameState,
    private love: LoveManager,
    private journal: JournalSystem,
    private relationships: RelationshipSystem,
  ) {}

  /** Call roughly once per game second; internally throttled by chance. */
  tick(deltaSeconds: number): SanctuaryEvent[] {
    const events: SanctuaryEvent[] = [];
    for (const cat of this.state.cats) {
      const chance = this.eventChancePerSecond(cat) * deltaSeconds;
      if (Math.random() < chance) {
        const event = this.rollEvent(cat);
        if (event) events.push(event);
      }
    }
    return events;
  }

  private eventChancePerSecond(cat: Cat): number {
    const isHunter = cat.majorTrait === 'hunter' || cat.minorTrait === 'hunter';
    const isMischievous = cat.majorTrait === 'mischievous' || cat.minorTrait === 'mischievous';
    const isZoomie = cat.majorTrait === 'zoomie' || cat.minorTrait === 'zoomie';
    let base = 0.0015; // ~ once every ~11 minutes baseline
    if (isHunter) base *= 3;
    if (isMischievous) base *= 2;
    if (isZoomie) base *= 2;
    if (cat.animationState === 'sleep') base *= 0.1;
    return base;
  }

  private rollEvent(cat: Cat): SanctuaryEvent | null {
    const isHunter = cat.majorTrait === 'hunter' || cat.minorTrait === 'hunter';
    const isZoomie = cat.majorTrait === 'zoomie' || cat.minorTrait === 'zoomie';
    const isMischievous = cat.majorTrait === 'mischievous' || cat.minorTrait === 'mischievous';

    const roll = Math.random();
    let message: string;

    if (isHunter && roll < 0.3) {
      this.love.add(10);
      message = `${cat.name} found a feather! (+10 Love)`;
    } else if (isMischievous && roll < 0.5) {
      cat.fun = Math.min(100, cat.fun + 15);
      message = `${cat.name} stole a toy and is having a blast. (+Fun)`;
    } else if (isZoomie && roll < 0.7) {
      const nearby = this.relationships.findCatsInSameArea(cat);
      for (const other of nearby) other.fun = Math.min(100, other.fun + 8);
      message = `${cat.name} got the zoomies! Nearby cats gained Fun.`;
    } else {
      const nearby = this.relationships.findCatsInSameArea(cat);
      const friend = nearby[Math.floor(Math.random() * nearby.length)];
      if (friend) {
        this.relationships.nap(cat, friend);
        message = `${cat.name} and ${friend.name} shared a nap together.`;
      } else {
        cat.happiness = Math.min(100, cat.happiness + 5);
        message = `${cat.name} found a warm sunbeam to nap in.`;
      }
    }

    this.journal.log(cat, message);
    return { catId: cat.id, catName: cat.name, message };
  }
}
