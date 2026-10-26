// scheduler-resident-demand.test.js — 验证居民需求位于贸易港口后、展区前，且安全回调一次性持久化状态

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var calls = [];
var saves = 0;
var statusRefreshes = 0;
var stop = false;
var residentMode = "checked";

/**
 * 调度器通过 require 加载 AutoJs 模块；本测试用最小替身观察顺序与居民状态透传，不触发任何游戏操作。
 */
var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("锻造不应执行"); } },
    "./plantFood.js": { runOnce: function() { throw new Error("种植不应执行"); } },
    "./merchantShip.js": { runOnce: function() { throw new Error("商船不应执行"); } },
    "./war.js": { runOnce: function() { throw new Error("盟战不应执行"); } },
    "./navigate.js": {
        detectScene: function() { return "base"; },
        recoverToMainScene: function() { throw new Error("本测试不应触发恢复"); }
    },
    "./gameHelper.js": {
        reportRequiredPositionMissing: function() { throw new Error("本测试不应触发缺位告警"); }
    },
    "./resourceGather.js": { runOnce: function() { throw new Error("打捞资源不应执行"); } },
    "./tradePort.js": {
        runOnce: function() { calls.push("tradePort"); return { completed: false, waitSeconds: 1 }; }
    },
    "./residentDemand.js": {
        runOnce: function(imgs, config, shouldStop, logFn, onSafeCheck) {
            calls.push({ name: "residentDemand", config: config });
            assert.strictEqual(config.intervalMinutes, 10, "居民需求默认巡检间隔必须为 10 分钟");
            assert.strictEqual(config.lastCheckedAt, 111);
            assert.strictEqual(config.completedDate, "2026-10-23");
            assert.strictEqual(config.experienceThreshold, 650, "自定义经验阈值必须完整透传到居民模块");
            assert.strictEqual(config.thursdayGoldEnabled, true, "周四金币模式开关必须完整透传到居民模块");
            assert.strictEqual(config.goldThreshold, 2500, "自定义金币阈值必须完整透传到居民模块");
            if (residentMode === "checked") {
                onSafeCheck({ lastCheckedAt: 333, completedDate: "2026-10-24" });
                return { status: "dailyCompleted" };
            }
            return { status: "cooldown" };
        }
    },
    "./exhibition.js": {
        runOnce: function() {
            calls.push("exhibition");
            // 展区已被调用即说明居民需求冷却/完成没有阻塞后续普通任务。
            stop = true;
            return { status: "cooldown", waitSeconds: 1 };
        }
    },
    "./intelligence.js": { runOnce: function() { throw new Error("情报不应执行"); } },
    "./hangUpReward.js": { runOnce: function() { throw new Error("挂机奖励不应执行"); } }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function() {};
global.log = function() {};

var scheduler = require("../../modules/scheduler.js");

/**
 * 构造居民需求与相邻两个普通任务开启的面板快照。
 * @returns {Object} 可供 scheduler.run 使用的模拟面板。
 */
function makePanel() {
    return {
        taskEnabled: { weapon: false, food: false, gather: false, tradePort: true, residentDemand: true, exhibition: true, intelligence: false, resourceCollection: false, ship: false, war: false },
        weaponFridayOnly: false,
        weaponType: "枪械",
        weaponLevel: "蓝级",
        selectedFood: "水稻",
        warFleetPlans: [],
        warClaimReward: true,
        freq: { weapon: 30, food: 30, tradePort: 10, residentDemand: 10, exhibition: 10, intelligence: 4, hangUpReward: 1, war: 20 },
        gatherIntervalMinutes: 60,
        gatherThresholdPercent: 90,
        gatherDurationMinutes: 5,
        tradePortLastCompletedAt: 0,
        residentDemandLastCheckedAt: 111,
        residentDemandCompletedDate: "2026-10-23",
        residentDemandExperienceThreshold: 650,
        residentDemandThursdayGoldEnabled: true,
        residentDemandGoldThreshold: 2500,
        exhibitionLastCompletedAt: 0,
        exhibitionDurationHours: 4,
        exhibitionSites: [],
        intelligenceLastCompletedAt: 0,
        applyResidentDemandSafeCheck: function(state) {
            this.residentDemandLastCheckedAt = state.lastCheckedAt;
            if (state.completedDate) this.residentDemandCompletedDate = state.completedDate;
            saves++;
            return true;
        },
        _saveConfig: function() { throw new Error("调度器不应绕过居民需求的安全回调单独保存"); },
        updateFoodLabel: function() {}
    };
}

/**
 * 运行一轮并返回可观察状态；展区替身会在验证后设置停止标记，避免测试进入下一轮。
 * @returns {{panel:Object,events:Array}} 面板状态与居民 UI 刷新事件。
 */
function runScenario() {
    stop = false;
    calls = [];
    saves = 0;
    statusRefreshes = 0;
    var panel = makePanel();
    scheduler.run({
        images: {},
        panel: panel,
        shouldStop: function() { return stop; },
        log: function() {},
        setStatus: function() {},
        onAction: function() {},
        onResidentDemandStateChange: function() { statusRefreshes++; }
    });
    return { panel: panel, events: calls.slice() };
}

residentMode = "checked";
var completed = runScenario();
assert.strictEqual(completed.events[0], "tradePort", "居民需求必须位于贸易港口之后");
assert.strictEqual(completed.events[1].name, "residentDemand");
assert.strictEqual(completed.events[2], "exhibition", "居民需求必须位于展区之前");
assert.strictEqual(completed.panel.residentDemandLastCheckedAt, 333);
assert.strictEqual(completed.panel.residentDemandCompletedDate, "2026-10-24");
assert.strictEqual(saves, 1, "居民巡检与日期状态必须由一次安全回调一起保存");
assert.strictEqual(statusRefreshes, 2, "进入任务段和安全落库后都必须刷新主页和悬浮面板状态");

residentMode = "cooldown";
var cooldown = runScenario();
assert.strictEqual(cooldown.events[0], "tradePort");
assert.strictEqual(cooldown.events[1].name, "residentDemand");
assert.strictEqual(cooldown.events[2], "exhibition", "居民需求冷却不能阻塞其他普通任务");
assert.strictEqual(cooldown.panel.residentDemandLastCheckedAt, 111, "冷却直接返回不得覆盖已保存巡检时间");
assert.strictEqual(cooldown.panel.residentDemandCompletedDate, "2026-10-23", "冷却直接返回不得覆盖完成日期");
assert.strictEqual(saves, 0);
assert.strictEqual(statusRefreshes, 1, "任务段开始前必须重新按今天刷新日期状态");
console.log("scheduler resident demand test passed");
