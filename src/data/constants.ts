import type { CatArea, FurnitureItem, RareCatType, SanctuaryArea } from './types';

// All decay/regen rates are "per minute" and get scaled by delta-time in the
// needs system. Values are intentionally gentle per the "Low Stress" pillar.
export const NEEDS_CONFIG = {
  hungerDecayPerMin: 1.2,
  cleanlinessDecayPerMin: 0.8,
  affectionDecayPerMin: 1.0,
  funDecayPerMin: 1.1,
  energyRecoverPerMinAwake: 0.6,
  energyDrainPerMinActive: 1.4,
  sleepEnergyRecoverPerMin: 6,
  lowNeedThreshold: 30,
};

export const LOVE_CONFIG = {
  baseLovePerInteraction: 5,
  divaMultiplier: 1.5,
  happyRelationshipLovePerMin: 0.15,
  sleepingCatLovePerMin: 0.05,
  lazySleepingBonusMultiplier: 2,
  decorationLovePerMin: 0,
};

export interface AreaInfo {
  id: CatArea;
  label: string;
  emoji: string;
  description: string;
  baseCapacity: number;
  unlockCostLove: number;
  unlockThresholdCats: number;
  capacityUpgradeCost: number;
}

export const AREA_INFO_MAP: Record<CatArea, AreaInfo> = {
  yard: {
    id: 'yard',
    label: 'Sunny Yard',
    emoji: '🌿',
    description: 'Outdoor garden with lush lawn, clover, daisies, and water bowls.',
    baseCapacity: 5,
    unlockCostLove: 0,
    unlockThresholdCats: 0,
    capacityUpgradeCost: 250,
  },
  shelter: {
    id: 'shelter',
    label: 'Cozy Shelter',
    emoji: '🏡',
    description: 'Warm indoor sanctuary with hardwood floor, plush beds, and grooming station.',
    baseCapacity: 15,
    unlockCostLove: 500,
    unlockThresholdCats: 3,
    capacityUpgradeCost: 250,
  },
  sunroom: {
    id: 'sunroom',
    label: 'Warm Sunroom',
    emoji: '☀️',
    description: 'Bright greenhouse solarium with sunbeams, potted ferns, and velvet cushions.',
    baseCapacity: 25,
    unlockCostLove: 2500,
    unlockThresholdCats: 8,
    capacityUpgradeCost: 250,
  },
  cafe: {
    id: 'cafe',
    label: 'Cat Café',
    emoji: '☕',
    description: 'Charming café with coffee tables where visitors leave Love tips.',
    baseCapacity: 40,
    unlockCostLove: 8000,
    unlockThresholdCats: 15,
    capacityUpgradeCost: 250,
  },
};

/**
 * Adding space to each area starts at 250 Love and doubles per level (250, 500, 1000, 2000, ...).
 */
export function getAreaCapacityUpgradeCost(areaState: SanctuaryArea, baseCapacity: number): number {
  const level = Math.max(0, Math.floor((areaState.capacity - baseCapacity) / 5));
  return 250 * Math.pow(2, level);
}

export const SANCTUARY_AREAS: Record<CatArea, SanctuaryArea> = {
  yard: { id: 'yard', unlocked: true, unlockThreshold: 0, capacity: 5 },
  shelter: { id: 'shelter', unlocked: false, unlockThreshold: 3, capacity: 15 },
  sunroom: { id: 'sunroom', unlocked: false, unlockThreshold: 8, capacity: 25 },
  cafe: { id: 'cafe', unlocked: false, unlockThreshold: 15, capacity: 40 },
};

export const FURNITURE_CATALOG: FurnitureItem[] = [
  {
    id: 'plush_donut_bed',
    name: 'Plush Donut Bed',
    area: 'yard',
    loveCost: 45,
    description: 'Ultra-soft circular bed that gives sleeping cats +50% extra passive Love.',
    xPercent: 0.78,
    yPercent: 0.38,
    bonusText: '+50% Sleeping Love in Yard',
  },
  {
    id: 'sisal_cat_tree',
    name: 'Tower Cat Tree',
    area: 'shelter',
    loveCost: 110,
    description: 'Multi-level climbing scratching post that keeps indoor cats energized and playful.',
    xPercent: 0.5,
    yPercent: 0.28,
    bonusText: '+25% Fun generation in Shelter',
  },
  {
    id: 'sunbeam_mat',
    name: 'Velvet Sunbeam Mat',
    area: 'sunroom',
    loveCost: 160,
    description: 'Silky floor cushion catching the golden rays of the conservatory.',
    xPercent: 0.5,
    yPercent: 0.45,
    bonusText: '+30% Happiness bonus in Sunroom',
  },
  {
    id: 'cardboard_castle',
    name: 'Cardboard Cat Castle',
    area: 'yard',
    loveCost: 80,
    description: 'Fortress made of delivery boxes. Mischievous cats adore hiding inside!',
    xPercent: 0.22,
    yPercent: 0.35,
    bonusText: '+40% Gift discovery chance',
  },
  {
    id: 'fountain_dish',
    name: 'Ceramic Flower Fountain',
    area: 'cafe',
    loveCost: 240,
    description: 'Fresh flowing water fountain that delights visitors and cats alike.',
    xPercent: 0.82,
    yPercent: 0.42,
    bonusText: '+20% Visitor tip Love in Café',
  },
];

export const AUTOMATION_CATALOG: import('./types').AutomationMachineDef[] = [
  // Sunny Yard Machines
  {
    id: 'yard_feeder',
    needType: 'food',
    area: 'yard',
    name: 'Garden Auto-Feeder',
    description: 'Auto food dispenser',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.15,
    yPercent: 0.24,
  },
  {
    id: 'yard_petter',
    needType: 'pet',
    area: 'yard',
    name: 'Lawn Cuddle Post',
    description: 'Auto cuddling post',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.40,
    yPercent: 0.22,
  },
  {
    id: 'yard_brush',
    needType: 'brush',
    area: 'yard',
    name: 'Bristle Archway',
    description: 'Auto grooming arch',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.65,
    yPercent: 0.24,
  },
  {
    id: 'yard_toy',
    needType: 'toy',
    area: 'yard',
    name: 'Solar Feather Spinner',
    description: 'Auto feather toy',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.24,
    yPercent: 0.72,
  },
  {
    id: 'yard_washer',
    needType: 'wash',
    area: 'yard',
    name: 'Dewdrop Bubble Basin',
    description: 'Auto bubble bath',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.76,
    yPercent: 0.72,
  },

  // Cozy Shelter Machines
  {
    id: 'shelter_feeder',
    needType: 'food',
    area: 'shelter',
    name: 'Pantry Meal Station',
    description: 'Auto meal dispenser',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.16,
    yPercent: 0.26,
  },
  {
    id: 'shelter_petter',
    needType: 'pet',
    area: 'shelter',
    name: 'Heated Massage Nook',
    description: 'Auto massage nook',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.84,
    yPercent: 0.26,
  },
  {
    id: 'shelter_brush',
    needType: 'brush',
    area: 'shelter',
    name: 'Corner Grooming Wall',
    description: 'Auto grooming brushes',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.24,
    yPercent: 0.72,
  },
  {
    id: 'shelter_toy',
    needType: 'toy',
    area: 'shelter',
    name: 'Laser Beam Projector',
    description: 'Auto laser toy',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.50,
    yPercent: 0.66,
  },
  {
    id: 'shelter_washer',
    needType: 'wash',
    area: 'shelter',
    name: 'Lavender Steam Spa',
    description: 'Auto steam bath',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.76,
    yPercent: 0.72,
  },

  // Warm Sunroom Machines
  {
    id: 'sunroom_feeder',
    needType: 'food',
    area: 'sunroom',
    name: 'Botanical Snack Buffet',
    description: 'Auto snack buffet',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.18,
    yPercent: 0.25,
  },
  {
    id: 'sunroom_petter',
    needType: 'pet',
    area: 'sunroom',
    name: 'Sunbeam Stroke Lounger',
    description: 'Auto stroke lounger',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.82,
    yPercent: 0.25,
  },
  {
    id: 'sunroom_brush',
    needType: 'brush',
    area: 'sunroom',
    name: 'Conservatory Fur Comb',
    description: 'Auto fur comb',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.22,
    yPercent: 0.70,
  },
  {
    id: 'sunroom_toy',
    needType: 'toy',
    area: 'sunroom',
    name: 'Prism Butterfly Orb',
    description: 'Auto butterfly toy',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.50,
    yPercent: 0.22,
  },
  {
    id: 'sunroom_washer',
    needType: 'wash',
    area: 'sunroom',
    name: 'Floral Hydro Mist Dome',
    description: 'Auto hydro mist',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.78,
    yPercent: 0.70,
  },

  // Cat Café Machines
  {
    id: 'cafe_feeder',
    needType: 'food',
    area: 'cafe',
    name: 'Barista Salmon Bar',
    description: 'Auto salmon bar',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.18,
    yPercent: 0.25,
  },
  {
    id: 'cafe_petter',
    needType: 'pet',
    area: 'cafe',
    name: 'Velvet Lap Simulator',
    description: 'Auto velvet lounger',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.50,
    yPercent: 0.22,
  },
  {
    id: 'cafe_brush',
    needType: 'brush',
    area: 'cafe',
    name: 'Salon Coat Polish Arch',
    description: 'Auto polishing arch',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.82,
    yPercent: 0.25,
  },
  {
    id: 'cafe_toy',
    needType: 'toy',
    area: 'cafe',
    name: 'Catnip Bubble Fountain',
    description: 'Auto bubble toy',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.28,
    yPercent: 0.70,
  },
  {
    id: 'cafe_washer',
    needType: 'wash',
    area: 'cafe',
    name: 'Deluxe Foam Jacuzzi',
    description: 'Auto foam bath',
    baseCost: 1000,
    upgradeCostLvl2: 2000,
    upgradeCostLvl3: 3000,
    xPercent: 0.72,
    yPercent: 0.70,
  },
];

/**
 * Calculates the generous Care Points (Love) and Star Tokens awarded when
 * rehoming a cat to a Loving Forever Home. Base stars: 1 (kitten), 5 (teen), 20 (adult),
 * with bonuses scaling off time in sanctuary, affection, happiness, mutations, and rarity.
 */
export function calculateRehomeLove(cat: import('./types').Cat): {
  total: number;
  base: number;
  stars: number;
  baseStars: number;
  starDevotionBonus: number;
  starRarityBonus: number;
  ageBonus: number;
  happinessBonus: number;
  rarityMultiplier: number;
} {
  const baseByStage = {
    kitten: 45,
    teen: 90,
    adult: 180,
  };

  const baseStarsByStage = {
    kitten: 1,
    teen: 5,
    adult: 20,
  };

  const base = baseByStage[cat.stage] || 100;
  const baseStars = baseStarsByStage[cat.stage] || 1;

  const ageBonus = Math.round((cat.ageDays || 0) * 15 + (cat.journal?.totalPetsReceived || 0) * 1.5);
  const happinessMultiplier = 0.5 + (cat.happiness / 100) * 0.75; // 0.5x to 1.25x
  const happinessBonus = Math.round(base * (happinessMultiplier - 1));

  let rarityMultiplier = 1.0;
  if (cat.isRare) {
    rarityMultiplier = cat.rareType ? 3.5 : 2.5;
  }
  if (cat.mutation) {
    rarityMultiplier *= 1.2;
  }

  const subtotal = Math.max(30, base + ageBonus + happinessBonus);
  const total = Math.round(subtotal * rarityMultiplier);

  // ── Star Tokens Calculation ──
  // Devotion: time in sanctuary (ageDays), pets received, high affection
  const devotionPoints = (cat.ageDays || 0) * 1.2 + (cat.journal?.totalPetsReceived || 0) * 0.15 + (cat.affection >= 90 ? 2 : 0);
  const stageDevotionFactor = cat.stage === 'adult' ? 0.35 : cat.stage === 'teen' ? 0.2 : 0.1;
  const starDevotionBonus = Math.floor(devotionPoints * stageDevotionFactor);

  // Star Rarity & Mutation Multiplier
  let starRarityMult = 1.0;
  if (cat.isRare) {
    starRarityMult = cat.rareType ? 2.5 : 1.75;
  }
  if (cat.mutation) {
    starRarityMult *= 1.25;
  }

  const happinessStarFactor = 0.85 + (cat.happiness / 100) * 0.35; // 0.85x to 1.2x
  const totalStarsWithMult = Math.round((baseStars + starDevotionBonus) * happinessStarFactor * starRarityMult);
  const starRarityBonus = Math.max(0, totalStarsWithMult - (baseStars + starDevotionBonus));
  const stars = Math.max(baseStars, totalStarsWithMult);

  return {
    total,
    base,
    stars,
    baseStars,
    starDevotionBonus,
    starRarityBonus,
    ageBonus,
    happinessBonus,
    rarityMultiplier,
  };
}


export interface MilestoneDef {
  id: string;
  title: string;
  description: string;
  type: 'cats' | 'pets' | 'friends' | 'love';
  target: number;
  rewardTokens: number;
}

export const MILESTONES_DEF: MilestoneDef[] = [
  // Cats Ownership Chain
  { id: 'adopt_1', title: 'First Steps', description: 'Welcome your 1st cat into the sanctuary.', type: 'cats', target: 1, rewardTokens: 3 },
  { id: 'adopt_3', title: 'First Whiskers', description: 'Have 3 cats in your sanctuary.', type: 'cats', target: 3, rewardTokens: 3 },
  { id: 'adopt_8', title: 'Growing Family', description: 'Have 8 cats in your sanctuary.', type: 'cats', target: 8, rewardTokens: 6 },
  { id: 'adopt_15', title: 'Full House', description: 'Have 15 cats in your sanctuary.', type: 'cats', target: 15, rewardTokens: 9 },
  { id: 'adopt_30', title: 'Cat Paradise', description: 'Have 30 cats in your sanctuary.', type: 'cats', target: 30, rewardTokens: 15 },
  { id: 'adopt_50', title: 'Sanctuary Empire', description: 'Have 50 cats in your sanctuary.', type: 'cats', target: 50, rewardTokens: 25 },
  { id: 'adopt_75', title: 'Feline Haven Legend', description: 'Have 75 cats in your sanctuary.', type: 'cats', target: 75, rewardTokens: 40 },
  
  // Pets / Care Chain
  { id: 'pets_12', title: 'Gentle Touch', description: 'Give 12 loving pets to your cats.', type: 'pets', target: 12, rewardTokens: 3 },
  { id: 'pets_25', title: 'Gentle Hands', description: 'Give 25 loving pets to your cats.', type: 'pets', target: 25, rewardTokens: 3 },
  { id: 'pets_100', title: 'Purr Master', description: 'Give 100 loving pets to your cats.', type: 'pets', target: 100, rewardTokens: 6 },
  { id: 'pets_300', title: 'Cuddle Champion', description: 'Give 300 loving pets to your cats.', type: 'pets', target: 300, rewardTokens: 12 },
  { id: 'pets_600', title: 'Cat Whisperer', description: 'Give 600 loving pets to your cats.', type: 'pets', target: 600, rewardTokens: 20 },
  { id: 'pets_1200', title: 'Endless Affection Master', description: 'Give 1,200 loving pets to your cats.', type: 'pets', target: 1200, rewardTokens: 30 },
  { id: 'pets_2500', title: 'Patron Saint of Purrs', description: 'Give 2,500 loving pets to your cats.', type: 'pets', target: 2500, rewardTokens: 50 },

  // Friendship Chain
  { id: 'friends_1', title: 'First Bond', description: 'Have 1 pair of cats become Best Friends.', type: 'friends', target: 1, rewardTokens: 3 },
  { id: 'friends_2', title: 'Kindred Spirits', description: 'Have 2 pairs of cats become Best Friends.', type: 'friends', target: 2, rewardTokens: 3 },
  { id: 'friends_6', title: 'Bonded Sanctuary', description: 'Have 6 pairs of cats become Best Friends.', type: 'friends', target: 6, rewardTokens: 9 },
  { id: 'friends_12', title: 'Harmonious Colony', description: 'Have 12 pairs of cats become Best Friends.', type: 'friends', target: 12, rewardTokens: 18 },
  { id: 'friends_20', title: 'Lifelong Pack Bonds', description: 'Have 20 pairs of cats become Best Friends.', type: 'friends', target: 20, rewardTokens: 30 },
  { id: 'friends_35', title: 'Eternal Fellowship', description: 'Have 35 pairs of cats become Best Friends.', type: 'friends', target: 35, rewardTokens: 45 },

  // Care Points (Love) Generation Chain
  { id: 'love_100', title: 'Tender Glow', description: 'Generate 100 total Care Points.', type: 'love', target: 100, rewardTokens: 3 },
  { id: 'love_200', title: 'Warm Feelings', description: 'Generate 200 total Care Points.', type: 'love', target: 200, rewardTokens: 3 },
  { id: 'love_1000', title: 'Heart Overflowing', description: 'Generate 1,000 total Care Points.', type: 'love', target: 1000, rewardTokens: 9 },
  { id: 'love_5000', title: 'Infinite Affection', description: 'Generate 5,000 total Care Points.', type: 'love', target: 5000, rewardTokens: 15 },
  { id: 'love_15000', title: 'Cosmic Compassion', description: 'Generate 15,000 total Care Points.', type: 'love', target: 15000, rewardTokens: 25 },
  { id: 'love_35000', title: 'Sanctuary of Legends', description: 'Generate 35,000 total Care Points.', type: 'love', target: 35000, rewardTokens: 40 },
  { id: 'love_75000', title: 'Heart of the Universe', description: 'Generate 75,000 total Care Points.', type: 'love', target: 75000, rewardTokens: 60 },
];

export interface OfflineStarUpgradeDef {
  level: number;
  ratePerHour: number;
  costCarePoints: number;
  name: string;
  description: string;
}

export const OFFLINE_STAR_UPGRADES: OfflineStarUpgradeDef[] = [
  { level: 1, ratePerHour: 1, costCarePoints: 0, name: 'Starlit Whispers', description: 'Gathers 1 Star per hour while offline.' },
  { level: 2, ratePerHour: 2, costCarePoints: 1000, name: 'Celestial Harmony', description: 'Increases offline Star generation to 2 Stars per hour.' },
  { level: 3, ratePerHour: 3, costCarePoints: 5000, name: 'Astral Resonance', description: 'Increases offline Star generation to 3 Stars per hour.' },
  { level: 4, ratePerHour: 4, costCarePoints: 25000, name: 'Cosmic Compassion', description: 'Increases offline Star generation to 4 Stars per hour.' },
  { level: 5, ratePerHour: 5, costCarePoints: 125000, name: 'Infinite Starlight', description: 'Maximum offline rate: 5 Stars per hour.' },
];

export interface RareSummonDef {
  id: RareCatType;
  name: string;
  skinId: string;
  title: string;
  description: string;
  tokenCost: number;
}

export const RARE_SUMMONS: RareSummonDef[] = [
  {
    id: 'golden',
    name: 'Midas',
    skinId: 'gold_0',
    title: 'Legendary Golden Cat',
    description: 'A shimmering feline that permanently boosts Love generation across the entire sanctuary.',
    tokenCost: 3,
  },
  {
    id: 'ghost',
    name: 'Specter',
    skinId: 'ghost_0',
    title: 'Ethereal Ghost Cat',
    description: 'A spectral feline that glows with an ethereal moonlight aura and loves nighttime naps.',
    tokenCost: 3,
  },
  {
    id: 'gameboy',
    name: 'Pixel',
    skinId: 'game_boy_0',
    title: 'Retro GameBoy Cat',
    description: 'A charming 8-bit nostalgia cat with green LCD pixel fur and playful retro zoomies.',
    tokenCost: 4,
  },
  {
    id: 'radioactive',
    name: 'Radium',
    skinId: 'radioactive_0',
    title: 'Neon Radioactive Cat',
    description: 'Vibrant neon feline that glows in the dark and energizes all cats sleeping nearby.',
    tokenCost: 4,
  },
  {
    id: 'royal',
    name: 'Duchess',
    skinId: 'pastel_pink_0',
    title: 'Majestic Royal Cat',
    description: 'An elegant aristocratic cat who generates generous bonus tips from visitors.',
    tokenCost: 5,
  },
];

export const AUTOSAVE_INTERVAL_MS = 30_000;
export const SAVE_KEY = 'cozy-cat-sanctuary:save:v1';

export const ADOPTION_BASE_COST = 20; // Love cost, scales gently with cat count

export const CAT_PERFUME_COST = 200; // 200 Care Points
export const CAT_PERFUME_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes per cat
export const CAT_PERFUME_FRENZY_SECONDS = 15; // 15 seconds of breeding frenzy
export const CONGA_WHISTLE_COST = 250; // 250 Care Points (Cheapest gateway dance)
export const RAIN_TOTEM_COST = 500; // 500 Care Points (Concentric Rain Dance)

export interface PlinkoUpgradeDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  maxLevel: number;
  costs: { stars: number; love?: number }[];
  effectLabel: string[];
}

export const PLINKO_UPGRADES_CATALOG: PlinkoUpgradeDef[] = [
  {
    id: 'multiball_discount',
    name: 'Multiball Discount',
    icon: '',
    description: 'Star discount on multiballs',
    maxLevel: 3,
    costs: [
      { stars: 25 },
      { stars: 60 },
      { stars: 150 },
    ],
    effectLabel: [
      '-10% Star cost',
      '-20% Star cost',
      '-35% Star cost',
    ],
  },
  {
    id: 'lucky_pegs',
    name: 'Golden Pegs',
    icon: '',
    description: 'Center balls & award +1 Star',
    maxLevel: 3,
    costs: [
      { stars: 20 },
      { stars: 50 },
      { stars: 120 },
    ],
    effectLabel: [
      '2 Golden Pegs (+1 Star)',
      '4 Golden Pegs (+1 Star)',
      '6 Golden Pegs (+1 Star)',
    ],
  },
  {
    id: 'rarity_charm',
    name: 'Rarity Charm',
    icon: '',
    description: 'Boosts rare cat odds',
    maxLevel: 3,
    costs: [
      { stars: 30 },
      { stars: 75 },
      { stars: 180 },
    ],
    effectLabel: [
      '+15% Rare Odds',
      '+30% Rare Odds',
      '+50% Rare Odds',
    ],
  },
  {
    id: 'mutation_overdrive',
    name: 'Mutation Boost',
    icon: '',
    description: 'Boosts mutation chance',
    maxLevel: 3,
    costs: [
      { stars: 35 },
      { stars: 80 },
      { stars: 200 },
    ],
    effectLabel: [
      '+12% Mutation Chance',
      '+25% Mutation Chance',
      '+40% Mutation Chance',
    ],
  },
  {
    id: 'fever_meter',
    name: 'Fever Meter',
    icon: '',
    description: 'Guarantees high tiers',
    maxLevel: 2,
    costs: [
      { stars: 50 },
      { stars: 125 },
    ],
    effectLabel: [
      'Fever Mode active',
      '+50% Charge Speed',
    ],
  },
];

export const SNOWFLAKE_WAND_COST = 1000;
export const HEART_WAND_COST = 2000;
export const INFINITY_METRONOME_COST = 4000;
export const SOLAR_PRISM_COST = 8000;
export const STAR_COMPASS_COST = 5000;



