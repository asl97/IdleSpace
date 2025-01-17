import { Enemy } from "./enemy";
import { ISalvable } from "../base/ISalvable";
import { BattleService } from "src/app/battle.service";
import { FleetManager } from "../fleet/fleetManager";
import { BattleRequest } from "src/app/workers/battleRequest";
import { Reward } from "./reward";
import { ResourceManager } from "../resource/resourceManager";
import { Emitters } from "src/app/emitters";
import { SearchJob } from "./searchJob";
import { RomanPipe } from "src/app/roman.pipe";
import { AllSkillEffects } from "../prestige/allSkillEffects";
import { DarkMatterManager } from "../darkMatter/darkMatterManager";
import { PrestigeManager } from "../prestige/prestigeManager";
import { OptionsService } from "src/app/options.service";
import { MainService } from "src/app/main.service";
import { ResearchManager } from "../research/researchManager";
import { sample } from "lodash-es";
import { NukeAction } from "../actions/nukeAction";
import { BonusStack } from "../bonus/bonusStack";
import { ZERO_DECIMAL_IMMUTABLE } from "../game";
import { Bonus } from "../bonus/bonus";
import { AutomatorManager } from "../automators/automatorManager";
import { ShipDesign } from "../fleet/shipDesign";
import { MyFromDecimal } from "../utility/myUtility";

export const MAX_ENEMY_LIST_SIZE = 10;
const DARK_MATTER_START_LEVEL = 2;
const DARK_MATTER_MULTI = 3;
const METAL_REWARD = 500;
const CRYSTAL_REWARD = 350;
const ALLOY_REWARD = 250;
const RESEARCH_REWARD = 2e3;
const ROBOT_REWARD = 0.5;
const SHIPYARD_REWARD = 200;
export const MISSILE_DAMAGE = 2500;
const SEARCH_REWARD = 300;
export const TERRAFORMER_MULTI = 0.01;

const RANDOM_REWARDS = [
  Reward.HabitableSpace,
  Reward.MetalMine,
  Reward.CrystalMine,
  Reward.Robot,
  Reward.Alloy,
  Reward.Enemy
  // Reward.Shipyard
];
export class EnemyManager implements ISalvable {
  private static instance: EnemyManager;
  static NewOnTop = false;

  static romanPipe = new RomanPipe();

  currentEnemy: Enemy;
  allEnemy = new Array<Enemy>();
  maxLevel = 1;
  inBattle = false;

  searchJobs = new Array<SearchJob>();
  fightEnemy: Enemy;

  moreMetal = false;
  moreCrystal = false;
  moreHabitable = false;
  moreHabitable2 = false;
  randomized = false;
  moreRobot = false;

  nukeAction: NukeAction;
  missileDamageBonus = new BonusStack();
  autoNuke = false;
  autoNext = true;

  prestigeModal = false;
  ascendModal = false;
  totalTime = 0;
  mergeLevel = 0;
  currentMerge = 0;
  rewardMessage = "";
  rewardMessages: Array<[string, Decimal]> = [];

  static getInstance(): EnemyManager {
    return EnemyManager.instance;
  }
  constructor() {
    EnemyManager.instance = this;
    this.nukeAction = new NukeAction();
    this.missileDamageBonus.multiplicativeBonus.push(
      new Bonus(AllSkillEffects.DOUBLE_MISSILE, 2.5)
    );
    this.missileDamageBonus.multiplicativeBonus.push(
      new Bonus(ResourceManager.getInstance().beamSatellite, TERRAFORMER_MULTI)
    );
  }
  generate(searchJob: SearchJob) {
    if (EnemyManager.NewOnTop) this.allEnemy.unshift(Enemy.generate(searchJob));
    else this.allEnemy.push(Enemy.generate(searchJob));
  }
  attack(enemy: Enemy): boolean {
    if (this.currentEnemy) return false;
    this.currentEnemy = enemy;
    this.allEnemy = this.allEnemy.filter(e => e !== enemy);
    this.currentEnemy.generateZones();
    return true;
  }
  startBattle() {
    if (this.inBattle || !this.currentEnemy) return false;
    this.fightEnemy = this.currentEnemy;

    //  Merge tiles
    while (
      this.currentMerge < this.mergeLevel &&
      this.currentMerge + this.currentEnemy.currentZone.number < 99
    ) {
      this.currentMerge++;
      const zoneToMerge = this.currentEnemy.zones[
        this.currentEnemy.currentZone.number + this.currentMerge
      ];
      zoneToMerge.generateShips(this.currentEnemy.shipsDesign);
      zoneToMerge.ships.forEach(ship => {
        zoneToMerge.mergedOrigin = this.currentEnemy.currentZone;
        const originalShip = this.currentEnemy.currentZone.ships.find(
          s => s.name === ship.name
        );
        if (originalShip) {
          originalShip.quantity = originalShip.quantity.plus(ship.quantity);
        } else {
          this.currentEnemy.currentZone.ships.push(ship);
        }
      });
      this.currentEnemy.currentZone.originalNavCap = ShipDesign.GetTotalNavalCap(
        this.currentEnemy.currentZone.ships
      );
      zoneToMerge.ships = [];
    }

    Emitters.getInstance().battleEndEmitter.emit(1);
    this.inBattle = true;
    FleetManager.getInstance().reload();
    this.currentEnemy.currentZone.reload();

    const battleRequest = new BattleRequest();
    battleRequest.minTime = FleetManager.getInstance().timePerFight - 0.1;
    battleRequest.minTime = Math.max(battleRequest.minTime, 0);
    battleRequest.playerFleet = FleetManager.getInstance().ships.map(s =>
      s.getShipData()
    );
    battleRequest.enemyFleet = this.currentEnemy.currentZone.ships.map(s =>
      s.getShipData()
    );
    const battleService = BattleService.getInstance();
    if (battleService) battleService.battleWorker.postMessage(battleRequest);
  }
  onBattleEnd(result: BattleResult) {
    if (
      !this.inBattle ||
      !this.currentEnemy ||
      this.fightEnemy !== this.fightEnemy
    ) {
      this.inBattle = false;
      return false;
    }
    this.inBattle = false;

    // console.log("On Battle End");
    result.enemyLost.forEach(e => {
      const ship = this.currentEnemy.currentZone.ships.find(s => s.id === e[0]);
      if (ship) {
        ship.quantity = ship.quantity.minus(MyFromDecimal(e[1]));
        if (ship.quantity.lt(1)) {
          this.currentEnemy.currentZone.ships = this.currentEnemy.currentZone.ships.filter(
            s => s !== ship
          );
        }
      }
    });
    result.playerLost.forEach(e => {
      const ship = FleetManager.getInstance().ships.find(s => s.id === e[0]);
      ship.quantity = ship.quantity.minus(MyFromDecimal(e[1]));
      ship.quantity = ship.quantity.max(0);
    });
    this.currentEnemy.currentZone.reload();
    for (let n = 0; n <= this.currentMerge; n++) {
      const mergedZone = this.currentEnemy.zones[
        this.currentEnemy.currentZone.number + n
      ];
      mergedZone.reload();
    }

    //#region Win
    if (result.result === "1") {
      this.currentEnemy.currentZone.ships = null;
      this.currentEnemy.currentZone.originalNavCap = null;
      //#region Reward
      this.rewardMessage = "";
      this.rewardMessages = [];

      for (let n = 0; n <= this.currentMerge; n++) {
        const mergedZone = this.currentEnemy.zones[
          this.currentEnemy.currentZone.number + n
        ];
        this.rewardPlayer(mergedZone.reward);
      }
      try {
        if (OptionsService.battleWinNotification) {
          this.rewardMessages.forEach(e => {
            this.rewardMessage =
              this.rewardMessage +
              "+ " +
              MainService.formatPipe.transform(e[1]) +
              " " +
              e[0] +
              "<br/>";
          });
          MainService.toastr.success(this.rewardMessage, "Battle Win", {
            enableHtml: true
          });
        }
      } catch (ex) {}
      //#endregion
      //#region Dark Matter
      if (this.currentEnemy.level >= DARK_MATTER_START_LEVEL) {
        const darkMatter = ResourceManager.getInstance().inactiveDarkMatter;
        DarkMatterManager.getInstance().darkMatter.unlock();
        darkMatter.unlock();
        darkMatter.quantity = darkMatter.quantity.plus(
          this.currentEnemy.level *
            DARK_MATTER_MULTI *
            (AllSkillEffects.DOUBLE_DARK_MATTER.numOwned * 2 + 1)
        );
      }
      //#endregion
      if (this.currentEnemy.currentZone.number + this.currentMerge >= 99) {
        if (this.currentEnemy.level === 1 && this.maxLevel === 1) {
          this.prestigeModal = true;
        }
        if (
          this.currentEnemy.level === 20 &&
          this.maxLevel === 20 &&
          PrestigeManager.getInstance().ascension === 0
        ) {
          this.ascendModal = true;
        }

        this.maxLevel = Math.max(this.maxLevel, this.currentEnemy.level + 1);
        this.currentEnemy = null;
        if (this.autoNext && this.allEnemy.length > 0) {
          this.attack(this.allEnemy[0]);
        }
        PrestigeManager.getInstance().reloadPrestigeToEarn();
        const am = AutomatorManager.getInstance();
        if (am) am.searchAutomator.enemyDefeated = true;

        try {
          if (OptionsService.enemyDefeatedNotification) {
            MainService.toastr.success("", "Enemy Defeated");
          }
        } catch (ex) {}
      } else {
        for (let n = 0; n <= this.currentMerge; n++) {
          const mergedZone = this.currentEnemy.zones[
            this.currentEnemy.currentZone.number + n
          ];
          mergedZone.completed = true;
          mergedZone.reload();
        }
        this.currentEnemy.currentZone.completed = true;
        this.currentEnemy.currentZone.reload();
        this.currentEnemy.currentZone = this.currentEnemy.zones[
          this.currentEnemy.currentZone.number + 1 + this.currentMerge
        ];
        this.currentEnemy.currentZone.generateShips(
          this.currentEnemy.shipsDesign
        );
        this.currentEnemy.currentZone.reload();
      }
      this.currentMerge = 0;
    }
    //#endregion

    this.inBattle = false;
    FleetManager.getInstance().setFight();
  }
  /**
   * Reward player for winning a battle
   * if reward is null give a random reward
   */
  private rewardPlayer(reward: Reward) {
    const resMan = ResourceManager.getInstance();
    let gain = new Decimal();

    const addSpace = !!reward;
    if (!reward) {
      reward = sample(RANDOM_REWARDS);
      if (
        reward === Reward.Enemy &&
        !ResourceManager.getInstance().searchX1.unlocked
      ) {
        reward = Reward.MetalMine;
      }
    }
    if (reward) {
      let prestigeMulti = new Decimal(1).plus(
        ResearchManager.getInstance().scavenger.quantity.times(0.1)
      );
      prestigeMulti = prestigeMulti.times(
        AllSkillEffects.DOUBLE_BATTLE_GAIN.numOwned * 2 + 1
      );
      const gainDistrict = prestigeMulti
        .times(this.currentEnemy.level)
        .times(
          new Decimal(1).plus(resMan.terraformer.getQuantity().times(0.05))
        )
        .times(AllSkillEffects.DOUBLE_DISTRICTS.numOwned + 1);
      switch (reward) {
        case Reward.HabitableSpace:
          if (addSpace) {
            resMan.habitableSpace.quantity = resMan.habitableSpace.quantity.plus(
              gainDistrict
            );
            this.addOrUpdateMessages(resMan.habitableSpace.name, gainDistrict);
          }
          gain = new Decimal(RESEARCH_REWARD * this.currentEnemy.level).times(
            prestigeMulti
          );
          ResearchManager.getInstance().update(gain);
          break;

        case Reward.MetalMine:
          if (addSpace) {
            resMan.miningDistrict.quantity = resMan.miningDistrict.quantity.plus(
              gainDistrict
            );
            this.addOrUpdateMessages(resMan.miningDistrict.name, gainDistrict);
          }
          gain = new Decimal(METAL_REWARD * this.currentEnemy.level).times(
            prestigeMulti
          );
          resMan.metal.quantity = resMan.metal.quantity.plus(gain);
          resMan.metal.quantity = resMan.metal.quantity.min(resMan.metal.limit);
          this.addOrUpdateMessages(resMan.metal.name, gain);
          break;

        case Reward.CrystalMine:
          if (addSpace) {
            resMan.crystalDistrict.quantity = resMan.crystalDistrict.quantity.plus(
              gainDistrict
            );
            this.addOrUpdateMessages(resMan.crystalDistrict.name, gainDistrict);
          }
          gain = new Decimal(CRYSTAL_REWARD * this.currentEnemy.level).times(
            prestigeMulti
          );
          resMan.crystal.quantity = resMan.crystal.quantity.plus(gain);
          resMan.crystal.quantity = resMan.crystal.quantity.min(
            resMan.crystal.limit
          );
          this.addOrUpdateMessages(resMan.crystal.name, gain);
          break;

        case Reward.Robot:
          gain = new Decimal(ROBOT_REWARD * this.currentEnemy.level).times(
            prestigeMulti
          );
          resMan.drone.unlock();
          resMan.drone.quantity = resMan.drone.quantity.plus(gain);
          resMan.drone.quantity = resMan.drone.quantity.min(resMan.drone.limit);
          this.addOrUpdateMessages(resMan.drone.name, gain);
          break;

        case Reward.Alloy:
          gain = new Decimal(ALLOY_REWARD * this.currentEnemy.level).times(
            prestigeMulti
          );
          resMan.alloy.quantity = resMan.alloy.quantity.plus(gain);
          resMan.alloy.quantity = resMan.alloy.quantity.min(resMan.alloy.limit);
          this.addOrUpdateMessages(resMan.alloy.name, gain);
          break;

        case Reward.Enemy:
          gain = new Decimal(SEARCH_REWARD * this.currentEnemy.level).times(
            prestigeMulti
          );
          this.addProgress(gain);
          this.addOrUpdateMessages(resMan.searchProgress.name, gain);
          break;
        case Reward.Shipyard:
          gain = new Decimal(SHIPYARD_REWARD * this.currentEnemy.level).times(
            prestigeMulti
          );
          resMan.shipyardProgress.quantity = resMan.shipyardProgress.quantity.plus(
            gain
          );
          this.addOrUpdateMessages(resMan.shipyardProgress.name, gain);
          break;
      }
    }
  }

  private addOrUpdateMessages(what: string, quantity: Decimal) {
    let elem = this.rewardMessages.find(e => e[0] === what);
    if (!elem) {
      elem = [what, quantity];
      this.rewardMessages.push(elem);
    } else {
      elem[1] = elem[1].plus(quantity);
    }
  }

  delete(enemy: Enemy) {
    this.allEnemy = this.allEnemy.filter(e => e !== enemy);
  }
  surrender() {
    this.currentEnemy = null;
  }
  getRequiredSearch(level: number): Decimal {
    level =
      level +
      (this.moreMetal ? 1 : 0) +
      (this.moreCrystal ? 1 : 0) +
      (this.moreHabitable ? 1 : 0) +
      (this.randomized ? 1 : 0) +
      (this.moreHabitable2 ? 1 : 0) +
      (this.moreRobot ? 1 : 0);
    return new Decimal(5e3).times(Decimal.pow(1.2, level - 1));
  }
  /**
   * Start searching a new enemy
   */
  startSearching(level: number) {
    const searchJob = new SearchJob();
    searchJob.level = level;
    searchJob.moreMetal = this.moreMetal;
    searchJob.moreCrystal = this.moreCrystal;
    searchJob.moreHabitableSpace = this.moreHabitable;
    searchJob.moreHabitableSpace2 = this.moreHabitable2;
    searchJob.randomized = this.randomized;
    searchJob.moreRobot = this.moreRobot;
    searchJob.total = this.getRequiredSearch(level);
    searchJob.generateNameDescription();
    this.searchJobs.push(searchJob);
  }
  /**
   * Add progress, return
   * @return unused progress
   */
  addProgress(progress: Decimal) {
    while (this.searchJobs.length > 0 && progress.gt(0)) {
      progress = this.searchJobs[0].addProgress(progress);
      if (this.searchJobs[0].done) this.searchJobs.shift();
    }
  }
  /**
   *  Get sum of ToDo progress
   */
  getTotalToDo(): Decimal {
    return this.searchJobs
      .map(s => s.total.minus(s.progress))
      .reduce((p, c) => p.plus(c.max(1)), ZERO_DECIMAL_IMMUTABLE);
  }
  getTotalEnemy(): number {
    return this.allEnemy.length + this.searchJobs.length;
  }
  reloadTimes() {
    this.searchJobs.forEach(j => j.reloadTime());
    this.totalTime = this.searchJobs
      .map(j => j.timeToComplete)
      .reduce((p, c) => p + c, 0);
  }
  nuke(missile: Decimal) {
    if (!this.currentEnemy || !this.currentEnemy.currentZone) return;
    const defense = this.currentEnemy.currentZone.ships
      .filter(s => s.type.defense)
      .sort((d, b) => d.type.navalCapacity - b.type.navalCapacity);
    if (defense.length === 0) return;
    let totalDamage = this.missileDamageBonus
      .getTotalBonus()
      .times(MISSILE_DAMAGE)
      .times(missile);
    defense.forEach(d => {
      const armor = d.totalShield.plus(d.totalArmor);
      const toDestroy = totalDamage.div(armor).min(d.quantity);
      d.quantity = d.quantity.minus(toDestroy);
      totalDamage = totalDamage.minus(toDestroy.times(armor));
    });
    this.currentEnemy.currentZone.ships = this.currentEnemy.currentZone.ships.filter(
      s => s.quantity.gt(0)
    );
    this.currentEnemy.currentZone.reload();
  }
  getMaxNuke(): Decimal {
    if (!this.currentEnemy || !this.currentEnemy.currentZone) {
      return ZERO_DECIMAL_IMMUTABLE;
    }
    const defense = this.currentEnemy.currentZone.ships
      .filter(s => s.type.defense)
      .map(d => d.quantity.times(d.totalArmor.plus(d.totalShield)))
      .reduce((p, c) => p.plus(c), ZERO_DECIMAL_IMMUTABLE);

    if (defense.lt(1)) return ZERO_DECIMAL_IMMUTABLE;
    const missileDamage = this.missileDamageBonus
      .getTotalBonus()
      .times(MISSILE_DAMAGE);
    return defense
      .ceil()
      .div(missileDamage)
      .ceil();
  }

  //#region Save and Load
  getSave(): any {
    const data: any = {};
    if (this.maxLevel > 1) data.l = this.maxLevel;
    if (!!this.currentEnemy) data.c = this.currentEnemy.getSave();
    if (this.allEnemy.length > 0) data.a = this.allEnemy.map(e => e.getSave());
    if (this.searchJobs.length > 0) {
      data.j = this.searchJobs.map(j => j.getSave());
    }
    if (this.autoNuke) data.n = this.autoNuke;
    data.not = EnemyManager.NewOnTop;
    data.x = this.autoNext;

    if (this.moreMetal) data.mm = this.moreMetal;
    if (this.moreCrystal) data.mc = this.moreCrystal;
    if (this.moreHabitable) data.mh = this.moreHabitable;
    if (this.moreHabitable2) data.mh2 = this.moreHabitable2;
    if (this.randomized) data.ra = this.randomized;
    if (this.moreRobot) data.mr = this.moreRobot;
    if (this.mergeLevel !== 0) data.mer = this.mergeLevel;
    if (this.currentMerge !== 0) data.cumer = this.currentMerge;

    return data;
  }
  load(data: any): boolean {
    if ("l" in data) this.maxLevel = data.l;
    if ("c" in data) this.currentEnemy = Enemy.fromData(data.c, true);
    if ("a" in data) {
      for (const enemyData of data.a) {
        this.allEnemy.push(Enemy.fromData(enemyData));
      }
    }
    if (
      this.currentEnemy &&
      (!this.currentEnemy.zones || this.currentEnemy.zones.length !== 100)
    ) {
      this.currentEnemy.generateZones();
    }
    if (this.currentEnemy && this.currentEnemy.zones) {
      for (let i = 0; i < this.currentEnemy.currentZone.number; i++) {
        this.currentEnemy.zones[i].completed = true;
        this.currentEnemy.zones[i].reload();
      }
    }
    if ("j" in data) {
      for (const jobData of data.j) {
        if (jobData) {
          const job = SearchJob.FromData(jobData);
          this.searchJobs.push(job);
        }
      }
    }
    if (this.currentEnemy) {
      this.currentEnemy.setOrder();
      if (this.currentEnemy.currentZone) this.currentEnemy.currentZone.reload();
    }
    if ("n" in data) this.autoNuke = data.n;
    if ("x" in data) this.autoNext = data.x;
    if ("not" in data) EnemyManager.NewOnTop = data.not;

    if ("mm" in data) this.moreMetal = data.mm;
    if ("mc" in data) this.moreCrystal = data.mc;
    if ("mh" in data) this.moreHabitable = data.mh;
    if ("mh2" in data) this.moreHabitable2 = data.mh2;
    if ("ra" in data) this.randomized = data.ra;
    if ("mr" in data) this.moreRobot = data.mr;
    if ("mer" in data) this.mergeLevel = data.mer;
    if ("cumer" in data) this.currentMerge = data.cumer;

    if (this.currentEnemy) {
      for (let n = 0; n <= this.currentMerge; n++) {
        const mergedZone = this.currentEnemy.zones[
          this.currentEnemy.currentZone.number + n
        ];
        if (mergedZone) {
          mergedZone.mergedOrigin = this.currentEnemy.currentZone;
          mergedZone.reload();
        }
      }
    }

    return true;
  }
  //#endregion
}
