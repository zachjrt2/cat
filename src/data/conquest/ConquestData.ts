// ---------------------------------------------------------------------------
// Cat Conquest — Region Definitions & Enemy Generation
// ---------------------------------------------------------------------------

import type { RegionDef, EnemyCat, FormationDef } from './ConquestTypes';

// ── Region Definitions ──────────────────────────────────────────────────────

export const CONQUEST_REGIONS: RegionDef[] = [
  {
    index: 0,
    name: 'Nap Fields',
    emoji: '🌾',
    flavor: 'Sleepy tabby defenders who haven\'t been awake long enough to put up a real fight.',
    enemyCount: 30,
    invasionCost: 500,
    loveReward: 400,
    starReward: 1,
    statMultiplier: 0.55,
    isBoss: false,
  },
  {
    index: 1,
    name: 'Yarn Fort',
    emoji: '🧶',
    flavor: 'Defensive cats who\'ve tangled themselves into an impenetrable wool fortress.',
    enemyCount: 60,
    invasionCost: 800,
    loveReward: 640,
    starReward: 2,
    statMultiplier: 0.70,
    isBoss: false,
  },
  {
    index: 2,
    name: 'Fish Market',
    emoji: '🐟',
    flavor: 'Scrappy street cats with attitude and a strong smell of sardines.',
    enemyCount: 90,
    invasionCost: 1200,
    loveReward: 960,
    starReward: 3,
    statMultiplier: 0.85,
    isBoss: false,
  },
  {
    index: 3,
    name: 'Royal Palace',
    emoji: '👑',
    flavor: 'Pampered, well-fed palace cats with surprisingly high defense.',
    enemyCount: 120,
    invasionCost: 1800,
    loveReward: 1440,
    starReward: 4,
    statMultiplier: 1.0,
    isBoss: false,
  },
  {
    index: 4,
    name: 'Midnight Rooftops',
    emoji: '🌙',
    flavor: 'Nimble nocturnal cats who hunt in the dark. Fast, crit-heavy.',
    enemyCount: 150,
    invasionCost: 2500,
    loveReward: 2000,
    starReward: 5,
    statMultiplier: 1.15,
    isBoss: false,
  },
  {
    index: 5,
    name: 'The Wilderness',
    emoji: '🌿',
    flavor: 'Feral mutant cats who never knew the warmth of a home.',
    enemyCount: 180,
    invasionCost: 3500,
    loveReward: 2800,
    starReward: 6,
    statMultiplier: 1.30,
    isBoss: false,
  },
  {
    index: 6,
    name: 'Glacier Peaks',
    emoji: '❄️',
    flavor: 'Frosted rare cats hardened by the cold, their icy fur deflects blows.',
    enemyCount: 210,
    invasionCost: 5000,
    loveReward: 4000,
    starReward: 7,
    statMultiplier: 1.50,
    isBoss: false,
  },
  {
    index: 7,
    name: 'Sunstone Desert',
    emoji: '☀️',
    flavor: 'Golden rare cats forged under the blazing sun, worth their weight in power.',
    enemyCount: 240,
    invasionCost: 7000,
    loveReward: 5600,
    starReward: 8,
    statMultiplier: 1.75,
    isBoss: false,
  },
  {
    index: 8,
    name: 'Storm Citadel',
    emoji: '⛈️',
    flavor: 'A legendary horde assembled from the finest fighters across all territories.',
    enemyCount: 270,
    invasionCost: 10000,
    loveReward: 8000,
    starReward: 9,
    statMultiplier: 2.0,
    isBoss: false,
  },
  {
    index: 9,
    name: 'Crystal Throne',
    emoji: '💎',
    flavor: 'An epic 300-cat grand legion led by the ancient Golden Emperor of the Crystal Throne.',
    enemyCount: 300,
    invasionCost: 15000,
    loveReward: 12000,
    starReward: 10,
    statMultiplier: 2.5,
    isBoss: true,
  },
];



// ── Formation Definitions ────────────────────────────────────────────────────

export const FORMATIONS: FormationDef[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    emoji: '⚖️',
    description: 'No modifiers. Let your cats\' natural stats shine.',
    attackMult: 1.0,
    defenseMult: 1.0,
    critMult: 1.0,
    evasionMult: 1.0,
  },
  {
    id: 'phalanx',
    label: 'Phalanx',
    emoji: '🛡️',
    description: '+20% Defense, −10% Attack. Hold the line.',
    attackMult: 0.9,
    defenseMult: 1.2,
    critMult: 1.0,
    evasionMult: 1.0,
  },
  {
    id: 'rush',
    label: 'Rush',
    emoji: '💨',
    description: '+20% Attack, −10% Defense. Overwhelm them fast.',
    attackMult: 1.2,
    defenseMult: 0.9,
    critMult: 1.0,
    evasionMult: 1.0,
  },
  {
    id: 'scatter',
    label: 'Scatter',
    emoji: '⭐',
    description: 'Crits deal 2× damage, but evasion is halved.',
    attackMult: 1.0,
    defenseMult: 1.0,
    critMult: 2.0,
    evasionMult: 0.5,
  },
];

import { CAT_SKINS, CAT_MARKINGS } from '../catAssets';

let enemyIdCounter = 0;

function randomFrom<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Enemy Stat Scaling ───────────────────────────────────────────────────────

/**
 * Base enemy stats at multiplier=1.0 (Region 4, Royal Palace).
 * Scaled linearly by regionDef.statMultiplier.
 */
const BASE_ENEMY_HP = 70;
const BASE_ENEMY_ATTACK = 18;
const BASE_ENEMY_DEFENSE = 12;
const BASE_ENEMY_SPEED = 45;
const BASE_ENEMY_CRIT = 0.07;
const BASE_ENEMY_EVASION = 0.05;

export function generateEnemyBatch(region: RegionDef, count: number): EnemyCat[] {
  const mult = region.statMultiplier;
  const cats: EnemyCat[] = [];

  const normalSkins = CAT_SKINS.filter((s) => !s.isRare);
  const rareSkins = CAT_SKINS.filter((s) => s.isRare);

  for (let i = 0; i < count; i++) {
    const variance = () => 0.85 + Math.random() * 0.30;
    // Higher regions have a chance of rare enemy coat types!
    const isRare = region.index >= 6 && Math.random() < 0.35;
    const skin = isRare ? randomFrom(rareSkins) : randomFrom(normalSkins);
    const marking = randomFrom(CAT_MARKINGS);

    cats.push({
      id: `enemy_${++enemyIdCounter}`,
      color: skin.id,
      pattern: marking.id,
      hp: Math.round(BASE_ENEMY_HP * mult * variance()),
      maxHp: Math.round(BASE_ENEMY_HP * mult * variance()),
      attack: Math.round(BASE_ENEMY_ATTACK * mult * variance()),
      defense: Math.round(BASE_ENEMY_DEFENSE * mult * variance()),
      speed: Math.round(BASE_ENEMY_SPEED * mult * variance()),
      critChance: Math.min(0.45, BASE_ENEMY_CRIT * mult),
      evasion: Math.min(0.40, BASE_ENEMY_EVASION * mult),
      // Runtime buffs
      attackBuff: 0,
      attackBuffRounds: 0,
      defenseBuff: 0,
      defenseBuffRounds: 0,
      damageDebuff: 1.0,
      attackDebuff: 1.0,
      attackDebuffRounds: 0,
      vanishRounds: 0,
      tauntedRounds: 0,
      tauntSourceId: null,
      burnRounds: 0,
      burnDamage: 0,
      chillRounds: 0,
      shieldHp: 0,
    });
  }


  // Boss override: Region 10 — Grand Boss leads the 300-cat legion
  if (region.isBoss && cats.length > 0) {
    const boss = cats[0];
    boss.hp = Math.round(BASE_ENEMY_HP * mult * 2.5);
    boss.maxHp = boss.hp;
    boss.attack = Math.round(BASE_ENEMY_ATTACK * mult * 2.0);
    boss.defense = Math.round(BASE_ENEMY_DEFENSE * mult * 2.0);
    boss.speed = Math.round(BASE_ENEMY_SPEED * 1.5);
    boss.critChance = 0.25;
    boss.evasion = 0.15;
    boss.color = 'gold_0';
    boss.pattern = 'tabby';
  }

  return cats;
}

export const BATCH_SIZE = 10;
