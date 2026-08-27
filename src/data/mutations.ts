import type { CatMutationType } from './types';

export interface MutationDefinition {
  id: CatMutationType;
  label: string;
  badgeLabel: string;
  tagBg: string;
  tagColor: string;
  borderHex: string;
  description: string;
  perk: string;
  scaleMultiplier: number;
  meowPitch: number; // Pitch offset/rate for sound effects
}

export const MUTATION_CATALOG: Record<CatMutationType, MutationDefinition> = {
  giant: {
    id: 'giant',
    label: 'Giant',
    badgeLabel: 'Giant Mutation',
    tagBg: '#fef3c7',
    tagColor: '#92400e',
    borderHex: '#f59e0b',
    description: 'A massive, lovable giant cat with a booming deep purr.',
    perk: '+50% Care Point rewards from petting, washing, and brushing.',
    scaleMultiplier: 1.55,
    meowPitch: 0.72,
  },
  tiny: {
    id: 'tiny',
    label: 'Tiny',
    badgeLabel: 'Tiny Mutation',
    tagBg: '#ecfdf5',
    tagColor: '#065f46',
    borderHex: '#10b981',
    description: 'An adorable pocket-sized micro cat with high squeaky meows.',
    perk: '25% faster move speed; fun & affection fill 30% faster.',
    scaleMultiplier: 0.58,
    meowPitch: 1.45,
  },
  stinky: {
    id: 'stinky',
    label: 'Stinky',
    badgeLabel: 'Stinky Mutation',
    tagBg: '#f0fdf4',
    tagColor: '#166534',
    borderHex: '#4ade80',
    description: 'Hilariously emits gentle cartoon green stink puffs when wandering.',
    perk: 'Washing this cat creates giant soap bubbles & awards bonus Care Points.',
    scaleMultiplier: 1.0,
    meowPitch: 1.0,
  },
  sparkly: {
    id: 'sparkly',
    label: 'Sparkly',
    badgeLabel: 'Sparkly Mutation',
    tagBg: '#fdf4ff',
    tagColor: '#86198f',
    borderHex: '#d946ef',
    description: 'Radiates a continuous trail of cosmic stardust and glittering sparkles.',
    perk: 'Playing with toys has a chance to grant +1 Star Token.',
    scaleMultiplier: 1.0,
    meowPitch: 1.15,
  },
  inverted: {
    id: 'inverted',
    label: 'Inverted',
    badgeLabel: 'Inverted Mutation',
    tagBg: '#e0e7ff',
    tagColor: '#3730a3',
    borderHex: '#6366f1',
    description: 'Possesses inverted photonegative colors and radiant luminous eyes.',
    perk: 'Immune to night-time drowsiness; loves nighttime play & dark rooms.',
    scaleMultiplier: 1.0,
    meowPitch: 0.95,
  },
  chromatic: {
    id: 'chromatic',
    label: 'Chromatic',
    badgeLabel: 'Chromatic Mutation',
    tagBg: '#fae8ff',
    tagColor: '#701a75',
    borderHex: '#c026d3',
    description: 'Prismatically shifts through shimmering rainbow hues over time.',
    perk: 'Radiates an aura of pure joy that boosts nearby cats\' happiness.',
    scaleMultiplier: 1.0,
    meowPitch: 1.05,
  },
  flaming: {
    id: 'flaming',
    label: 'Flaming',
    badgeLabel: 'Flaming Mutation',
    tagBg: '#fff7ed',
    tagColor: '#9a3412',
    borderHex: '#f97316',
    description: 'Leaves warm, glowing ember footprints everywhere it steps.',
    perk: 'Keeps neighboring cats warm and cozy during cold or rainy weather.',
    scaleMultiplier: 1.0,
    meowPitch: 1.0,
  },
  frosted: {
    id: 'frosted',
    label: 'Frosted',
    badgeLabel: 'Frosted Mutation',
    tagBg: '#f0f9ff',
    tagColor: '#075985',
    borderHex: '#38bdf8',
    description: 'Glazed with a delicate crystal frost and falling snowflakes.',
    perk: 'Loves water dishes & fountains; cleanliness drains 50% slower.',
    scaleMultiplier: 1.0,
    meowPitch: 1.1,
  },
  angelic: {
    id: 'angelic',
    label: 'Angelic',
    badgeLabel: 'Angelic Mutation',
    tagBg: '#fefce8',
    tagColor: '#854d0e',
    borderHex: '#eab308',
    description: 'Blessed with a floating golden halo and ethereal peaceful light.',
    perk: 'Emits a calming aura that pacifies stressed or needy cats in the room.',
    scaleMultiplier: 1.0,
    meowPitch: 1.2,
  },
  gilded: {
    id: 'gilded',
    label: 'Gilded',
    badgeLabel: 'Gilded Mutation',
    tagBg: '#fef9c3',
    tagColor: '#713f12',
    borderHex: '#ca8a04',
    description: 'Coated in glistening Midas gold that sparkles brightly under the light.',
    perk: 'Grants a 2x Care Points multiplier across all direct care interactions.',
    scaleMultiplier: 1.0,
    meowPitch: 1.0,
  },
};

export const ALL_MUTATIONS: CatMutationType[] = Object.keys(MUTATION_CATALOG) as CatMutationType[];

export function rollRandomMutation(rng: () => number = Math.random): CatMutationType {
  const index = Math.floor(rng() * ALL_MUTATIONS.length);
  return ALL_MUTATIONS[index];
}
