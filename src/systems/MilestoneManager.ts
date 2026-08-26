import type { GameState, Milestone } from '../data/types';
import { MILESTONES_DEF } from '../data/constants';
import { EventBus } from '../ui/EventBus';
import { sound } from './SoundManager';

export class MilestoneManager {
  constructor(private state: GameState) {}

  get tokens(): number {
    return this.state.adoptionTokens;
  }

  addTokens(amount: number): void {
    this.state.adoptionTokens += amount;
    EventBus.emit('tokens-changed', { tokens: this.state.adoptionTokens });
  }

  spendTokens(amount: number): boolean {
    if (this.state.adoptionTokens < amount) return false;
    this.state.adoptionTokens -= amount;
    EventBus.emit('tokens-changed', { tokens: this.state.adoptionTokens });
    return true;
  }

  getMilestones(): Milestone[] {
    const totalCats = this.state.cats.length;
    const totalPets = this.state.totalPetsGiven;
    const totalLove = Math.floor(this.state.totalLoveEarned);

    // Count best friend relationships (cats that have a bestFriendId)
    const bestFriendsCount = this.state.cats.filter((c) => !!c.journal.bestFriendId).length;

    return MILESTONES_DEF.map((def) => {
      let current = 0;
      switch (def.type) {
        case 'cats':
          current = totalCats;
          break;
        case 'pets':
          current = totalPets;
          break;
        case 'friends':
          current = bestFriendsCount;
          break;
        case 'love':
          current = totalLove;
          break;
      }

      const claimed = this.state.milestoneClaimedIds.includes(def.id);

      return {
        id: def.id,
        title: def.title,
        description: def.description,
        target: def.target,
        current: Math.min(current, def.target),
        rewardTokens: def.rewardTokens,
        claimed,
      };
    });
  }

  hasUnclaimedMilestones(): boolean {
    return this.getMilestones().some((m) => m.current >= m.target && !m.claimed);
  }

  claim(milestoneId: string): boolean {
    const milestones = this.getMilestones();
    const target = milestones.find((m) => m.id === milestoneId);
    if (!target) return false;

    if (target.current < target.target || target.claimed) {
      return false;
    }

    this.state.milestoneClaimedIds.push(milestoneId);
    this.addTokens(target.rewardTokens);
    sound.playAdoptFanfare();

    EventBus.emit('toast', {
      message: `⭐ Claimed "${target.title}"! (+${target.rewardTokens} Adoption Token${target.rewardTokens === 1 ? '' : 's'})`,
    });

    return true;
  }
}
