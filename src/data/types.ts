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
  | 'play';    // Toy Interaction

export type ToolType = 'food' | 'pet' | 'brush' | 'toy' | 'wash';

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

export type LifeStage = 'kitten' | 'teen' | 'adult';

export interface Cat {
  id: string;
  name: string;
  color: string;
  pattern: string;
  marking?: string; // Optional marking overlay key (e.g. 'Tabby Markings 000', 'Feet 000', etc.)
  isRare: boolean;
  rareType: RareCatType | null;

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

  journal: CatJournal;

  // runtime/behavioral state, not persisted needs-wise but saved for continuity
  animationState: CatAnimationState;
}

export interface SanctuaryArea {
  id: CatArea;
  unlocked: boolean;
  unlockThreshold: number; // number of adopted cats required
  capacity: number;
}

export interface FurnitureItem {
  id: string;
  name: string;
  area: CatArea;
  emoji: string;
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
  milestoneClaimedIds: string[];
  totalPetsGiven: number;
  totalLoveEarned: number;
  timeOfDay: TimeOfDay;
  weather: WeatherType;
  day: number;
  lastSavedAt: number;
  createdAt: number;
}
