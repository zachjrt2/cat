// ---------------------------------------------------------------------------
// Cat Conquest — Core Types
// ---------------------------------------------------------------------------

import type { MajorTrait, MinorTrait, CatMutationType, RareCatType, LifeStage } from '../types';

// ── Formations ─────────────────────────────────────────────────────────────

export type Formation = 'balanced' | 'phalanx' | 'rush' | 'scatter';

export interface FormationDef {
  id: Formation;
  label: string;
  emoji: string;
  description: string;
  attackMult: number;
  defenseMult: number;
  critMult: number;
  evasionMult: number;
}

// ── Special Abilities ───────────────────────────────────────────────────────

export type SpecialAbilityType =
  | 'pounce'       // hunter  — 3× attack on one enemy
  | 'zoom_blitz'   // zoomie  — 0.5× attack on ALL enemies
  | 'rally_cry'    // social  — +20 attack to all allies for 3 rounds
  | 'comfort'      // cuddler — restore 40 HP to lowest-HP ally
  | 'taunt'        // diva    — force all enemies to target this cat for 2 rounds
  | 'sabotage'     // mischievous — -40% attack on one enemy for 2 rounds
  | 'vanish'       // shy     — untargetable for 1 round
  | 'cat_nap'      // lazy    — skip 1 round, restore full HP
  | 'scout';       // curious — +25% damage from all allies for 2 rounds

export interface SpecialAbility {
  type: SpecialAbilityType;
  label: string;
  description: string;
}

// ── Combat Cat ─────────────────────────────────────────────────────────────

export interface ConquestCat {
  // Identity (display only)
  sourceId: string;
  color: string;
  pattern: string;
  marking?: string;
  stage: LifeStage;
  isRare: boolean;
  rareType: RareCatType | null;
  mutation: CatMutationType | null;
  majorTrait: MajorTrait;
  minorTrait: MinorTrait;

  // Battle stats
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  critChance: number;    // 0.0–1.0
  evasion: number;       // 0.0–1.0

  // Special
  special: SpecialAbility;
  specialUsed: boolean;

  // Name & Relationships
  name?: string;
  friendshipIds?: Record<string, number>;

  // Runtime buffs & status effects
  attackBuff: number;    // absolute bonus to attack
  attackBuffRounds: number;
  defenseBuff: number;
  defenseBuffRounds: number;
  damageBuff: number;    // multiplier applied to damage dealt (e.g. 1.25)
  damageBuffRounds: number;
  tauntedRounds: number; // this cat is being taunted (must target taunt source)
  vanishRounds: number;  // this cat is untargetable
  attackDebuff: number;  // multiplier reducing attack (e.g. 0.60)
  attackDebuffRounds: number;
  tauntSourceId: string | null; // id of cat whose Taunt effect is active

  // Mutation & Synergy combat effects
  burnRounds: number;
  burnDamage: number;
  chillRounds: number;
  shieldHp: number;
  avengerRounds: number; // 100% crit chance when avenging a fallen friend
  hasBestFriendAhead?: boolean;
  hasProtectorAhead?: boolean;
  hasCoatHarmony?: boolean;
}

// ── Enemy Cat ───────────────────────────────────────────────────────────────

export interface EnemyCat {
  id: string; // generated unique id
  color: string;
  pattern: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  critChance: number;
  evasion: number;
  // Runtime buffs (same shape as ConquestCat)
  attackBuff: number;
  attackBuffRounds: number;
  defenseBuff: number;
  defenseBuffRounds: number;
  damageDebuff: number;    // multiplier reducing incoming damage
  attackDebuff: number;
  attackDebuffRounds: number;
  vanishRounds: number;
  tauntedRounds: number;
  tauntSourceId: string | null;
  // Mutation & Status effects
  burnRounds: number;
  burnDamage: number;
  chillRounds: number;
  shieldHp: number;
}

// ── Battle State ────────────────────────────────────────────────────────────

export interface BattleState {
  formation: Formation;

  // Full rosters (all cats for this battle)
  allPlayerCats: ConquestCat[];
  allEnemyCats: EnemyCat[];

  // 10 Independent Lane Queues
  playerLanes: ConquestCat[][];
  enemyLanes: EnemyCat[][];

  // Current active front-line cats (up to 10 combatants, one per non-empty lane)
  activeFriendly: ConquestCat[];
  activeEnemy: EnemyCat[];

  // Indices into allPlayerCats / allEnemyCats for next batch
  playerBatchStart: number;
  enemyBatchStart: number;

  round: number;
  playerWaveNumber: number;
  enemyWaveNumber: number;

  // Result
  outcome: 'ongoing' | 'player_win' | 'player_lose';
  playerKoCount: number; // tracks perfect-battle bonus
}


// ── Battle Events (emitted by BattleEngine) ─────────────────────────────────

export type BattleEvent =
  | { type: 'attack'; attackerId: string; targetId: string; damage: number; isCrit: boolean; side: 'player' | 'enemy' }
  | { type: 'ko'; catId: string; side: 'player' | 'enemy' }
  | { type: 'special'; catId: string; ability: SpecialAbilityType; description: string }
  | { type: 'wave_start'; playerWave: number; enemyWave: number }
  | { type: 'buff'; catId: string; description: string }
  | { type: 'burn'; catId: string; damage: number; side: 'player' | 'enemy' }
  | { type: 'cleave'; attackerId: string; targets: { id: string; damage: number }[]; side: 'player' | 'enemy' }
  | { type: 'counter'; attackerId: string; targetId: string; damage: number; side: 'player' | 'enemy' }
  | { type: 'heal'; catId: string; amount: number; description: string }
  | { type: 'shield'; catId: string; amount: number; description: string }
  | { type: 'avenger'; catId: string; description: string }
  | { type: 'battle_end'; outcome: 'player_win' | 'player_lose'; playerKoCount: number };


// ── Region Definition ───────────────────────────────────────────────────────

export interface RegionDef {
  index: number;          // 0–9
  name: string;
  emoji: string;
  flavor: string;
  enemyCount: number;
  invasionCost: number;   // in 💗 Love
  loveReward: number;
  starReward: number;
  statMultiplier: number; // applied to all enemy stats (scales difficulty)
  isBoss: boolean;        // if true, single enemy with ×3 stats
}

// ── Conquest Save State ─────────────────────────────────────────────────────

export interface ConquestState {
  clearedRegions: number[];       // indices (0–9) of fully cleared regions
  pendingLove: number;            // accumulated love not yet deposited to sanctuary
  pendingStars: number;
  totalInvasionsLaunched: number;
  totalBattlesWon: number;
  totalBattlesLost: number;
}

export function defaultConquestState(): ConquestState {
  return {
    clearedRegions: [],
    pendingLove: 0,
    pendingStars: 0,
    totalInvasionsLaunched: 0,
    totalBattlesWon: 0,
    totalBattlesLost: 0,
  };
}
