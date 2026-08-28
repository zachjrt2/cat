// ---------------------------------------------------------------------------
// Core domain types for Cozy Cat Sanctuary
// Mirrors the "Cat Data Model" section of the GDD.
// ---------------------------------------------------------------------------

export type MajorTrait =
  | 'lazy'
  | 'zoomie'
  | 'diva'
  | 'hunter'
  | 'curious'
  | 'social'
  | 'shy'
  | 'mischievous'
  | 'cuddler';

export type MinorTrait = MajorTrait;

export type CatArea = 'yard' | 'shelter' | 'sunroom' | 'cafe';

export type TimeOfDay = 'morning' | 'day' | 'sunset' | 'night';
export type WeatherType = 'sunny' | 'rain' | 'snow';

export type CatAnimationState =
  | 'sit'      // Idle
  | 'look'     // Curious
  | 'lay'      // Relax
  | 'sleep'    // Recover Energy
  | 'walk'     // Wander
  | 'run'      // Zoomies
  | 'play'     // Toy Interaction
  | 'pounce';  // Pounce leap attack

export type ToolType = 'food' | 'pet' | 'toy' | 'wash';

export interface JournalEntry {
  day: number;
  timestamp: number;
  message: string;
}

export interface CatJournal {
  adoptedDay: number;
  favoriteFoodDiscoveredDay: number | null;
  bestFriendId: string | null;
  longestNapSeconds: number;
  totalPetsReceived: number;
  totalTimesFed: number;
  totalTimesWashed: number;
  totalTimesBrushed: number;
  entries: JournalEntry[];
}

export type RareCatType = 'golden' | 'ghost' | 'radioactive' | 'gameboy' | 'seal_point' | 'hairless' | 'heterochromia' | 'royal';

export type CatMutationType =
  | 'giant'
  | 'tiny'
  | 'stinky'
  | 'sparkly'
  | 'inverted'
  | 'chromatic'
  | 'flaming'
  | 'frosted'
  | 'angelic'
  | 'gilded';

export type LifeStage = 'kitten' | 'teen' | 'adult';

export interface Cat {
  id: string;
  name: string;
  color: string;
  pattern: string;
  marking?: string; // Optional marking overlay key (e.g. 'Tabby Markings 000', 'Feet 000', etc.)
  isRare: boolean;
  rareType: RareCatType | null;
  mutation?: CatMutationType | null;

  stage: LifeStage;
  growthProgress: number; // 0..100 towards next life stage


  majorTrait: MajorTrait;
  minorTrait: MinorTrait;

  // Needs, 0-100
  hunger: number;
  cleanliness: number;
  affection: number;
  fun: number;
  energy: number;

  // Derived, 0-100
  happiness: number;

  friendshipIds: Record<string, number>; // catId -> -100..100
  favoriteToy: string;
  favoriteFood: string;

  area: CatArea;
  adoptedAt: number; // timestamp
  ageDays: number;
  lastPerfumeTimestamp?: number; // timestamp of last perfume frenzy activation (10m cooldown)

  // Persistent coordinates (normalized 0.0..1.0 within area bounds)
  xPercent?: number;
  yPercent?: number;

  journal: CatJournal;

  // runtime/behavioral state, not persisted needs-wise but saved for continuity
  animationState: CatAnimationState;
}

export type FenceLayout = 'none' | 'horizontal' | 'vertical' | 'both';

export interface SanctuaryArea {
  id: CatArea;
  unlocked: boolean;
  unlockThreshold: number; // number of adopted cats required
  capacity: number;
}

export type AutomationNeedType = 'food' | 'pet' | 'brush' | 'toy' | 'wash';

export interface AutomationMachineDef {
  id: string; // e.g. 'yard_feeder'
  needType: AutomationNeedType;
  area: CatArea;
  name: string;
  description: string;
  baseCost: number; // Love cost for level 1
  upgradeCostLvl2: number;
  upgradeCostLvl3: number;
  xPercent: number; // 0..1 inside area bounds
  yPercent: number; // 0..1 inside area bounds
}

export interface FurnitureItem {
  id: string;
  name: string;
  area: CatArea;
  loveCost: number;
  tokenCost?: number;
  description: string;
  xPercent: number; // 0..1 inside area bounds
  yPercent: number; // 0..1 inside area bounds
  bonusText: string;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  target: number;
  current: number;
  rewardTokens: number;
  claimed: boolean;
}

export interface GameState {
  love: number;
  adoptionTokens: number;
  cats: Cat[];
  areas: Record<CatArea, SanctuaryArea>;
  furniture: string[]; // List of owned furniture IDs
  machines: Record<string, number>; // machineId -> level (1, 2, 3)
  breedingCooldowns: Record<string, number>; // `${catA.id}:${catB.id}` -> lastBredDay
  strayArrivalDueAt?: number | null; // Timestamp for stray cat arrival safety net
  milestoneClaimedIds: string[];
  offlineStarLevel?: number; // 1..5: Passive Star rate per hour when offline (1=1/hr, 2=2/hr, 3=3/hr, 4=4/hr, 5=5/hr)
  catPerfumeCount?: number; // Number of consumable Cat Perfumes owned
  fenceLayout?: FenceLayout; // Customizable area divider fence layout
  totalPetsGiven: number;
  totalLoveEarned: number;
  totalRehomedCats: number;
  totalRehomeLoveEarned: number;
  timeOfDay: TimeOfDay;
  weather: WeatherType;
  day: number;
  lastSavedAt: number;
  createdAt: number;
}

