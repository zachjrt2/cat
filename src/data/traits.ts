import type { MajorTrait } from './types';

export interface TraitDefinition {
  id: MajorTrait;
  label: string;
  description: string;
}

// One entry per personality trait described in the GDD's Personality System.
export const TRAITS: Record<MajorTrait, TraitDefinition> = {
  lazy: {
    id: 'lazy',
    label: 'Lazy',
    description: 'Sleeps longer. Generates passive Love while sleeping.',
  },
  zoomie: {
    id: 'zoomie',
    label: 'Zoomie',
    description: 'Runs frequently. Generates Fun for nearby cats. Gets hungry faster.',
  },
  diva: {
    id: 'diva',
    label: 'Diva',
    description: 'Wants attention. Bigger Love rewards.',
  },
  hunter: {
    id: 'hunter',
    label: 'Hunter',
    description: 'Finds gifts. Creates random events.',
  },
  curious: {
    id: 'curious',
    label: 'Curious',
    description: 'Investigates decorations. Discovers collectibles.',
  },
  social: {
    id: 'social',
    label: 'Social',
    description: 'Likes crowds. Makes friends faster.',
  },
  shy: {
    id: 'shy',
    label: 'Shy',
    description: 'Prefers isolated locations. Gains happiness alone.',
  },
  mischievous: {
    id: 'mischievous',
    label: 'Mischievous',
    description: 'Creates messes. Starts playful interactions.',
  },
  cuddler: {
    id: 'cuddler',
    label: 'Cuddler',
    description: 'Sleeps with friends. Relationship bonuses.',
  },
};

export const ALL_TRAITS = Object.keys(TRAITS) as MajorTrait[];

export function pickTwoDistinctTraits(rng: () => number = Math.random): [MajorTrait, MajorTrait] {
  const pool = [...ALL_TRAITS];
  const majorIndex = Math.floor(rng() * pool.length);
  const major = pool.splice(majorIndex, 1)[0];
  const minorIndex = Math.floor(rng() * pool.length);
  const minor = pool[minorIndex];
  return [major, minor];
}
