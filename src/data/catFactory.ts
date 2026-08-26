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
  stage?: import('./types').LifeStage;
  rng?: () => number;
}

export function generateCat(options: GenerateCatOptions): Cat {
  const { day, usedNames, forceRare = false, stage = 'kitten', rng = Math.random } = options;

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

    stage,
    growthProgress: stage === 'adult' ? 100 : 0,

    majorTrait,
    minorTrait,

    hunger: 80 + Math.floor(rng() * 20),
    cleanliness: 80 + Math.floor(rng() * 20),
    affection: 70 + Math.floor(rng() * 20),
    fun: 70 + Math.floor(rng() * 20),
    energy: 60 + Math.floor(rng() * 40),

    happiness: 85,

    friendshipIds: {},
    favoriteToy: randomFrom(FAVORITE_TOYS, rng),
    favoriteFood: randomFrom(FAVORITE_FOODS, rng),

    area: 'yard',
    adoptedAt: Date.now(),
    ageDays: stage === 'adult' ? 2 : 0,

    journal: emptyJournal(day),

    animationState: 'sit',
  };

  return cat;
}

/**
 * Breeds two adult cats to create a kitten with inherited coat, markings,
 * personality traits, and increased rarity chances if parents are rare.
 */
export function breedCats(
  parentA: Cat,
  parentB: Cat,
  day: number,
  usedNames?: Set<string>,
  rng: () => number = Math.random,
): Cat {
  // Rarity inheritance: if both are rare (80%), if one is rare (55%), else base (12%)
  const bothRare = parentA.isRare && parentB.isRare;
  const oneRare = parentA.isRare || parentB.isRare;
  const rareRoll = rng();
  const inheritsRare = bothRare ? rareRoll < 0.80 : oneRare ? rareRoll < 0.55 : rareRoll < 0.12;

  let color = rng() < 0.5 ? parentA.color : parentB.color;
  let rareType = rng() < 0.5 ? parentA.rareType : parentB.rareType;
  let isRare = false;

  if (inheritsRare) {
    isRare = true;
    if (!rareType) {
      const rareSkins = CAT_SKINS.filter((s) => s.isRare);
      const picked = randomFrom(rareSkins, rng);
      color = picked.id;
      rareType = picked.rareType ?? null;
    }
  } else {
    // If not rare, ensure color is non-rare
    const skinDef = CAT_SKINS.find((s) => s.id === color);
    if (skinDef?.isRare) {
      const normalSkins = CAT_SKINS.filter((s) => !s.isRare);
      color = randomFrom(normalSkins, rng).id;
      rareType = null;
    }
  }

  // Pattern / marking inheritance
  const patternRoll = rng();
  let pattern = parentA.pattern;
  let marking = parentA.marking;
  if (patternRoll < 0.45) {
    pattern = parentB.pattern;
    marking = parentB.marking;
  } else if (patternRoll > 0.85) {
    // Mutation: new marking
    const activeMarkings = CAT_MARKINGS.filter((m) => m.id !== 'none');
    const newM = randomFrom(activeMarkings, rng);
    pattern = newM.id;
    marking = newM.file || undefined;
  }

  // Trait inheritance
  const majorTrait = rng() < 0.5 ? parentA.majorTrait : parentB.majorTrait;
  let minorTrait = rng() < 0.5 ? parentA.minorTrait : parentB.minorTrait;
  if (minorTrait === majorTrait) {
    const [t1, t2] = pickTwoDistinctTraits(rng);
    minorTrait = t1 === majorTrait ? t2 : t1;
  }

  let name = randomFrom(CAT_NAMES, rng);
  if (usedNames) {
    let attempts = 0;
    while (usedNames.has(name) && attempts < 30) {
      name = randomFrom(CAT_NAMES, rng);
      attempts += 1;
    }
    usedNames.add(name);
  }

  const kitten: Cat = {
    id: makeId(),
    name,
    color,
    pattern,
    marking,
    isRare,
    rareType,
    stage: 'kitten',
    growthProgress: 0,
    majorTrait,
    minorTrait,
    hunger: 90,
    cleanliness: 90,
    affection: 90,
    fun: 90,
    energy: 90,
    happiness: 90,
    friendshipIds: {
      [parentA.id]: 70,
      [parentB.id]: 70,
    },
    favoriteToy: rng() < 0.5 ? parentA.favoriteToy : parentB.favoriteToy,
    favoriteFood: rng() < 0.5 ? parentA.favoriteFood : parentB.favoriteFood,
    area: parentA.area,
    adoptedAt: Date.now(),
    ageDays: 0,
    journal: {
      adoptedDay: day,
      favoriteFoodDiscoveredDay: null,
      bestFriendId: parentA.id,
      longestNapSeconds: 0,
      totalPetsReceived: 0,
      totalTimesFed: 0,
      totalTimesWashed: 0,
      totalTimesBrushed: 0,
      entries: [
        {
          day,
          timestamp: Date.now(),
          message: `Born into the sanctuary to proud parents ${parentA.name} & ${parentB.name}!`,
        },
      ],
    },
    animationState: 'sit',
  };

  // Give parents reciprocal friendship to kitten
  parentA.friendshipIds[kitten.id] = 80;
  parentB.friendshipIds[kitten.id] = 80;

  return kitten;
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

