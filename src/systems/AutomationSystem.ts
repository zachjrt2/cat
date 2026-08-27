import type { AutomationMachineDef, AutomationNeedType, Cat, CatArea, GameState } from '../data/types';
import { AUTOMATION_CATALOG } from '../data/constants';
import { LoveManager } from './LoveManager';
import { sound } from './SoundManager';
import { EventBus } from '../ui/EventBus';

export interface MachineUseResult {
  cat: Cat;
  machine: AutomationMachineDef;
  level: number;
  needRestored: number;
  loveEarned: number;
  message: string;
}

export class AutomationSystem {
  constructor(
    private state: GameState,
    private love: LoveManager,
  ) {}

  getMachineDef(machineId: string): AutomationMachineDef | undefined {
    return AUTOMATION_CATALOG.find((m) => m.id === machineId);
  }

  getMachineLevel(machineId: string): number {
    return this.state.machines[machineId] ?? 0;
  }

  getMachinesInArea(area: CatArea): Array<{ def: AutomationMachineDef; level: number }> {
    const list: Array<{ def: AutomationMachineDef; level: number }> = [];
    for (const def of AUTOMATION_CATALOG) {
      if (def.area === area) {
        const level = this.getMachineLevel(def.id);
        if (level > 0) {
          list.push({ def, level });
        }
      }
    }
    return list;
  }

  buyMachine(machineId: string): boolean {
    const def = this.getMachineDef(machineId);
    if (!def) return false;

    if (this.getMachineLevel(machineId) > 0) {
      EventBus.emit('toast', { message: `You already own ${def.name}!` });
      return false;
    }

    if (!this.love.spend(def.baseCost)) {
      EventBus.emit('toast', { message: `Need ${def.baseCost} 💗 to purchase ${def.name}.` });
      return false;
    }

    this.state.machines[machineId] = 1;
    sound.playAdoptFanfare();
    EventBus.emit('toast', { message: `✨ Installed ${def.name} in ${def.area.toUpperCase()}!` });
    return true;
  }

  upgradeMachine(machineId: string): boolean {
    const def = this.getMachineDef(machineId);
    if (!def) return false;

    const currentLevel = this.getMachineLevel(machineId);
    if (currentLevel === 0) {
      EventBus.emit('toast', { message: 'Must purchase machine before upgrading.' });
      return false;
    }

    if (currentLevel >= 3) {
      EventBus.emit('toast', { message: `${def.name} is already at max level (Tier 3)!` });
      return false;
    }

    const cost = currentLevel === 1 ? def.upgradeCostLvl2 : def.upgradeCostLvl3;
    if (!this.love.spend(cost)) {
      EventBus.emit('toast', { message: `Need ${cost} 💗 to upgrade ${def.name} to Tier ${currentLevel + 1}.` });
      return false;
    }

    this.state.machines[machineId] = currentLevel + 1;
    sound.playSparkle();
    EventBus.emit('toast', { message: `🚀 Upgraded ${def.name} to Tier ${currentLevel + 1}!` });
    return true;
  }

  /**
   * Called when a cat uses an automation machine.
   * Restores the need and generates bonus Love based on the machine's tier.
   */
  useMachine(cat: Cat, machineId: string): MachineUseResult | null {
    const def = this.getMachineDef(machineId);
    if (!def) return null;

    const level = this.getMachineLevel(machineId);
    if (level === 0) return null;

    const tierThreshold = level === 1 ? 50 : level === 2 ? 80 : 100;
    const loveBonus = level === 1 ? 2 : level === 2 ? 5 : 10;

    let restored = 0;
    switch (def.needType) {
      case 'food':
        if (cat.hunger < tierThreshold) {
          const prev = cat.hunger;
          cat.hunger = Math.min(tierThreshold, cat.hunger + 35);
          restored = cat.hunger - prev;
        }
        break;
      case 'pet':
        if (cat.affection < tierThreshold) {
          const prev = cat.affection;
          cat.affection = Math.min(tierThreshold, cat.affection + 35);
          restored = cat.affection - prev;
        }
        break;
      case 'brush':
      case 'wash':
        if (cat.cleanliness < tierThreshold) {
          const prev = cat.cleanliness;
          cat.cleanliness = Math.min(tierThreshold, cat.cleanliness + 35);
          restored = cat.cleanliness - prev;
        }
        break;
      case 'toy':
        if (cat.fun < tierThreshold) {
          const prev = cat.fun;
          cat.fun = Math.min(tierThreshold, cat.fun + 35);
          restored = cat.fun - prev;
        }
        break;
    }

    this.love.add(loveBonus);
    this.state.totalLoveEarned += loveBonus;

    const message = `${cat.name} used ${def.name} (Tier ${level}, up to ${tierThreshold}%)! (+${loveBonus} 💗)`;
    return {
      cat,
      machine: def,
      level,
      needRestored: restored,
      loveEarned: loveBonus,
      message,
    };
  }

  /**
   * Finds the closest relevant machine for a cat needing a specific care type.
   */
  findMachineForNeed(cat: Cat, needType: AutomationNeedType): AutomationMachineDef | null {
    const owned = this.getMachinesInArea(cat.area);
    const match = owned.find((m) => m.def.needType === needType);
    return match ? match.def : null;
  }
}
