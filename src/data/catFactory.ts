import type { Cat, CatJournal, CatMutationType } from './types';
import { CAT_SKINS, CAT_MARKINGS, CAT_NAMES, FAVORITE_FOODS, FAVORITE_TOYS } from './catAssets';
import { pickTwoDistinctTraits } from './traits';
import { rollRandomMutation } from './mutations';

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
  existingCats?: Cat[];
  forceRare?: boolean;
  skinId?: string;
  stage?: import('./types').LifeStage;
  mutation?: CatMutationType | null;
  mutationChance?: number;
  rng?: () => number;
}

/**
 * Picks a unique cat name from CAT_NAMES that does not clash with any usedNames or existingCats.
 * If all base names are exhausted, automatically appends sequential Roman numerals (II, III, IV...)
 * to guarantee 100% duplicate protection.
 */
export function generateUniqueCatName(
  usedNames?: Set<string>,
  existingCats?: Cat[],
  rng: () => number = Math.random,
  preferredBaseName?: string,
): string {
  const activeUsed = new Set<string>();
  if (usedNames) {
    usedNames.forEach((n) => activeUsed.add(n.toLowerCase().trim()));
  }
  if (existingCats) {
    existingCats.forEach((c) => activeUsed.add(c.name.toLowerCase().trim()));
  }

  // If a preferred base name is requested (e.g. for rare breeds)
  if (preferredBaseName) {
    const baseClean = preferredBaseName.trim();
    if (!activeUsed.has(baseClean.toLowerCase())) {
      if (usedNames) usedNames.add(baseClean);
      return baseClean;
    }
    const romanNumerals = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    for (const roman of romanNumerals) {
      const candidate = `${baseClean} ${roman}`;
      if (!activeUsed.has(candidate.toLowerCase())) {
        if (usedNames) usedNames.add(candidate);
        return candidate;
      }
    }
  }

  // 1. Try picking from completely unused names in the library
  const availableNames = CAT_NAMES.filter((n) => !activeUsed.has(n.toLowerCase().trim()));
  if (availableNames.length > 0) {
    const picked = randomFrom(availableNames, rng);
    if (usedNames) usedNames.add(picked);
    return picked;
  }

  // 2. If all 350+ base names are taken, pick a random base name and append Roman numerals
  const baseName = randomFrom(CAT_NAMES, rng);
  const romanNumerals = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  for (const roman of romanNumerals) {
    const candidate = `${baseName} ${roman}`;
    if (!activeUsed.has(candidate.toLowerCase().trim())) {
      if (usedNames) usedNames.add(candidate);
      return candidate;
    }
  }

  // 3. Fallback numerical suffix
  let counter = 2;
  while (true) {
    const candidate = `${baseName} #${counter}`;
    if (!activeUsed.has(candidate.toLowerCase().trim())) {
      if (usedNames) usedNames.add(candidate);
      return candidate;
    }
    counter++;
  }
}

/**
 * Selects a (skin, marking) pair with strong bias against identical visual duplicates
 * that already exist in the sanctuary.
 */
function pickUniqueVisualCombo(
  pool: readonly typeof CAT_SKINS[0][],
  fixedSkinId: string | undefined,
  existingAppearances: Set<string>,
  rng: () => number,
): { skin: typeof CAT_SKINS[0]; marking: typeof CAT_MARKINGS[0] } {
  const activeMarkings = CAT_MARKINGS.filter((m) => m.id !== 'none');

  const rollMarkingForSkin = (s: typeof CAT_SKINS[0], allowNone = true): typeof CAT_MARKINGS[0] => {
    if (s.id.startsWith('hairless') || s.id.startsWith('game_boy')) {
      return CAT_MARKINGS[0]; // 'none'
    }
    if (allowNone && rng() < 0.45) {
      return CAT_MARKINGS[0]; // 'none'
    }
    return randomFrom(activeMarkings, rng);
  };

  // 1. If a specific skin is requested (e.g. uncommon/rare Plinko tiers)
  if (fixedSkinId) {
    const skin = CAT_SKINS.find((s) => s.id === fixedSkinId) || pool[0];
    if (skin.id.startsWith('hairless') || skin.id.startsWith('game_boy')) {
      return { skin, marking: CAT_MARKINGS[0] };
    }
    // Attempt to pick an unused marking for this skin
    const shuffledMarkings = [CAT_MARKINGS[0], ...[...activeMarkings].sort(() => rng() - 0.5)];
    for (const m of shuffledMarkings) {
      if (!existingAppearances.has(`${skin.id}:${m.id}`)) {
        return { skin, marking: m };
      }
    }
    return { skin, marking: rollMarkingForSkin(skin) };
  }

  // 2. Otherwise search for an unused (skin, marking) pair
  for (let attempt = 0; attempt < 35; attempt++) {
    const candidateSkin = randomFrom(pool, rng);
    const candidateMarking = rollMarkingForSkin(candidateSkin);
    const key = `${candidateSkin.id}:${candidateMarking.id}`;
    if (!existingAppearances.has(key)) {
      return { skin: candidateSkin, marking: candidateMarking };
    }
  }

  // Fallback
  const fallbackSkin = randomFrom(pool, rng);
  return { skin: fallbackSkin, marking: rollMarkingForSkin(fallbackSkin) };
}

export function generateCat(options: GenerateCatOptions): Cat {
  const {
    day,
    usedNames,
    existingCats,
    forceRare = false,
    skinId,
    stage = 'kitten',
    mutation: forcedMutation,
    mutationChance = 0.05,
    rng = Math.random,
  } = options;

  const existingAppearances = new Set((existingCats ?? []).map((c) => `${c.color}:${c.pattern || 'none'}`));

  // 12% chance of rolling a rare cat naturally, or guaranteed if forceRare
  const isRareRoll = forceRare || rng() < 0.12;
  const pool = isRareRoll
    ? CAT_SKINS.filter((s) => s.isRare)
    : CAT_SKINS.filter((s) => !s.isRare);

  const { skin, marking: markingDef } = pickUniqueVisualCombo(pool, skinId, existingAppearances, rng);
  const isRare = !!skin.isRare;
  const rareType = skin.rareType ?? null;

  // Mutation roll
  let mutation: CatMutationType | null = forcedMutation ?? null;
  if (mutation === undefined && rng() < mutationChance) {
    mutation = rollRandomMutation(rng);
  }

  const [majorTrait, minorTrait] = pickTwoDistinctTraits(rng);
  const name = generateUniqueCatName(usedNames, existingCats, rng);

  const cat: Cat = {
    id: makeId(),
    name,
    color: skin.id,
    pattern: markingDef.id,
    marking: markingDef.file || undefined,
    isRare,
    rareType,
    mutation,

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
  existingCats?: Cat[],
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

  // Pattern / marking inheritance with duplicate protection
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

  // If the inherited combo is an exact visual duplicate of an existing cat, give high preference to rolling an unused marking
  if (existingCats && existingCats.length > 0) {
    const existingAppearances = new Set(existingCats.map((c) => `${c.color}:${c.pattern || 'none'}`));
    if (existingAppearances.has(`${color}:${pattern || 'none'}`)) {
      const activeMarkings = CAT_MARKINGS.filter((m) => m.id !== 'none').sort(() => rng() - 0.5);
      const uniqueMarking = activeMarkings.find((m) => !existingAppearances.has(`${color}:${m.id}`));
      if (uniqueMarking) {
        pattern = uniqueMarking.id;
        marking = uniqueMarking.file || undefined;
      }
    }
  }

  // Trait inheritance
  const majorTrait = rng() < 0.5 ? parentA.majorTrait : parentB.majorTrait;
  let minorTrait = rng() < 0.5 ? parentA.minorTrait : parentB.minorTrait;
  if (minorTrait === majorTrait) {
    const [t1, t2] = pickTwoDistinctTraits(rng);
    minorTrait = t1 === majorTrait ? t2 : t1;
  }

  // Genetics & Mutation Inheritance
  let mutation: CatMutationType | null = null;
  const parentAMut = parentA.mutation ?? null;
  const parentBMut = parentB.mutation ?? null;

  if (parentAMut && parentBMut) {
    // Both parents have mutations
    const mutRoll = rng();
    if (mutRoll < 0.40) mutation = parentAMut;
    else if (mutRoll < 0.80) mutation = parentBMut;
    else if (mutRoll < 0.95) mutation = rollRandomMutation(rng); // spontaneous new combo mutation!
  } else if (parentAMut || parentBMut) {
    // One parent has a mutation
    const singleMut: CatMutationType = parentAMut || parentBMut!;
    const mutRoll = rng();
    if (mutRoll < 0.40) mutation = singleMut;
    else if (mutRoll < 0.50) mutation = rollRandomMutation(rng);
  } else {
    // Spontaneous mutation chance
    if (rng() < 0.09) {
      mutation = rollRandomMutation(rng);
    }
  }

  const name = generateUniqueCatName(usedNames, [parentA, parentB], rng);

  const kitten: Cat = {
    id: makeId(),
    name,
    color,
    pattern,
    marking,
    isRare,
    rareType,
    mutation,
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

export function generateRareCat(
  rareType: import('./types').RareCatType,
  options: {
    day: number;
    usedNames?: Set<string>;
    existingCats?: Cat[];
    mutation?: CatMutationType | null;
    mutationChance?: number;
    stage?: 'kitten' | 'teen' | 'adult';
  },
): Cat {
  const { day, usedNames, existingCats } = options;
  const rareSkin = CAT_SKINS.find((s) => s.rareType === rareType) || CAT_SKINS.find((s) => s.isRare)!;

  const existingAppearances = new Set((existingCats ?? []).map((c) => `${c.color}:${c.pattern || 'none'}`));

  // If a rare cat of this color already exists, try to assign a distinct marking
  let markingDef = CAT_MARKINGS[0]; // 'none'
  if (!rareSkin.id.startsWith('hairless') && !rareSkin.id.startsWith('game_boy')) {
    if (existingAppearances.has(`${rareSkin.id}:none`)) {
      const activeMarkings = CAT_MARKINGS.filter((m) => m.id !== 'none').sort(() => Math.random() - 0.5);
      const unused = activeMarkings.find((m) => !existingAppearances.has(`${rareSkin.id}:${m.id}`));
      markingDef = unused || activeMarkings[0];
    } else if (Math.random() < 0.35) {
      const activeMarkings = CAT_MARKINGS.filter((m) => m.id !== 'none');
      markingDef = randomFrom(activeMarkings);
    }
  }

  const [majorTrait, minorTrait] = pickTwoDistinctTraits();
  // Pull from normal unique name pool instead of forcing the breed label
  const name = generateUniqueCatName(usedNames, existingCats, Math.random);

  const mutChance = options.mutationChance ?? 0.15;
  let mutation: CatMutationType | null = options.mutation ?? null;
  if (!mutation && Math.random() < mutChance) {
    mutation = rollRandomMutation();
  }

  const stage = options.stage ?? 'adult';

  return {
    id: makeId(),
    name,
    color: rareSkin.id,
    pattern: markingDef.id,
    marking: markingDef.file || undefined,
    isRare: true,
    rareType,
    mutation,
    stage,
    growthProgress: stage === 'adult' ? 100 : 0,
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
    ageDays: stage === 'adult' ? 2 : 0,
    journal: emptyJournal(day),
    animationState: 'sit',
  };
}

