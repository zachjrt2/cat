import type { Cat, GameState, ToolType } from '../data/types';

const MAX_ENTRIES_PER_CAT = 50;

export class JournalSystem {
  constructor(private state: GameState) {}

  log(cat: Cat, message: string): void {
    cat.journal.entries.push({ day: this.state.day, timestamp: Date.now(), message });
    if (cat.journal.entries.length > MAX_ENTRIES_PER_CAT) {
      cat.journal.entries.shift();
    }
  }

  recordInteraction(cat: Cat, tool: ToolType): void {
    switch (tool) {
      case 'food':
        cat.journal.totalTimesFed += 1;
        break;
      case 'pet':
        cat.journal.totalPetsReceived += 1;
        break;
      case 'wash':
        cat.journal.totalTimesWashed += 1;
        break;
      default:
        break;
    }
  }

  recordNap(cat: Cat, seconds: number): void {
    if (seconds > cat.journal.longestNapSeconds) {
      cat.journal.longestNapSeconds = seconds;
    }
  }
}
