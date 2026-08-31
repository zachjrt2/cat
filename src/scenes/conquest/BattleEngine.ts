// ---------------------------------------------------------------------------
// Cat Conquest — 10-Lane Independent Queue Battle Engine
// Supports 10 independent vertical queues, mutation passives, and queue synergies.
// ---------------------------------------------------------------------------

import type {
  ConquestCat,
  EnemyCat,
  BattleState,
  BattleEvent,
  Formation,
} from '../../data/conquest/ConquestTypes';

export const NUM_LANES = 10;

type AnyUnit = ConquestCat | EnemyCat;

function isConquestCat(unit: AnyUnit): unit is ConquestCat {
  return 'sourceId' in unit;
}

// ── Damage Application with Shield Absorption & Reflection ──────────────────

interface DamageResult {
  actualHpLost: number;
  reflectedDmg: number;
}

function applyDamage(target: AnyUnit, rawDmg: number): DamageResult {
  let remaining = rawDmg;
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, remaining);
    target.shieldHp -= absorbed;
    remaining -= absorbed;
  }

  const prevHp = target.hp;
  target.hp = Math.max(0, target.hp - remaining);
  const actualHpLost = prevHp - target.hp;

  // Inverted & Chromatic reflection
  let reflectedDmg = 0;
  if (isConquestCat(target) && (target.mutation === 'inverted' || target.mutation === 'chromatic')) {
    reflectedDmg = Math.max(1, Math.round(actualHpLost * 0.25));
  }

  return { actualHpLost, reflectedDmg };
}

// ── Damage Calculation ──────────────────────────────────────────────────────

function calcDamage(
  attacker: AnyUnit,
  defender: AnyUnit,
  isCrit: boolean,
  formationCritMult: number,
): number {
  let baseAtk = attacker.attack + (attacker.attackBuff || 0);

  // Best friend morale bonus (+25% Atk)
  if (isConquestCat(attacker) && attacker.hasBestFriendAhead) {
    baseAtk *= 1.25;
  }

  const debuffMult = attacker.attackDebuff ?? 1.0;
  const dmgBuffMult = (attacker as ConquestCat).damageBuff ?? 1.0;
  const effectiveAtk = baseAtk * debuffMult * dmgBuffMult;

  let baseDef = defender.defense + (defender.defenseBuff || 0);

  // Protector line bonus (+25% Def)
  if (isConquestCat(defender) && defender.hasProtectorAhead) {
    baseDef *= 1.25;
  }

  const raw = Math.max(1, effectiveAtk - baseDef * 0.5);

  const variance = 0.9 + Math.random() * 0.2;
  let finalDmg = raw * variance;

  if (isCrit) {
    const critBonus = (attacker as ConquestCat).isRare ? 1.75 : 1.5;
    finalDmg *= critBonus * formationCritMult;
  }

  return Math.max(1, Math.round(finalDmg));
}

function rollCrit(attacker: AnyUnit): boolean {
  if (isConquestCat(attacker) && attacker.avengerRounds > 0) return true;
  return Math.random() < attacker.critChance;
}

function rollEvade(defender: AnyUnit): boolean {
  let evasion = defender.evasion;
  // Tiny cats get +30% bonus evasion
  if (isConquestCat(defender) && defender.mutation === 'tiny') evasion += 0.30;
  // Stinky cats cause attackers to miss (+30% effective evasion)
  if (isConquestCat(defender) && defender.mutation === 'stinky') evasion += 0.30;
  return Math.random() < Math.min(0.70, evasion);
}

// ── Buff & Status Expiration ────────────────────────────────────────────────

function tickBuffs(unit: AnyUnit): void {
  if (unit.attackBuffRounds > 0) {
    unit.attackBuffRounds--;
    if (unit.attackBuffRounds === 0) unit.attackBuff = 0;
  }
  if (unit.defenseBuffRounds > 0) {
    unit.defenseBuffRounds--;
    if (unit.defenseBuffRounds === 0) unit.defenseBuff = 0;
  }
  if (unit.attackDebuffRounds > 0) {
    unit.attackDebuffRounds--;
    if (unit.attackDebuffRounds === 0) unit.attackDebuff = 1.0;
  }
  if (unit.chillRounds > 0) {
    unit.chillRounds--;
    if (unit.chillRounds === 0) unit.attackDebuff = 1.0;
  }

  if (isConquestCat(unit)) {
    if (unit.damageBuffRounds > 0) {
      unit.damageBuffRounds--;
      if (unit.damageBuffRounds === 0) unit.damageBuff = 1.0;
    }
    if (unit.vanishRounds > 0) unit.vanishRounds--;
    if (unit.avengerRounds > 0) unit.avengerRounds--;
    if (unit.tauntedRounds > 0) {
      unit.tauntedRounds--;
      if (unit.tauntedRounds === 0) unit.tauntSourceId = null;
    }
  } else {
    if ((unit as EnemyCat).vanishRounds > 0) (unit as EnemyCat).vanishRounds--;
    if ((unit as EnemyCat).tauntedRounds > 0) {
      (unit as EnemyCat).tauntedRounds--;
      if ((unit as EnemyCat).tauntedRounds === 0) (unit as EnemyCat).tauntSourceId = null;
    }
  }
}

// ── Lane-Aware Target Selection ─────────────────────────────────────────────

function pickTargetForLane<T extends AnyUnit>(
  opposingLanes: T[][],
  attackerLane: number,
  attackerId?: string,
): { target: T; lane: number } | null {
  // Check if attacker is taunted
  if (attackerId) {
    for (let l = 0; l < opposingLanes.length; l++) {
      const front = opposingLanes[l][0];
      if (front && front.hp > 0) {
        const tSrc = isConquestCat(front) ? front.tauntSourceId : (front as EnemyCat).tauntSourceId;
        if (tSrc === attackerId) return { target: front, lane: l };
      }
    }
  }

  // Priority 1: Direct lane opponent
  const directOpponent = opposingLanes[attackerLane]?.[0];
  if (directOpponent && directOpponent.hp > 0 && directOpponent.vanishRounds === 0) {
    return { target: directOpponent, lane: attackerLane };
  }

  // Priority 2: Closest non-empty lane, broken by lowest HP
  let bestTarget: T | null = null;
  let bestLane = -1;
  let minDistance = 999;

  for (let l = 0; l < opposingLanes.length; l++) {
    const front = opposingLanes[l][0];
    if (!front || front.hp <= 0 || front.vanishRounds > 0) continue;

    const dist = Math.abs(l - attackerLane);
    if (dist < minDistance || (dist === minDistance && bestTarget && front.hp < bestTarget.hp)) {
      minDistance = dist;
      bestTarget = front;
      bestLane = l;
    }
  }

  return bestTarget ? { target: bestTarget, lane: bestLane } : null;
}

// ── Queue Synergies Evaluation ──────────────────────────────────────────────

export function applyQueueSynergies(state: BattleState): void {
  // Check Player Lanes
  state.playerLanes.forEach((lane) => {
    if (lane.length === 0) return;

    // 1. Coat Harmony: 3+ cats sharing color or pattern get +25% Max HP shield
    const patternCount: Record<string, number> = {};
    lane.forEach((c) => {
      const key = c.color || c.pattern;
      patternCount[key] = (patternCount[key] || 0) + 1;
    });
    const hasHarmony = Object.values(patternCount).some((cnt) => cnt >= 3);
    if (hasHarmony) {
      lane.forEach((c) => {
        c.hasCoatHarmony = true;
        if (c.shieldHp <= 0) c.shieldHp = Math.round(c.maxHp * 0.25);
      });
    }

    // 2. Best Friend & Protector checks for adjacent cats
    for (let r = 0; r < lane.length - 1; r++) {
      const front = lane[r];
      const behind = lane[r + 1];

      // Best Friend Duo: front cat gains +25% Attack morale
      if (front.friendshipIds && behind.sourceId && front.friendshipIds[behind.sourceId] >= 30) {
        front.hasBestFriendAhead = true;
      }

      // Protector Line: adult in front of kitten/teen gets +25% Defense
      if (front.stage === 'adult' && (behind.stage === 'kitten' || behind.stage === 'teen')) {
        front.hasProtectorAhead = true;
      }
    }
  });
}

// ── Vertical Queue Advancement & Death Passives ─────────────────────────────

function replenishLanes(state: BattleState, events: BattleEvent[]): void {
  let reinforced = false;

  // Player side
  for (let l = 0; l < NUM_LANES; l++) {
    const lane = state.playerLanes[l];
    while (lane.length > 0 && lane[0].hp <= 0) {
      const fallenCat = lane[0];
      lane.shift();
      reinforced = true;

      // When reserve cat steps up:
      if (lane.length > 0) {
        const nextCat = lane[0];

        // 1. Gilded / Sparkly Legacy Shield: grants +40 HP golden shield to next cat
        if (fallenCat.mutation === 'gilded' || fallenCat.mutation === 'sparkly') {
          nextCat.shieldHp += 40;
          events.push({
            type: 'shield',
            catId: nextCat.sourceId,
            amount: 40,
            description: `✨ Golden Legacy! ${nextCat.name || 'Sanctuary cat'} gained a +40 HP Shield!`,
          });
        }

        // 2. Avenger Enrage: friend gains 100% crit for 3 turns
        if (fallenCat.friendshipIds && nextCat.sourceId && fallenCat.friendshipIds[nextCat.sourceId] >= 30) {
          nextCat.avengerRounds = 3;
          events.push({
            type: 'avenger',
            catId: nextCat.sourceId,
            description: `🔥 AVENGER ENRAGE! ${nextCat.name || 'Friend'} seeks vengeance (100% Crit)!`,
          });
        }
      }
    }
  }

  // Enemy side
  for (let l = 0; l < NUM_LANES; l++) {
    const lane = state.enemyLanes[l];
    while (lane.length > 0 && lane[0].hp <= 0) {
      lane.shift();
      reinforced = true;
    }
  }

  // Refresh active lists
  state.activeFriendly = state.playerLanes.map((l) => l[0]).filter((c): c is ConquestCat => Boolean(c));
  state.activeEnemy = state.enemyLanes.map((l) => l[0]).filter((e): e is EnemyCat => Boolean(e));

  // Re-apply queue synergies for newly promoted cats
  applyQueueSynergies(state);

  if (reinforced) {
    events.push({ type: 'wave_start', playerWave: state.playerWaveNumber, enemyWave: state.enemyWaveNumber });
  }
}

function checkOutcome(state: BattleState): void {
  const playerAlive = state.playerLanes.some((l) => l.length > 0);
  const enemyAlive = state.enemyLanes.some((l) => l.length > 0);

  if (!enemyAlive) state.outcome = 'player_win';
  else if (!playerAlive) state.outcome = 'player_lose';
}

// ── BattleEngine ─────────────────────────────────────────────────────────────

export class BattleEngine {
  state: BattleState;
  private critMult: number;

  constructor(state: BattleState, critMult: number = 1) {
    this.state = state;
    this.critMult = critMult;
    applyQueueSynergies(this.state);
  }

  getFriendlyLane(catId: string): number {
    return this.state.playerLanes.findIndex((lane) => lane.length > 0 && lane[0].sourceId === catId);
  }

  getEnemyLane(enemyId: string): number {
    return this.state.enemyLanes.findIndex((lane) => lane.length > 0 && lane[0].id === enemyId);
  }

  /**
   * Resolve one round of combat across all active lanes.
   */
  tick(): BattleEvent[] {
    const events: BattleEvent[] = [];
    const { activeFriendly, activeEnemy } = this.state;

    if (this.state.outcome !== 'ongoing') return events;

    // ── 1. Burn Damage Ticks ────────────────────────────────────────────────
    [...activeFriendly, ...activeEnemy].forEach((unit) => {
      if (unit.burnRounds > 0 && unit.hp > 0) {
        const burnDmg = unit.burnDamage;
        unit.hp = Math.max(0, unit.hp - burnDmg);
        unit.burnRounds--;
        const id = isConquestCat(unit) ? unit.sourceId : unit.id;
        const side = isConquestCat(unit) ? 'player' : 'enemy';
        events.push({ type: 'burn', catId: id, damage: burnDmg, side });
        if (unit.hp === 0) {
          events.push({ type: 'ko', catId: id, side });
        }
      }
    });

    // ── 2. Angelic Halo Radiance (Heals reserve queue behind every 3 rounds) ─
    if (this.state.round % 3 === 0) {
      this.state.playerLanes.forEach((lane) => {
        if (lane.length > 0 && lane[0].hp > 0 && lane[0].mutation === 'angelic') {
          for (let r = 1; r < lane.length; r++) {
            const reserve = lane[r];
            if (reserve.hp > 0 && reserve.hp < reserve.maxHp) {
              reserve.hp = Math.min(reserve.maxHp, reserve.hp + 20);
              events.push({
                type: 'heal',
                catId: reserve.sourceId,
                amount: 20,
                description: `😇 Angelic Halo healed reserve ${reserve.name || 'cat'} (+20 HP)!`,
              });
            }
          }
        }
      });
    }

    // ── 3. Action Order by Speed ───────────────────────────────────────────
    type TurnUnit = { unit: AnyUnit; side: 'player' | 'enemy'; lane: number };
    const turnOrder: TurnUnit[] = [
      ...activeFriendly
        .filter((c) => c.hp > 0 && c.vanishRounds === 0)
        .map((u) => ({ unit: u as AnyUnit, side: 'player' as const, lane: this.getFriendlyLane(u.sourceId) })),
      ...activeEnemy
        .filter((e) => e.hp > 0 && e.vanishRounds === 0)
        .map((u) => ({ unit: u as AnyUnit, side: 'enemy' as const, lane: this.getEnemyLane(u.id) })),
    ].filter((t) => t.lane !== -1).sort((a, b) => b.unit.speed - a.unit.speed);

    for (const { unit, side, lane } of turnOrder) {
      if (unit.hp <= 0) continue; // already KO'd this round

      if (side === 'player') {
        const cat = unit as ConquestCat;
        const result = pickTargetForLane(this.state.enemyLanes, lane, cat.sourceId);
        if (!result) continue;
        const target = result.target;

        // Evasion check
        if (rollEvade(target)) continue;


        const isCrit = rollCrit(cat);
        const dmg = calcDamage(cat, target, isCrit, this.critMult);
        const { reflectedDmg } = applyDamage(target, dmg);

        events.push({ type: 'attack', attackerId: cat.sourceId, targetId: target.id, damage: dmg, isCrit, side: 'player' });

        // Mutation Passive: Flaming Burn
        if (cat.mutation === 'flaming' && target.hp > 0) {
          target.burnRounds = 2;
          target.burnDamage = Math.max(3, Math.round(cat.attack * 0.20));
        }

        // Mutation Passive: Frosted Chill Slow
        if (cat.mutation === 'frosted' && target.hp > 0) {
          target.chillRounds = 2;
          target.attackDebuff = 0.70;
        }

        // Mutation Passive: Giant Cleave (Splashes adjacent lanes)
        if (cat.mutation === 'giant') {
          const cleaveTargets: { id: string; damage: number }[] = [];
          for (const adjLane of [lane - 1, lane + 1]) {
            if (adjLane >= 0 && adjLane < NUM_LANES) {
              const adjEnemy = this.state.enemyLanes[adjLane]?.[0];
              if (adjEnemy && adjEnemy.hp > 0) {
                const splashDmg = Math.max(1, Math.round(dmg * 0.40));
                applyDamage(adjEnemy, splashDmg);
                cleaveTargets.push({ id: adjEnemy.id, damage: splashDmg });
                if (adjEnemy.hp === 0) events.push({ type: 'ko', catId: adjEnemy.id, side: 'enemy' });
              }
            }
          }
          if (cleaveTargets.length > 0) {
            events.push({ type: 'cleave', attackerId: cat.sourceId, targets: cleaveTargets, side: 'player' });
          }
        }

        // Damage Reflection back to attacker
        if (reflectedDmg > 0 && cat.hp > 0) {
          applyDamage(cat, reflectedDmg);
          if (cat.hp === 0) events.push({ type: 'ko', catId: cat.sourceId, side: 'player' });
        }

        if (target.hp === 0) {
          events.push({ type: 'ko', catId: target.id, side: 'enemy' });
        }
      } else {
        const enemy = unit as EnemyCat;
        const result = pickTargetForLane(this.state.playerLanes, lane, enemy.id);
        if (!result) continue;
        const target = result.target;

        // Evasion check (Tiny cats counter-attack on dodge!)
        if (rollEvade(target)) {
          if (target.mutation === 'tiny') {
            const counterDmg = Math.max(1, Math.round(target.attack * 0.75));
            applyDamage(enemy, counterDmg);
            events.push({ type: 'counter', attackerId: target.sourceId, targetId: enemy.id, damage: counterDmg, side: 'player' });
            if (enemy.hp === 0) events.push({ type: 'ko', catId: enemy.id, side: 'enemy' });
          }
          continue;
        }

        const isCrit = rollCrit(enemy);
        const dmg = calcDamage(enemy, target, isCrit, this.critMult);
        const { reflectedDmg } = applyDamage(target, dmg);

        events.push({ type: 'attack', attackerId: enemy.id, targetId: target.sourceId, damage: dmg, isCrit, side: 'enemy' });

        // Damage Reflection back to enemy
        if (reflectedDmg > 0 && enemy.hp > 0) {
          applyDamage(enemy, reflectedDmg);
          if (enemy.hp === 0) events.push({ type: 'ko', catId: enemy.id, side: 'enemy' });
        }

        if (target.hp === 0) {
          this.state.playerKoCount++;
          events.push({ type: 'ko', catId: target.sourceId, side: 'player' });
        }
      }
    }

    // Tick buffs for all active units
    [...activeFriendly, ...activeEnemy].forEach(tickBuffs);

    this.state.round++;

    // Advance lane queues vertically when cats fall & trigger death passives
    replenishLanes(this.state, events);

    // Check win/loss
    checkOutcome(this.state);

    if (this.state.outcome !== 'ongoing') {
      events.push({
        type: 'battle_end',
        outcome: this.state.outcome,
        playerKoCount: this.state.playerKoCount,
      });
    }

    return events;
  }

  /**
   * Player triggers a special ability for one of their active front-line cats.
   */
  triggerSpecial(sourceId: string): BattleEvent[] {
    const events: BattleEvent[] = [];
    const laneIdx = this.getFriendlyLane(sourceId);
    const cat = this.state.playerLanes[laneIdx]?.[0];
    if (!cat || cat.specialUsed || cat.hp <= 0) return events;

    cat.specialUsed = true;
    const ability = cat.special.type;

    switch (ability) {
      case 'pounce': {
        const result = pickTargetForLane(this.state.enemyLanes, laneIdx);
        if (result) {
          const dmg = Math.round(cat.attack * 3);
          applyDamage(result.target, dmg);
          events.push({ type: 'attack', attackerId: sourceId, targetId: result.target.id, damage: dmg, isCrit: true, side: 'player' });
          if (result.target.hp === 0) events.push({ type: 'ko', catId: result.target.id, side: 'enemy' });
        }
        break;
      }
      case 'zoom_blitz': {
        for (const enemy of this.state.activeEnemy.filter((e) => e.hp > 0)) {
          const dmg = Math.max(1, Math.round(cat.attack * 0.5));
          applyDamage(enemy, dmg);
          events.push({ type: 'attack', attackerId: sourceId, targetId: enemy.id, damage: dmg, isCrit: false, side: 'player' });
          if (enemy.hp === 0) events.push({ type: 'ko', catId: enemy.id, side: 'enemy' });
        }
        break;
      }
      case 'rally_cry': {
        this.state.activeFriendly.filter((c) => c.hp > 0).forEach((ally) => {
          ally.attackBuff += 20;
          ally.attackBuffRounds = Math.max(ally.attackBuffRounds, 3);
        });
        events.push({ type: 'buff', catId: sourceId, description: 'Rally Cry! +20 attack to all allies for 3 rounds.' });
        break;
      }
      case 'comfort': {
        const wounded = this.state.activeFriendly
          .filter((c) => c.hp > 0)
          .sort((a, b) => a.hp - b.hp)[0];
        if (wounded) {
          wounded.hp = Math.min(wounded.maxHp, wounded.hp + 40);
          events.push({ type: 'buff', catId: wounded.sourceId, description: `Comfort! Restored 40 HP to ${wounded.sourceId}.` });
        }
        break;
      }
      case 'taunt': {
        this.state.activeEnemy.filter((e) => e.hp > 0).forEach((enemy) => {
          enemy.tauntedRounds = 2;
          enemy.tauntSourceId = sourceId;
        });
        events.push({ type: 'buff', catId: sourceId, description: 'Taunt! All enemies must target this cat for 2 rounds.' });
        break;
      }
      case 'sabotage': {
        const result = pickTargetForLane(this.state.enemyLanes, laneIdx);
        if (result) {
          result.target.attackDebuff = 0.60;
          result.target.attackDebuffRounds = 2;
          events.push({ type: 'buff', catId: result.target.id, description: 'Sabotage! −40% attack for 2 rounds.' });
        }
        break;
      }
      case 'vanish': {
        cat.vanishRounds = 1;
        events.push({ type: 'buff', catId: sourceId, description: 'Vanish! Untargetable for 1 round.' });
        break;
      }
      case 'cat_nap': {
        cat.hp = cat.maxHp;
        events.push({ type: 'buff', catId: sourceId, description: 'Cat Nap! Full HP restored.' });
        break;
      }
      case 'scout': {
        this.state.activeFriendly.filter((c) => c.hp > 0).forEach((ally) => {
          ally.damageBuff = Math.max(ally.damageBuff, 1.25);
          ally.damageBuffRounds = Math.max(ally.damageBuffRounds, 2);
        });
        events.push({ type: 'buff', catId: sourceId, description: 'Scout! All allies deal +25% damage for 2 rounds.' });
        break;
      }
    }

    events.push({ type: 'special', catId: sourceId, ability, description: cat.special.description });
    return events;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createBattleState(
  playerCats: ConquestCat[],
  enemyCats: EnemyCat[],
  formation: Formation,
): BattleState {
  const playerLanes: ConquestCat[][] = Array.from({ length: NUM_LANES }, () => []);
  const enemyLanes: EnemyCat[][] = Array.from({ length: NUM_LANES }, () => []);

  // Distribute cats round-robin into the 10 lanes
  playerCats.forEach((cat, index) => {
    playerLanes[index % NUM_LANES].push(cat);
  });

  enemyCats.forEach((cat, index) => {
    enemyLanes[index % NUM_LANES].push(cat);
  });

  const activeFriendly = playerLanes.map((lane) => lane[0]).filter((c): c is ConquestCat => Boolean(c));
  const activeEnemy = enemyLanes.map((lane) => lane[0]).filter((e): e is EnemyCat => Boolean(e));

  return {
    formation,
    allPlayerCats: playerCats,
    allEnemyCats: enemyCats,
    playerLanes,
    enemyLanes,
    activeFriendly,
    activeEnemy,
    playerBatchStart: activeFriendly.length,
    enemyBatchStart: activeEnemy.length,
    round: 0,
    playerWaveNumber: 1,
    enemyWaveNumber: 1,
    outcome: 'ongoing',
    playerKoCount: 0,
  };
}
