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
    capacityUpgradeCost: 40,
  },
  shelter: {
    id: 'shelter',
    label: 'Cozy Shelter',
    emoji: '🏡',
    description: 'Warm indoor sanctuary with hardwood floor, plush beds, and grooming station.',
    baseCapacity: 15,
    unlockCostLove: 60,
    unlockThresholdCats: 3,
    capacityUpgradeCost: 80,
  },
  sunroom: {
    id: 'sunroom',
    label: 'Warm Sunroom',
    emoji: '☀️',
    description: 'Bright greenhouse solarium with sunbeams, potted ferns, and velvet cushions.',
    baseCapacity: 25,
    unlockCostLove: 180,
    unlockThresholdCats: 8,
    capacityUpgradeCost: 150,
  },
  cafe: {
    id: 'cafe',
    label: 'Cat Café',
    emoji: '☕',
    description: 'Charming café with coffee tables where visitors leave Love tips.',
    baseCapacity: 40,
    unlockCostLove: 400,
    unlockThresholdCats: 15,
    capacityUpgradeCost: 250,
  },
};

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
    emoji: '🛏️',
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
    emoji: '🪵',
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
    emoji: '☀️',
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
    emoji: '🏰',
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
    emoji: '⛲',
    loveCost: 240,
    description: 'Fresh flowing water fountain that delights visitors and cats alike.',
    xPercent: 0.82,
    yPercent: 0.42,
    bonusText: '+20% Visitor tip Love in Café',
  },
];

export interface MilestoneDef {
  id: string;
  title: string;
  description: string;
  type: 'cats' | 'pets' | 'friends' | 'love';
  target: number;
  rewardTokens: number;
}

export const MILESTONES_DEF: MilestoneDef[] = [
  { id: 'adopt_3', title: 'First Whiskers', description: 'Adopt 3 cats into your sanctuary.', type: 'cats', target: 3, rewardTokens: 1 },
  { id: 'adopt_8', title: 'Growing Family', description: 'Adopt 8 cats into your sanctuary.', type: 'cats', target: 8, rewardTokens: 2 },
  { id: 'adopt_15', title: 'Full House', description: 'Adopt 15 cats into your sanctuary.', type: 'cats', target: 15, rewardTokens: 3 },
  { id: 'adopt_30', title: 'Cat Paradise', description: 'Adopt 30 cats into your sanctuary.', type: 'cats', target: 30, rewardTokens: 5 },
  
  { id: 'pets_25', title: 'Gentle Hands', description: 'Give 25 pets to your cats.', type: 'pets', target: 25, rewardTokens: 1 },
  { id: 'pets_100', title: 'Purr Master', description: 'Give 100 pets to your cats.', type: 'pets', target: 100, rewardTokens: 2 },
  { id: 'pets_300', title: 'Cuddle Champion', description: 'Give 300 pets to your cats.', type: 'pets', target: 300, rewardTokens: 4 },

  { id: 'friends_2', title: 'Kindred Spirits', description: 'Have 2 pairs of cats become Best Friends.', type: 'friends', target: 2, rewardTokens: 1 },
  { id: 'friends_6', title: 'Bonded Sanctuary', description: 'Have 6 pairs of cats become Best Friends.', type: 'friends', target: 6, rewardTokens: 3 },

  { id: 'love_200', title: 'Warm Feelings', description: 'Generate 200 total Love.', type: 'love', target: 200, rewardTokens: 1 },
  { id: 'love_1000', title: 'Heart Overflowing', description: 'Generate 1,000 total Love.', type: 'love', target: 1000, rewardTokens: 3 },
  { id: 'love_5000', title: 'Infinite Affection', description: 'Generate 5,000 total Love.', type: 'love', target: 5000, rewardTokens: 5 },
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
