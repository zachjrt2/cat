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

    const restoreAmount = level === 1 ? 45 : level === 2 ? 75 : 100;
    const loveBonus = level === 1 ? 2 : level === 2 ? 5 : 10;

    switch (def.needType) {
      case 'food':
        cat.hunger = Math.min(100, cat.hunger + restoreAmount);
        break;
      case 'pet':
        cat.affection = Math.min(100, cat.affection + restoreAmount);
        break;
      case 'brush':
        cat.cleanliness = Math.min(100, cat.cleanliness + restoreAmount);
        break;
      case 'toy':
        cat.fun = Math.min(100, cat.fun + restoreAmount);
        break;
      case 'wash':
        cat.cleanliness = 100;
        break;
    }

    this.love.add(loveBonus);
    this.state.totalLoveEarned += loveBonus;

    const message = `${cat.name} enjoyed using ${def.name} (Tier ${level})! (+${loveBonus} 💗)`;
    return {
      cat,
      machine: def,
      level,
      needRestored: restoreAmount,
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
