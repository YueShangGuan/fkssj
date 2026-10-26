// scheduler-resource-collection.test.js — 验证资源收集组的子功能顺序、开关与会话冷却

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var calls = [];
var stop = false;
var phase = "cooldown";

/**
 * 提供调度器依赖替身，使测试只观察资源收集组的接线与时间戳传递。
 */
var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("锻造不应执行"); } },
    "./plantFood.js": { runOnce: function() { throw new Error("种植不应执行"); } },
    "./merchantShip.js": { runOnce: function() { throw new Error("商船不应执行"); } },
    "./war.js": { runOnce: function() { throw new Error("盟战不应执行"); } },
    "./tradePort.js": { runOnce: function() { throw new Error("贸易港口不应执行"); } },
    "./resourceGather.js": { runOnce: function() { throw new Error("打捞资源不应执行"); } },
    "./residentDemand.js": { runOnce: function() { throw new Error("居民需求不应执行"); } },
    "./exhibition.js": { runOnce: function() { throw new Error("展区不应执行"); } },
    "./intelligence.js": { runOnce: function() { throw new Error("情报不应执行"); } },
    "./navigate.js": {
        detectScene: function() { return "base"; },
        recoverToMainScene: function() { return false; }
    },
    "./gameHelper.js": { reportRequiredPositionMissing: function() { return false; } },
    "./hangUpReward.js": {
        runOnce: function(imgs, config) {
            calls.push({ type: "hang", config: config });
            if (phase === "cooldown" && calls.filter(function(item) { return item.type === "hang"; }).length === 1) return { status: "completed" };
            if (phase === "cooldown") assert.ok(config.lastCompletedAt > 0, "第二轮挂机奖励必须接收会话内完成时间");
            return { status: "cooldown" };
        }
    },
    "./resourceCollection.js": {
        runOnce: function(imgs, config) {
            calls.push({ type: "resource", config: config });
            var resourceCalls = calls.filter(function(item) { return item.type === "resource"; });
            if (phase === "cooldown" && resourceCalls.length === 1) {
                return { experience: { status: "completed", safe: true }, factory: { status: "completed", safe: true } };
            }
            if (phase === "cooldown") {
                assert.ok(config.experience.lastCompletedAt > 0, "第二轮经验气泡必须接收会话内完成时间");
                assert.ok(config.factory.lastCompletedAt > 0, "第二轮工厂气泡必须接收会话内完成时间");
                stop = true;
            }
            return { experience: { status: "cooldown", safe: true }, factory: { status: "cooldown", safe: true } };
        }
    }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function() {};
global.log = function() {};

var scheduler = require("../../modules/scheduler.js");

/**
 * 创建只启用资源收集组的最小面板快照。
 * @param {Object} overrides 覆盖子功能开关。
 * @returns {Object} 调度器输入。
 */
function makePanel(overrides) {
    overrides = overrides || {};
    return {
        taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, residentDemand: false, exhibition: false, intelligence: false, resourceCollection: true, ship: false, war: false },
        resourceCollection: Object.assign({ hangUpReward: true, experience: true, factory: true }, overrides.resourceCollection),
        weaponFridayOnly: false,
        weaponType: "枪械",
        weaponLevel: "蓝级",
        selectedFood: "水稻",
        warFleetPlans: [],
        warClaimReward: true,
        freq: { weapon: 30, food: 30, tradePort: 10, residentDemand: 10, exhibition: 10, intelligence: 4, hangUpReward: 1, resourceExperience: 10, resourceFactory: 10, war: 20 },
        gatherIntervalMinutes: 60,
        gatherThresholdPercent: 90,
        gatherDurationMinutes: 5,
        tradePortLastCompletedAt: 0,
        exhibitionLastCompletedAt: 0,
        intelligenceLastCompletedAt: 0,
        exhibitionDurationHours: 4,
        exhibitionSites: [],
        _saveConfig: function() {},
        updateFoodLabel: function() {},
        refreshResidentDemandDailyState: function() { return false; }
    };
}

/**
 * 验证三项按挂机奖励、经验、工厂的顺序调用，并将完成时间只保留在当前 scheduler 会话内。
 */
function testGroupOrderAndSessionCooldown() {
    phase = "cooldown";
    calls = [];
    stop = false;
    scheduler.run({ images: {}, panel: makePanel(), shouldStop: function() { return stop; }, log: function() {}, setStatus: function() {}, onAction: function() {} });
    assert.deepStrictEqual(calls.map(function(item) { return item.type; }), ["hang", "resource", "hang", "resource"], "资源收集组必须先执行挂机奖励，再检查经验和工厂气泡");
    assert.strictEqual(calls[0].config.intervalHours, 1);
    assert.strictEqual(calls[1].config.experience.intervalMinutes, 10);
    assert.strictEqual(calls[1].config.factory.intervalMinutes, 10);
}

/**
 * 验证关闭第一项后不会调用挂机奖励模块，资源模块仍收到两个子功能的真实开关状态。
 */
function testChildSwitchesAreForwarded() {
    phase = "switches";
    calls = [];
    stop = false;
    moduleStubs["./resourceCollection.js"].runOnce = function(imgs, config) {
        calls.push({ type: "resource", config: config });
        stop = true;
        return { experience: { status: "disabled", safe: true }, factory: { status: "idle", safe: true } };
    };
    scheduler.run({ images: {}, panel: makePanel({ resourceCollection: { hangUpReward: false, experience: false, factory: true } }), shouldStop: function() { return stop; }, log: function() {}, setStatus: function() {}, onAction: function() {} });
    assert.deepStrictEqual(calls.map(function(item) { return item.type; }), ["resource"], "关闭挂机奖励子项后不能调用原领奖模块");
    assert.strictEqual(calls[0].config.experience.enabled, false);
    assert.strictEqual(calls[0].config.factory.enabled, true);
}

testGroupOrderAndSessionCooldown();
testChildSwitchesAreForwarded();

Module._load = originalLoad;
console.log("scheduler resource collection tests passed");
