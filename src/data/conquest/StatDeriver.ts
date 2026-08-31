// ---------------------------------------------------------------------------
// Cat Conquest — Stat Deriver
// Converts sanctuary Cat[] into ConquestCat[] for battle
// ---------------------------------------------------------------------------

import type { Cat } from '../types';
import type { ConquestCat, SpecialAbility, FormationDef } from './ConquestTypes';
import { FORMATIONS } from './ConquestData';

// ── Special ability definitions ──────────────────────────────────────────────

const SPECIAL_MAP: Record<string, SpecialAbility> = {
  hunter: {
    type: 'pounce',
    label: 'Pounce',
    description: 'Leaps at one enemy for 3× attack damage.',
  },
  zoomie: {
    type: 'zoom_blitz',
    label: 'Zoom Blitz',
    description: 'Dashes through all enemies for 0.5× attack each.',
  },
  social: {
    type: 'rally_cry',
    label: 'Rally Cry',
    description: 'Inspires allies — +20 attack to all friendlies for 3 rounds.',
  },
  cuddler: {
    type: 'comfort',
    label: 'Comfort',
    description: 'Heals the lowest-HP ally for 40 HP.',
  },
  diva: {
    type: 'taunt',
    label: 'Taunt',
    description: 'Commands all enemy attention — forces all enemies to target this cat for 2 rounds.',
  },
  mischievous: {
    type: 'sabotage',
    label: 'Sabotage',
    description: 'Reduces one enemy\'s attack by 40% for 2 rounds.',
  },
  shy: {
    type: 'vanish',
    label: 'Vanish',
    description: 'Becomes untargetable for 1 round.',
  },
  lazy: {
    type: 'cat_nap',
    label: 'Cat Nap',
    description: 'Skips a round but wakes with full HP restored.',
  },
  curious: {
    type: 'scout',
    label: 'Scout',
    description: 'Reveals weaknesses — all allies deal +25% damage for 2 rounds.',
  },
};

// Default for any unmatched trait
const DEFAULT_SPECIAL: SpecialAbility = SPECIAL_MAP['curious'];

// ── Derive a single cat's battle stats ──────────────────────────────────────

export function deriveConquestCat(cat: Cat, formation?: FormationDef): ConquestCat {
  // --- Base stats ---
  let hp = 50 + (cat.happiness ?? 50) * 0.5;
  let attack = 15;
  let defense = 10;
  let speed = (cat.energy ?? 50) * 0.8 + 10;
  let critChance = 0.05;
  let evasion = 0.05;

  // --- Major trait bonuses ---
  if (cat.majorTrait === 'hunter' || cat.majorTrait === 'zoomie') {
    attack += 20;
  } else if (cat.majorTrait === 'cuddler' || cat.majorTrait === 'social') {
    defense += 20;
  } else if (cat.majorTrait === 'diva') {
    defense += 15;
    hp += 10;
  } else if (cat.majorTrait === 'lazy') {
    hp += 25;
  }

  // --- Minor trait bonuses ---
  if (cat.minorTrait === 'mischievous') critChance += 0.15;
  if (cat.minorTrait === 'shy') evasion += 0.10;

  // --- Age bonus (+1 all per 7 days) ---
  const ageBonus = Math.floor((cat.ageDays ?? 0) / 7);
  hp += ageBonus;
  attack += ageBonus;
  defense += ageBonus;
  speed += ageBonus;

  // --- Rarity multiplier ---
  if (cat.isRare) {
    const rareMult =
      cat.rareType === 'golden' ? 1.50 :
      cat.rareType === 'royal'  ? 1.35 : 1.30;
    hp *= rareMult;
    attack *= rareMult;
    defense *= rareMult;
    speed *= rareMult;
  }

  // --- Mutation modifiers ---
  if (cat.mutation) {
    switch (cat.mutation) {
      case 'giant':    hp *= 1.50; break;
      case 'flaming':  attack *= 1.30; break;
      case 'frosted':  defense *= 1.30; break;
      case 'sparkly':  hp *= 1.15; attack *= 1.15; defense *= 1.15; speed *= 1.15; break;
      case 'angelic':  hp *= 1.25; defense *= 1.25; break;
      case 'gilded':   hp *= 1.20; attack *= 1.20; defense *= 1.20; speed *= 1.20; break;
      case 'tiny':     speed *= 1.40; hp *= 0.70; break;
      case 'chromatic': critChance += 0.20; break;
      case 'inverted': evasion += 0.15; break;
      case 'stinky':   break; // no combat effect
    }
  }

  // --- Life stage multiplier ---
  // Adults = 1.0x (2× teens), Teens = 0.50x (2× kittens), Kittens = 0.25x
  const stage = cat.stage || 'adult';
  const stageMult = stage === 'kitten' ? 0.25 : stage === 'teen' ? 0.50 : 1.0;
  hp *= stageMult;
  attack *= stageMult;
  defense *= stageMult;

  // --- Formation modifiers ---
  if (formation) {
    attack *= formation.attackMult;
    defense *= formation.defenseMult;
    critChance *= formation.critMult;
    evasion *= formation.evasionMult;
  }

  // --- Clamp ---
  hp = Math.max(10, Math.round(hp));
  attack = Math.max(1, Math.round(attack));
  defense = Math.max(0, Math.round(defense));
  speed = Math.max(1, Math.round(speed));
  critChance = Math.min(0.60, critChance);
  evasion = Math.min(0.50, evasion);

  // --- Special ability ---
  const special = SPECIAL_MAP[cat.majorTrait] ?? DEFAULT_SPECIAL;

  return {
    sourceId: cat.id,
    color: cat.color,
    pattern: cat.pattern,
    marking: cat.marking,
    stage,
    isRare: cat.isRare,
    rareType: cat.rareType,
    mutation: cat.mutation ?? null,
    majorTrait: cat.majorTrait,
    minorTrait: cat.minorTrait,

    hp,
    maxHp: hp,
    attack,
    defense,
    speed,
    critChance,
    evasion,

    special,
    specialUsed: false,

    name: cat.name,
    friendshipIds: cat.friendshipIds,

    // Runtime buffs & status effects
    attackBuff: 0,
    attackBuffRounds: 0,
    defenseBuff: 0,
    defenseBuffRounds: 0,
    damageBuff: 1.0,
    damageBuffRounds: 0,
    tauntedRounds: 0,
    vanishRounds: 0,
    attackDebuff: 1.0,
    attackDebuffRounds: 0,
    tauntSourceId: null,

    // Mutation & Synergy effects
    burnRounds: 0,
    burnDamage: 0,
    chillRounds: 0,
    shieldHp: 0,
    avengerRounds: 0,
  };
}


/**
 * Derives battle stats for the full sanctuary roster.
 * Includes kittens, teens, and adult cats.
 * Sorted by speed descending (fastest cats enter first).
 */
export function deriveConquestRoster(cats: Cat[], formation?: FormationDef): ConquestCat[] {
  const formationDef = formation ?? FORMATIONS[0];

  return cats
    .map((c) => deriveConquestCat(c, formationDef))
    .sort((a, b) => b.speed - a.speed);
}

