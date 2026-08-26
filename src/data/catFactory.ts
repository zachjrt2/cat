import type { Cat, CatJournal } from './types';
import { CAT_SKINS, CAT_MARKINGS, CAT_NAMES, FAVORITE_FOODS, FAVORITE_TOYS } from './catAssets';
import { pickTwoDistinctTraits } from './traits';

function randomFrom<T>(arr: readonly T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

function makeId(): string {
  return `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyJournal(day: number): CatJournal {
  return {
    adoptedDay: day,
    favoriteFoodDiscoveredDay: null,
    bestFriendId: null,
    longestNapSeconds: 0,
    totalPetsReceived: 0,
    totalTimesFed: 0,
    totalTimesWashed: 0,
    totalTimesBrushed: 0,
    entries: [{ day, timestamp: Date.now(), message: 'Arrived warmly at the sanctuary.' }],
  };
}

export interface GenerateCatOptions {
  day: number;
  usedNames?: Set<string>;
  forceRare?: boolean;
  rng?: () => number;
}

export function generateCat(options: GenerateCatOptions): Cat {
  const { day, usedNames, forceRare = false, rng = Math.random } = options;

  // 10% chance of rolling a rare cat naturally, or guaranteed if forceRare
  const isRareRoll = forceRare || rng() < 0.12;
  const pool = isRareRoll
    ? CAT_SKINS.filter((s) => s.isRare)
    : CAT_SKINS.filter((s) => !s.isRare);

  const skin = randomFrom(pool, rng);
  const isRare = !!skin.isRare;
  const rareType = skin.rareType ?? null;

  // Markings: Hairless and GameBoy don't need markings by default, others can roll markings
  let markingDef = CAT_MARKINGS[0]; // none
  if (!skin.id.startsWith('hairless') && !skin.id.startsWith('game_boy')) {
    // 50% chance of having a cute marking overlay
    if (rng() < 0.55) {
      const activeMarkings = CAT_MARKINGS.filter((m) => m.id !== 'none');
      markingDef = randomFrom(activeMarkings, rng);
    }
  }

  const [majorTrait, minorTrait] = pickTwoDistinctTraits(rng);

  let name = randomFrom(CAT_NAMES, rng);
  if (usedNames) {
    let attempts = 0;
    while (usedNames.has(name) && attempts < 30) {
      name = randomFrom(CAT_NAMES, rng);
      attempts += 1;
    }
    usedNames.add(name);
  }

  const cat: Cat = {
    id: makeId(),
    name,
    color: skin.id,
    pattern: markingDef.id,
    marking: markingDef.file || undefined,
    isRare,
    rareType,

    stage: 'kitten',
    growthProgress: 0,

    majorTrait,
    minorTrait,

    hunger: 80 + Math.floor(rng() * 20),
    cleanliness: 80 + Math.floor(rng() * 20),
    affection: 70 + Math.floor(rng() * 20),
    fun: 70 + Math.floor(rng() * 20),
    energy: 60 + Math.floor(rng() * 40),

    happiness: 80,

    friendshipIds: {},
    favoriteToy: randomFrom(FAVORITE_TOYS, rng),
    favoriteFood: randomFrom(FAVORITE_FOODS, rng),

    area: 'yard',
    adoptedAt: Date.now(),
    ageDays: 0,

    journal: emptyJournal(day),

    animationState: 'sit',
  };

  return cat;
}

export function generateRareCat(rareType: import('./types').RareCatType, options: { day: number; usedNames?: Set<string> }): Cat {
  const { day, usedNames } = options;
  const rareSkin = CAT_SKINS.find((s) => s.rareType === rareType) || CAT_SKINS.find((s) => s.isRare)!;

  const [majorTrait, minorTrait] = pickTwoDistinctTraits();
  let name = rareSkin.label.split(' ')[0];
  if (usedNames) {
    if (usedNames.has(name)) {
      name = `${name} II`;
    }
    usedNames.add(name);
  }

  return {
    id: makeId(),
    name,
    color: rareSkin.id,
    pattern: 'none',
    isRare: true,
    rareType,
    stage: 'adult',
    growthProgress: 100,
    majorTrait,
    minorTrait,
    hunger: 95,
    cleanliness: 95,
    affection: 95,
    fun: 95,
    energy: 95,
    happiness: 95,
    friendshipIds: {},
    favoriteToy: randomFrom(FAVORITE_TOYS),
    favoriteFood: randomFrom(FAVORITE_FOODS),
    area: 'yard',
    adoptedAt: Date.now(),
    ageDays: 0,
    journal: emptyJournal(day),
    animationState: 'sit',
  };
}
