import type { Cat, CatArea } from '../data/types';
import { NEEDS_CONFIG, AUTOMATION_CATALOG } from '../data/constants';

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

export function getAutomationThresholdsForArea(machines: Record<string, number> | undefined, area: CatArea): {
  hunger: number;
  affection: number;
  cleanliness: number;
  fun: number;
} {
  const thresholds = {
    hunger: 0,
    affection: 0,
    cleanliness: 0,
    fun: 0,
  };
  if (!machines) return thresholds;

  for (const def of AUTOMATION_CATALOG) {
    if (def.area === area) {
      const level = machines[def.id] ?? 0;
      if (level > 0) {
        const target = level === 1 ? 50 : level === 2 ? 80 : 100;
        if (def.needType === 'food') {
          thresholds.hunger = Math.max(thresholds.hunger, target);
        } else if (def.needType === 'pet') {
          thresholds.affection = Math.max(thresholds.affection, target);
        } else if (def.needType === 'brush' || def.needType === 'wash') {
          thresholds.cleanliness = Math.max(thresholds.cleanliness, target);
        } else if (def.needType === 'toy') {
          thresholds.fun = Math.max(thresholds.fun, target);
        }
      }
    }
  }
  return thresholds;
}

export function applyAutomationThresholds(cat: Cat, machinesState: Record<string, number> | undefined): void {
  if (!machinesState) return;
  const thresholds = getAutomationThresholdsForArea(machinesState, cat.area);
  if (cat.hunger < thresholds.hunger) cat.hunger = thresholds.hunger;
  if (cat.affection < thresholds.affection) cat.affection = thresholds.affection;
  if (cat.cleanliness < thresholds.cleanliness) cat.cleanliness = thresholds.cleanliness;
  if (cat.fun < thresholds.fun) cat.fun = thresholds.fun;
  cat.happiness = computeHappiness(cat);
}

/**
 * Advances a single cat's needs by `deltaMinutes`.
 * Pure, low-stress by design: needs fall slowly and nothing "punishes" the
 * player beyond reduced Love generation and happiness (see GDD Pillar 1).
 * If automation machines exist in the cat's area, needs passively stay at or above the machine's tier threshold (Tier 1 50%, Tier 2 80%, Tier 3 100%).
 */
export function tickCatNeeds(cat: Cat, deltaMinutes: number, machinesState?: Record<string, number>): void {
  const isSleeping = cat.animationState === 'sleep';
  const isZoomie = cat.majorTrait === 'zoomie' || cat.minorTrait === 'zoomie';

  const thresholds = getAutomationThresholdsForArea(machinesState, cat.area);

  // Hunger
  const hungerRate = NEEDS_CONFIG.hungerDecayPerMin * (isZoomie ? 1.3 : 1);
  cat.hunger = clamp(cat.hunger - hungerRate * deltaMinutes, thresholds.hunger, 100);

  // Cleanliness
  cat.cleanliness = clamp(cat.cleanliness - NEEDS_CONFIG.cleanlinessDecayPerMin * deltaMinutes, thresholds.cleanliness, 100);

  // Affection
  cat.affection = clamp(cat.affection - NEEDS_CONFIG.affectionDecayPerMin * deltaMinutes, thresholds.affection, 100);

  // Fun
  cat.fun = clamp(cat.fun - NEEDS_CONFIG.funDecayPerMin * deltaMinutes, thresholds.fun, 100);

  // Energy: automatic, player cannot directly affect it (per GDD).
  if (isSleeping) {
    const isLazy = cat.majorTrait === 'lazy' || cat.minorTrait === 'lazy';
    const rate = NEEDS_CONFIG.sleepEnergyRecoverPerMin * (isLazy ? 1.25 : 1);
    cat.energy = clamp(cat.energy + rate * deltaMinutes);
  } else {
    // Slow drain while active, gentle recovery while idle/resting.
    const active = cat.animationState === 'run' || cat.animationState === 'play' || cat.animationState === 'walk';
    const rate = active ? -NEEDS_CONFIG.energyDrainPerMinActive : NEEDS_CONFIG.energyRecoverPerMinAwake;
    cat.energy = clamp(cat.energy + rate * deltaMinutes);
  }

  cat.happiness = computeHappiness(cat);
}

export function computeHappiness(cat: Cat): number {
  const isShy = cat.majorTrait === 'shy' || cat.minorTrait === 'shy';
  const social = cat.majorTrait === 'social' || cat.minorTrait === 'social';

  const friendCount = Object.values(cat.friendshipIds).filter((v) => v > 40).length;
  const relationshipBoost = isShy
    ? (friendCount === 0 ? 8 : 0)
    : social
      ? Math.min(friendCount * 4, 20)
      : Math.min(friendCount * 2, 10);

  const raw =
    cat.hunger * 0.25 +
    cat.cleanliness * 0.15 +
    cat.affection * 0.25 +
    cat.fun * 0.2 +
    cat.energy * 0.15 +
    relationshipBoost;

  return clamp(Math.round(raw));
}

export function shouldFallAsleep(cat: Cat): boolean {
  return cat.energy <= 15 && cat.animationState !== 'sleep';
}

export function shouldWakeUp(cat: Cat): boolean {
  return cat.animationState === 'sleep' && cat.energy >= 95;
}

export function isNeedLow(value: number): boolean {
  return value < NEEDS_CONFIG.lowNeedThreshold;
}
