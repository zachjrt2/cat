import type { Cat, CatArea, GameState, RareCatType } from '../data/types';
import { generateCat, generateRareCat } from '../data/catFactory';

export type PlinkoTier = 'miss' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface PlinkoRewardInfo {
  tier: PlinkoTier;
  label: string;
  color: string;
  badgeBg: string;
  catsCount: number;
  catsWon: Cat[];
  isJackpot: boolean;
  message: string;
}

export interface PlinkoOdds {
  winChancePercent: number;
  missChancePercent: number;
  commonPercent: number;
  uncommonPercent: number;
  rarePercent: number;
  epicPercent: number;
  legendaryPercent: number;
  jackpotChancePercent: number;
  mutationChancePercent: number;
}

export interface PlinkoBoardRank {
  name: string;
  badge: string;
  color: string;
  bgGrad: string;
  perks: string;
  slots: PlinkoTier[];
}

export function getMutationChance(wager: number): number {
  const W = Math.max(1, Math.floor(wager));
  if (W >= 250) return 0.95;
  if (W >= 100) return 0.75;
  if (W >= 50) return 0.55;
  if (W >= 25) return 0.38;
  if (W >= 10) return 0.22;
  if (W >= 5) return 0.12;
  return 0.05;
}

export function getPlinkoBoardRank(wager: number): PlinkoBoardRank {
  const W = Math.max(1, Math.floor(wager));
  if (W >= 250) {
    return {
      name: 'Cosmic Mythic Board',
      badge: '🌌 MYTHIC 250+ ⭐',
      color: '#ec4899',
      bgGrad: 'linear-gradient(135deg, rgba(236, 72, 153, 0.18), rgba(168, 85, 247, 0.22))',
      perks: '✨ 95% Mutation Chance • 5x Legend Slots • 100% Epic/Legend Guarantee • Multi-Cat Drop (3–4 Cats)!',
      slots: ['epic', 'epic', 'legendary', 'legendary', 'legendary', 'legendary', 'legendary', 'epic', 'epic'],
    };
  }
  if (W >= 100) {
    return {
      name: 'Grand Master Board',
      badge: '👑 MASTER 100+ ⭐',
      color: '#a855f7',
      bgGrad: 'linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(99, 102, 241, 0.18))',
      perks: '✨ 75% Mutation Chance • Only Rare, Epic & Legend • 3x Legend Slots • 65% Multi-Cat Drop (2–3 Cats)',
      slots: ['rare', 'epic', 'epic', 'legendary', 'legendary', 'legendary', 'epic', 'epic', 'rare'],
    };
  }
  if (W >= 50) {
    return {
      name: 'Elite Diamond Board',
      badge: '💎 ELITE 50+ ⭐',
      color: '#0284c7',
      bgGrad: 'linear-gradient(135deg, rgba(2, 132, 199, 0.14), rgba(56, 189, 248, 0.18))',
      perks: '✨ 55% Mutation Chance • 0% Common • Triple Legend Slots • 40% Multi-Cat Drop (2–3 Cats)',
      slots: ['uncommon', 'rare', 'epic', 'legendary', 'legendary', 'legendary', 'epic', 'rare', 'uncommon'],
    };
  }
  if (W >= 25) {
    return {
      name: 'High Roller Gold Board',
      badge: '🏆 GOLD 25+ ⭐',
      color: '#b45309',
      bgGrad: 'linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(251, 191, 36, 0.18))',
      perks: '✨ 38% Mutation Chance • Legendary Center Slot • 25% Multi-Cat Drop (2–3 Cats)',
      slots: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'epic', 'rare', 'uncommon', 'common'],
    };
  }
  if (W >= 10) {
    return {
      name: 'Silver Board',
      badge: '🥈 SILVER 10+ ⭐',
      color: '#475569',
      bgGrad: 'linear-gradient(135deg, rgba(71, 85, 105, 0.1), rgba(148, 163, 184, 0.15))',
      perks: '✨ 22% Mutation Chance • 100% Win Guarantee (0% Miss) • Epic Slots Unlocked',
      slots: ['common', 'uncommon', 'rare', 'common', 'epic', 'common', 'rare', 'uncommon', 'common'],
    };
  }
  if (W >= 5) {
    return {
      name: 'Bronze Apprentice Board',
      badge: '🥉 BRONZE 5+ ⭐',
      color: '#92400e',
      bgGrad: 'linear-gradient(135deg, rgba(146, 64, 14, 0.1), rgba(217, 119, 6, 0.12))',
      perks: '✨ 12% Mutation Chance • Low Miss Risk (11%) • Rare Slots Unlocked',
      slots: ['miss', 'common', 'uncommon', 'rare', 'uncommon', 'common', 'uncommon', 'common', 'common'],
    };
  }
  if (W >= 3) {
    return {
      name: 'Novice Board (3–4 ⭐)',
      badge: '⭐ NOVICE 3+ ⭐',
      color: '#059669',
      bgGrad: 'linear-gradient(135deg, rgba(5, 150, 105, 0.08), rgba(52, 211, 153, 0.12))',
      perks: '67% Win Rate • Uncommon Slots Available',
      slots: ['miss', 'common', 'uncommon', 'common', 'uncommon', 'common', 'common', 'miss', 'miss'],
    };
  }
  if (W === 2) {
    return {
      name: 'Beginner Board (2 ⭐)',
      badge: '⭐ BEGINNER 2 ⭐',
      color: '#059669',
      bgGrad: 'linear-gradient(135deg, rgba(5, 150, 105, 0.08), rgba(52, 211, 153, 0.12))',
      perks: '55% Win Rate • Uncommon Slot Unlocked',
      slots: ['miss', 'miss', 'common', 'uncommon', 'common', 'common', 'common', 'miss', 'miss'],
    };
  }
  return {
    name: 'Starter Board (1 ⭐)',
    badge: '⭐ STARTER 1 ⭐',
    color: '#6b7280',
    bgGrad: 'linear-gradient(135deg, rgba(107, 114, 128, 0.08), rgba(156, 163, 175, 0.12))',
    perks: '33% Win Rate • 66% Miss Risk',
    slots: ['miss', 'miss', 'common', 'miss', 'common', 'miss', 'common', 'miss', 'miss'],
  };
}

export class PlinkoSystem {
  constructor(private state: GameState) {}

  /**
   * Checks if there is space in any unlocked area of the sanctuary.
   */
  hasRemainingSanctuarySpace(): boolean {
    let totalCap = 0;
    const totalCats = this.state.cats.length;
    for (const key of Object.keys(this.state.areas) as CatArea[]) {
      const a = this.state.areas[key];
      if (a?.unlocked) {
        totalCap += a.capacity;
      }
    }
    return totalCats < totalCap;
  }

  /**
   * Calculates dynamic odds for a given Star wager based on the upgraded board rank.
   */
  calculateOdds(wager: number): PlinkoOdds {
    const W = Math.max(1, Math.floor(wager));
    const rank = getPlinkoBoardRank(W);
    const tiers = rank.slots;

    const total = tiers.length;
    const missCount = tiers.filter((t) => t === 'miss').length;
    const commonCount = tiers.filter((t) => t === 'common').length;
    const uncommonCount = tiers.filter((t) => t === 'uncommon').length;
    const rareCount = tiers.filter((t) => t === 'rare').length;
    const epicCount = tiers.filter((t) => t === 'epic').length;
    const legendCount = tiers.filter((t) => t === 'legendary').length;

    let jackpotChance = 0;
    if (W >= 250) jackpotChance = 100;
    else if (W >= 100) jackpotChance = 65;
    else if (W >= 50) jackpotChance = 40;
    else if (W >= 25) jackpotChance = 25;
    else if (W >= 15) jackpotChance = 15;
    else if (W >= 10) jackpotChance = 8;
    else if (W >= 5) jackpotChance = 4;

    const mutChance = getMutationChance(W);

    return {
      winChancePercent: Math.round(((total - missCount) / total) * 100),
      missChancePercent: Math.round((missCount / total) * 100),
      commonPercent: Math.round((commonCount / total) * 100),
      uncommonPercent: Math.round((uncommonCount / total) * 100),
      rarePercent: Math.round((rareCount / total) * 100),
      epicPercent: Math.round((epicCount / total) * 100),
      legendaryPercent: Math.round((legendCount / total) * 100),
      jackpotChancePercent: Math.round(jackpotChance),
      mutationChancePercent: Math.round(mutChance * 100),
    };
  }

  /**
   * Rolls the Plinko outcome based on the wager amount.
   */
  rollOutcome(wager: number): { tier: PlinkoTier; catsCount: number; isJackpot: boolean } {
    const W = Math.max(1, Math.floor(wager));
    const odds = this.calculateOdds(W);

    const roll = Math.random() * 100;
    if (roll < odds.missChancePercent) {
      return { tier: 'miss', catsCount: 0, isJackpot: false };
    }

    // Determine winning tier
    const winRoll = Math.random() * (odds.commonPercent + odds.uncommonPercent + odds.rarePercent + odds.epicPercent + odds.legendaryPercent);
    let accum = 0;
    let tier: PlinkoTier = 'common';

    accum += odds.commonPercent;
    if (winRoll <= accum && odds.commonPercent > 0) {
      tier = 'common';
    } else {
      accum += odds.uncommonPercent;
      if (winRoll <= accum && odds.uncommonPercent > 0) {
        tier = 'uncommon';
      } else {
        accum += odds.rarePercent;
        if (winRoll <= accum && odds.rarePercent > 0) {
          tier = 'rare';
        } else {
          accum += odds.epicPercent;
          if (winRoll <= accum && odds.epicPercent > 0) {
            tier = 'epic';
          } else {
            tier = 'legendary';
          }
        }
      }
    }

    // Check for jackpot multi-cat grant
    let catsCount = 1;
    let isJackpot = false;
    if (Math.random() * 100 < odds.jackpotChancePercent) {
      isJackpot = true;
      if (W >= 250) {
        catsCount = Math.random() < 0.45 ? 4 : 3;
      } else if (W >= 100) {
        catsCount = Math.random() < 0.5 ? 3 : 2;
      } else if (W >= 50) {
        catsCount = Math.random() < 0.35 ? 3 : 2;
      } else if (W >= 25) {
        catsCount = Math.random() < 0.25 ? 3 : 2;
      } else {
        catsCount = 2;
      }
    }

    return { tier, catsCount, isJackpot };
  }

  /**
   * Generates cats according to the determined tier, assigning them to the preferred area
   * if there is space, or automatically to the first unlocked area with available capacity.
   */
  generateCatsForTier(tier: PlinkoTier, count: number, preferredArea: CatArea = 'yard', wager = 1): Cat[] {
    const generated: Cat[] = [];
    const usedNames = new Set(this.state.cats.map((c) => c.name));

    const mutationChance = getMutationChance(wager);

    // Track area occupancy including new additions in this drop
    const areaCounts: Record<string, number> = {};
    for (const key of ['yard', 'shelter', 'sunroom', 'cafe']) {
      areaCounts[key] = this.state.cats.filter((c) => c.area === key).length;
    }

    const findBestAvailableArea = (): CatArea => {
      // 1. Defaults to preferred area if unlocked and not full
      const prefState = this.state.areas[preferredArea];
      if (prefState?.unlocked && (areaCounts[preferredArea] || 0) < prefState.capacity) {
        areaCounts[preferredArea] = (areaCounts[preferredArea] || 0) + 1;
        return preferredArea;
      }

      // 2. Otherwise find the first unlocked area with open space
      const allAreas: CatArea[] = ['yard', 'shelter', 'sunroom', 'cafe'];
      for (const a of allAreas) {
        const aState = this.state.areas[a];
        if (aState?.unlocked && (areaCounts[a] || 0) < aState.capacity) {
          areaCounts[a] = (areaCounts[a] || 0) + 1;
          return a;
        }
      }

      // Fallback
      return preferredArea;
    };

    // Combine existing cats with newly generated cats in this batch for visual duplicate protection
    const allKnownCats = [...this.state.cats];

    for (let i = 0; i < count; i++) {
      let cat: Cat;
      const stageRoll = Math.random();
      const stage = stageRoll < 0.35 ? 'kitten' : stageRoll < 0.7 ? 'teen' : 'adult';

      switch (tier) {
        case 'legendary': {
          const legendRares: RareCatType[] = ['golden', 'ghost', 'royal'];
          const rareType = legendRares[Math.floor(Math.random() * legendRares.length)];
          cat = generateRareCat(rareType, { day: this.state.day, usedNames, existingCats: allKnownCats, mutationChance });
          break;
        }
        case 'epic': {
          const epicRares: RareCatType[] = ['gameboy', 'radioactive', 'hairless'];
          const rareType = epicRares[Math.floor(Math.random() * epicRares.length)];
          cat = generateRareCat(rareType, { day: this.state.day, usedNames, existingCats: allKnownCats, mutationChance });
          break;
        }
        case 'rare': {
          const rareTypes: RareCatType[] = ['seal_point', 'hairless', 'gameboy'];
          const rareType = rareTypes[Math.floor(Math.random() * rareTypes.length)];
          cat = generateRareCat(rareType, { day: this.state.day, usedNames, existingCats: allKnownCats, mutationChance });
          break;
        }
        case 'uncommon': {
          const uncommonCoats = ['yellow_0', 'pink_0', 'teal_0', 'indigo_0', 'red_0', 'red_1', 'white_grey_0', 'white_grey_1'];
          const skin = uncommonCoats[Math.floor(Math.random() * uncommonCoats.length)];
          cat = generateCat({ day: this.state.day, usedNames, existingCats: allKnownCats, skinId: skin, stage, mutationChance });
          break;
        }
        case 'common':
        default: {
          const commonCoats = ['orange_0', 'orange_1', 'orange_2', 'orange_3', 'grey_0', 'grey_1', 'grey_2', 'white_0', 'dark_0', 'peach_0'];
          const skin = commonCoats[Math.floor(Math.random() * commonCoats.length)];
          cat = generateCat({ day: this.state.day, usedNames, existingCats: allKnownCats, skinId: skin, stage, mutationChance });
          break;
        }
      }

      cat.area = findBestAvailableArea();
      usedNames.add(cat.name);
      allKnownCats.push(cat);
      generated.push(cat);
    }

    return generated;
  }
}
