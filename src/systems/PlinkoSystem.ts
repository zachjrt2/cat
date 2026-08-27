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
   * Calculates dynamic odds for a given Star wager.
   * Bet of 1 star = 33% win chance (Common), 67% miss.
   * Bet of 10 stars = ~95% win chance (majority Common, some Uncommon, rare chance for Rare).
   * Scales linearly with no maximum bet limit.
   */
  calculateOdds(wager: number): PlinkoOdds {
    const W = Math.max(1, Math.floor(wager));
    let tiers: PlinkoTier[];
    if (W <= 1) {
      // 1 Star: 66% Miss (6 slots), 33% Common (3 slots)
      tiers = ['miss', 'miss', 'common', 'miss', 'common', 'miss', 'common', 'miss', 'miss'];
    } else if (W <= 2) {
      tiers = ['miss', 'miss', 'common', 'uncommon', 'common', 'common', 'common', 'miss', 'miss'];
    } else if (W <= 4) {
      tiers = ['miss', 'common', 'uncommon', 'common', 'uncommon', 'common', 'common', 'miss', 'miss'];
    } else if (W <= 9) {
      tiers = ['miss', 'common', 'uncommon', 'rare', 'uncommon', 'common', 'uncommon', 'common', 'common'];
    } else if (W <= 24) {
      tiers = ['common', 'uncommon', 'rare', 'common', 'epic', 'common', 'rare', 'uncommon', 'common'];
    } else {
      tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    }

    const total = tiers.length;
    const missCount = tiers.filter((t) => t === 'miss').length;
    const commonCount = tiers.filter((t) => t === 'common').length;
    const uncommonCount = tiers.filter((t) => t === 'uncommon').length;
    const rareCount = tiers.filter((t) => t === 'rare').length;
    const epicCount = tiers.filter((t) => t === 'epic').length;
    const legendCount = tiers.filter((t) => t === 'legendary').length;

    let jackpotChance = 0;
    if (W >= 15) jackpotChance = Math.min(30, 8 + (W - 15) * 0.8);
    else if (W >= 10) jackpotChance = 8;
    else if (W >= 5) jackpotChance = 4;

    return {
      winChancePercent: Math.round(((total - missCount) / total) * 100),
      missChancePercent: Math.round((missCount / total) * 100),
      commonPercent: Math.round((commonCount / total) * 100),
      uncommonPercent: Math.round((uncommonCount / total) * 100),
      rarePercent: Math.round((rareCount / total) * 100),
      epicPercent: Math.round((epicCount / total) * 100),
      legendaryPercent: Math.round((legendCount / total) * 100),
      jackpotChancePercent: Math.round(jackpotChance),
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
    if (winRoll <= accum) {
      tier = 'common';
    } else {
      accum += odds.uncommonPercent;
      if (winRoll <= accum) {
        tier = 'uncommon';
      } else {
        accum += odds.rarePercent;
        if (winRoll <= accum) {
          tier = 'rare';
        } else {
          accum += odds.epicPercent;
          if (winRoll <= accum) {
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
      if (W >= 25 && Math.random() < 0.25) {
        catsCount = 3;
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
  generateCatsForTier(tier: PlinkoTier, count: number, preferredArea: CatArea = 'yard'): Cat[] {
    const generated: Cat[] = [];
    const usedNames = new Set(this.state.cats.map((c) => c.name));

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
          cat = generateRareCat(rareType, { day: this.state.day, usedNames, existingCats: allKnownCats });
          break;
        }
        case 'epic': {
          const epicRares: RareCatType[] = ['gameboy', 'radioactive', 'hairless'];
          const rareType = epicRares[Math.floor(Math.random() * epicRares.length)];
          cat = generateRareCat(rareType, { day: this.state.day, usedNames, existingCats: allKnownCats });
          break;
        }
        case 'rare': {
          const rareTypes: RareCatType[] = ['seal_point', 'hairless', 'gameboy'];
          const rareType = rareTypes[Math.floor(Math.random() * rareTypes.length)];
          cat = generateRareCat(rareType, { day: this.state.day, usedNames, existingCats: allKnownCats });
          break;
        }
        case 'uncommon': {
          const uncommonCoats = ['yellow_0', 'pink_0', 'teal_0', 'indigo_0', 'red_0', 'red_1', 'white_grey_0', 'white_grey_1'];
          const skin = uncommonCoats[Math.floor(Math.random() * uncommonCoats.length)];
          cat = generateCat({ day: this.state.day, usedNames, existingCats: allKnownCats, skinId: skin, stage });
          break;
        }
        case 'common':
        default: {
          const commonCoats = ['orange_0', 'orange_1', 'orange_2', 'orange_3', 'grey_0', 'grey_1', 'grey_2', 'white_0', 'dark_0', 'peach_0'];
          const skin = commonCoats[Math.floor(Math.random() * commonCoats.length)];
          cat = generateCat({ day: this.state.day, usedNames, existingCats: allKnownCats, skinId: skin, stage });
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
