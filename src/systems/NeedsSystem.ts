import type { Cat } from '../data/types';
import { NEEDS_CONFIG } from '../data/constants';

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Advances a single cat's needs by `deltaMinutes`.
 * Pure, low-stress by design: needs fall slowly and nothing "punishes" the
 * player beyond reduced Love generation and happiness (see GDD Pillar 1).
 */
export function tickCatNeeds(cat: Cat, deltaMinutes: number): void {
  const isSleeping = cat.animationState === 'sleep';
  const isZoomie = cat.majorTrait === 'zoomie' || cat.minorTrait === 'zoomie';

  // Hunger
  const hungerRate = NEEDS_CONFIG.hungerDecayPerMin * (isZoomie ? 1.3 : 1);
  cat.hunger = clamp(cat.hunger - hungerRate * deltaMinutes);

  // Cleanliness
  cat.cleanliness = clamp(cat.cleanliness - NEEDS_CONFIG.cleanlinessDecayPerMin * deltaMinutes);

  // Affection
  cat.affection = clamp(cat.affection - NEEDS_CONFIG.affectionDecayPerMin * deltaMinutes);

  // Fun
  cat.fun = clamp(cat.fun - NEEDS_CONFIG.funDecayPerMin * deltaMinutes);

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
