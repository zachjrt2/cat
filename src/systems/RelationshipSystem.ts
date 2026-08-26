import type { Cat, GameState } from '../data/types';

function clamp(v: number, min = -100, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

export class RelationshipSystem {
  constructor(private state: GameState) {}

  private adjust(a: Cat, b: Cat, delta: number): void {
    a.friendshipIds[b.id] = clamp((a.friendshipIds[b.id] ?? 0) + delta);
    b.friendshipIds[a.id] = clamp((b.friendshipIds[a.id] ?? 0) + delta);
  }

  /** Two cats sleeping in the same area for a while. */
  nap(a: Cat, b: Cat): void {
    const cuddlerBonus =
      (a.majorTrait === 'cuddler' || a.minorTrait === 'cuddler' ? 1.5 : 1) *
      (b.majorTrait === 'cuddler' || b.minorTrait === 'cuddler' ? 1.5 : 1);
    this.adjust(a, b, 1.5 * cuddlerBonus);
  }

  /** Two cats playing/toy-interacting together. */
  play(a: Cat, b: Cat): void {
    this.adjust(a, b, 2);
  }

  /** Two cats eating at the same time. */
  eat(a: Cat, b: Cat): void {
    this.adjust(a, b, 1);
  }

  /** Social trait cats build relationships faster in crowds. */
  socialBoost(a: Cat, b: Cat): void {
    const socialMultiplier =
      (a.majorTrait === 'social' || a.minorTrait === 'social' ? 1.5 : 1) *
      (b.majorTrait === 'social' || b.minorTrait === 'social' ? 1.5 : 1);
    this.adjust(a, b, 0.5 * socialMultiplier);
  }

  bestFriendOf(cat: Cat): { id: string; value: number } | null {
    let best: { id: string; value: number } | null = null;
    for (const [id, value] of Object.entries(cat.friendshipIds)) {
      if (value > 40 && (!best || value > best.value)) best = { id, value };
    }
    return best;
  }

  rivalsOf(cat: Cat): string[] {
    return Object.entries(cat.friendshipIds)
      .filter(([, v]) => v < -40)
      .map(([id]) => id);
  }

  updateAllBestFriends(): void {
    for (const cat of this.state.cats) {
      const best = this.bestFriendOf(cat);
      cat.journal.bestFriendId = best?.id ?? null;
    }
  }

  findCatsInSameArea(cat: Cat): Cat[] {
    return this.state.cats.filter((c) => c.id !== cat.id && c.area === cat.area);
  }
}
