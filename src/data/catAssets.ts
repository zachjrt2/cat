import type { RareCatType } from './types';

export interface CatSkinDef {
  id: string;
  label: string;
  file: string;
  hex: number;
  isRare?: boolean;
  rareType?: RareCatType;
  description?: string;
}

export const CAT_SKINS: CatSkinDef[] = [
  // Standard cozy coats
  { id: 'orange_0', label: 'Classic Ginger', file: 'orange_0.png', hex: 0xe8934a },
  { id: 'orange_1', label: 'Marmalade', file: 'orange_1.png', hex: 0xf58c38 },
  { id: 'orange_2', label: 'Amber Tiger', file: 'orange_2.png', hex: 0xdb7b2a },
  { id: 'orange_3', label: 'Honey Peach', file: 'orange_3.png', hex: 0xefa25c },
  { id: 'grey_0', label: 'Ash Grey', file: 'grey_0.png', hex: 0x8a929a },
  { id: 'grey_1', label: 'Silver Grey', file: 'grey_1.png', hex: 0xa8b0b8 },
  { id: 'grey_2', label: 'Charcoal Grey', file: 'grey_2.png', hex: 0x5a6068 },
  { id: 'white_0', label: 'Snow White', file: 'white_0.png', hex: 0xf5f6fa },
  { id: 'dark_0', label: 'Midnight Black', file: 'dark_0.png', hex: 0x2d2f36 },
  { id: 'white_grey_0', label: 'Classic Tuxedo', file: 'white_grey_0.png', hex: 0x4a4d57 },
  { id: 'white_grey_1', label: 'Bi-Color Grey', file: 'white_grey_1.png', hex: 0x7c838d },
  { id: 'peach_0', label: 'Soft Peach', file: 'peach_0.png', hex: 0xf6bba0 },
  { id: 'pink_0', label: 'Blush Pink', file: 'pink_0.png', hex: 0xf4a7b9 },
  { id: 'yellow_0', label: 'Buttercup', file: 'yellow_0.png', hex: 0xfcd05b },
  { id: 'teal_0', label: 'Seafoam Teal', file: 'teal_0.png', hex: 0x62b6b0 },
  { id: 'indigo_0', label: 'Velvet Indigo', file: 'indigo_0.png', hex: 0x6065a8 },
  { id: 'red_0', label: 'Crimson Rust', file: 'red_0.png', hex: 0xc45447 },
  { id: 'red_1', label: 'Auburn Fox', file: 'red_1.png', hex: 0xa94539 },

  // Special / Rare coats
  { id: 'seal_point_0', label: 'Seal Point Siamese', file: 'seal_point_0.png', hex: 0xd9c2ad, isRare: true, rareType: 'seal_point', description: 'Graceful Siamese with warm toasted points' },
  { id: 'hairless_0', label: 'Sphynx Peach', file: 'hairless_0.png', hex: 0xebaf9b, isRare: true, rareType: 'hairless', description: 'Wrinkly, warm-hearted hairless darling' },
  { id: 'hairless_1', label: 'Sphynx Grey', file: 'hairless_1.png', hex: 0x9e989b, isRare: true, rareType: 'hairless', description: 'Cozy velvety gray Sphynx' },
  { id: 'gold_0', label: 'Legendary Golden Cat', file: 'gold_0.png', hex: 0xffd700, isRare: true, rareType: 'golden', description: 'Shimmers with pure golden radiance (+Love boost)' },
  { id: 'ghost_0', label: 'Ethereal Ghost Cat', file: 'ghost_0.png', hex: 0xccddee, isRare: true, rareType: 'ghost', description: 'Mystical feline that glides like morning mist' },
  { id: 'radioactive_0', label: 'Neon Glow Cat', file: 'radioactive_0.png', hex: 0x55ff77, isRare: true, rareType: 'radioactive', description: 'Vibrant neon cat that lights up the garden' },
  { id: 'game_boy_0', label: 'Retro GameBoy DMG', file: 'game_boy_0.png', hex: 0x8bac0f, isRare: true, rareType: 'gameboy', description: 'Classic 4-shade olive dot-matrix cat' },
  { id: 'game_boy_1', label: 'GameBoy Pocket Silver', file: 'game_boy_1.png', hex: 0xa8b69f, isRare: true, rareType: 'gameboy', description: 'Crisp monochromatic handheld nostalgia' },
  { id: 'game_boy_2', label: 'GameBoy Color Lime', file: 'game_boy_2.png', hex: 0x9bbc0f, isRare: true, rareType: 'gameboy', description: 'Vibrant 90s handheld retro aesthetic' },
];

export interface MarkingDef {
  id: string;
  label: string;
  file: string;
}

export const CAT_MARKINGS: MarkingDef[] = [
  { id: 'none', label: 'None', file: '' },
  { id: 'tabby', label: 'Classic Tabby Stripes', file: 'Tabby Markings 000.png' },
  { id: 'socks', label: 'Four White Socks', file: 'Feet 000.png' },
  { id: 'front_left_foot', label: 'Left Front Mitten', file: 'Front Left Foot 000.png' },
  { id: 'front_right_foot', label: 'Right Front Mitten', file: 'Front Right Foot 000.png' },
  { id: 'back_left_foot', label: 'Left Back Boot', file: 'Back Left Foot 000.png' },
  { id: 'back_right_foot', label: 'Right Back Boot', file: 'Back Right Foot 000.png' },
  { id: 'face', label: 'Star Blaze Face', file: 'Face Marking 000.png' },
  { id: 'ears', label: 'Ears Tips', file: 'Ears 000.png' },
  { id: 'left_ear', label: 'Left Ear Tip', file: 'Left Ear 000.png' },
  { id: 'right_ear', label: 'Right Ear Tip', file: 'Right Ear 000.png' },
  { id: 'tail', label: 'Tail Tip Ring', file: 'Tail 000.png' },
];

export const CAT_COLORS = CAT_SKINS.map((s) => ({
  id: s.id,
  label: s.label,
  hex: s.hex,
}));

export const CAT_PATTERNS = CAT_MARKINGS.map((m) => ({
  id: m.id,
  label: m.label,
}));

export const MVP_COLOR_IDS = CAT_SKINS.filter((s) => !s.isRare).map((s) => s.id);

export const CAT_NAMES = [
  'Mochi', 'Pumpkin', 'Bean', 'Biscuit', 'Waffle', 'Noodle', 'Peanut',
  'Clover', 'Ash', 'Willow', 'Juniper', 'Marble', 'Pepper', 'Olive',
  'Hazel', 'Ginger', 'Toast', 'Muffin', 'Cinnamon', 'Sage', 'Plum',
  'Basil', 'Maple', 'Nutmeg', 'Chai', 'Cocoa', 'Fig', 'Pickle',
  'Boba', 'Miso', 'Wasabi', 'Dumpling', 'Tofu', 'Sprout', 'Comet',
  'Nimbus', 'Storm', 'Pebble', 'Moss', 'Fern', 'Casper', 'Pixel',
  'Butterscotch', 'Saffron', 'Apollo', 'Luna', 'Cleo', 'Ziggy', 'Milo',
];

export const FAVORITE_FOODS = [
  'Salmon Pate', 'Tuna Flakes', 'Roasted Chicken', 'Sweet Shrimp', 'Turkey Morsels',
  'Whitefish Broth', 'Tender Beef', 'Crispy Sardines', 'Cat Grass Treat',
];

export const FAVORITE_TOYS = [
  'Feather Wand', 'Rainbow Yarn Ball', 'Red Laser Pointer', 'Crinkle Mylar Ball',
  'Catnip Mouse', 'Cardboard Castle', 'Jingle Bell Ball', 'Fuzzy Pom Pom',
];
