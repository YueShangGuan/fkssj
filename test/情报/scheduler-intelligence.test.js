// scheduler-intelligence.test.js — 验证情报调度顺序、4 小时冷却持久化与独立冷却等待

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var calls = [];
var statuses = [];
var sleeps = [];
var stop = false;
var phase = "completed";
var saves = 0;
var stopAfterSleeps = 3;

/**
 * 为调度器提供最小任务替身，避免本测试依赖 AutoJs6 识图环境。
 */
var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("锻造不应执行"); } },
    "./plantFood.js": { runOnce: function() { throw new Error("种植不应执行"); } },
    "./merchantShip.js": { runOnce: function() { throw new Error("商船不应执行"); } },
    "./war.js": { runOnce: function() { throw new Error("盟战不应执行"); } },
    "./navigate.js": {
        // 本测试只验证情报冷却，场景守卫应确认基地且不触发定位流程。
        detectScene: function() { return "base"; },
        autoLocate: function() { throw new Error("定位不应执行"); }
    },
    "./gameHelper.js": {
        // 当前场景桩始终确认基地，因此调度器不应实际调用缺位恢复；保留替身可避免 Node 解析 AutoJs XML UI。
        reportRequiredPositionMissing: function() { return false; }
    },
    "./tradePort.js": { runOnce: function() { throw new Error("贸易港口不应执行"); } },
    "./resourceGather.js": { runOnce: function() { throw new Error("打捞资源不应执行"); } },
    "./hangUpReward.js": { runOnce: function() { throw new Error("挂机奖励不应执行"); } },
    "./exhibition.js": {
        runOnce: function() {
            calls.push("exhibition");
            return { status: "cooldown", waitSeconds: 1 };
        }
    },
    "./intelligence.js": {
        runOnce: function(imgs, config, shouldStop, log, onCompleted) {
            calls.push({ name: "intelligence", intervalHours: config.intervalHours, lastCompletedAt: config.lastCompletedAt });
            assert.strictEqual(config.intervalHours, 4, "情报默认完成后间隔必须为 4 小时");
            if (phase === "completed") {
                onCompleted(24680);
                return { status: "completed", waitSeconds: 14400 };
            }
            return { status: "cooldown", waitSeconds: 4321 };
        }
    }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function(milliseconds) {
    sleeps.push(milliseconds);
    // 先穿过展区后的两秒轮转，确认情报已被调用，再在轮次末尾停止测试。
    if (sleeps.length >= stopAfterSleeps) stop = true;
};
global.log = function() {};

var scheduler = require("../../modules/scheduler.js");

/**
 * 构造总调度所需最小面板快照，按参数决定是否同时开启展区以验证任务顺序。
 * @param {boolean} enableExhibition 是否启用展区。
 * @returns {Object} 可供 scheduler.run 使用的面板对象。
 */
function makePanel(enableExhibition) {
    return {
        taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: enableExhibition, intelligence: true, resourceCollection: false, ship: false, war: false },
        weaponFridayOnly: false,
        weaponType: "枪械",
        weaponLevel: "蓝级",
        selectedFood: "水稻",
        warFleetPlans: [{ mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }, { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }, { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }],
        warClaimReward: true,
        freq: { weapon: 30, food: 30, tradePort: 10, exhibition: 10, intelligence: 4, hangUpReward: 1, ship: 60, war: 20 },
        gatherIntervalMinutes: 60,
        gatherThresholdPercent: 90,
        gatherDurationMinutes: 5,
        tradePortLastCompletedAt: 0,
        exhibitionLastCompletedAt: 0,
        exhibitionDurationHours: 4,
        exhibitionSites: [],
        intelligenceLastCompletedAt: 0,
        _saveConfig: function() { saves++; },
        updateFoodLabel: function() {}
    };
}

var panel = makePanel(true);
scheduler.run({
    images: {},
    panel: panel,
    shouldStop: function() { return stop; },
    log: function() {},
    setStatus: function(status) { statuses.push(status); },
    onAction: function() {}
});

assert.strictEqual(calls[0], "exhibition", "情报必须排在展区之后");
assert.strictEqual(calls[1].name, "intelligence");
assert.strictEqual(panel.intelligenceLastCompletedAt, 24680, "安全完成回调必须持久化情报时间戳");
assert.strictEqual(saves, 1);
assert.ok(statuses.indexOf("本轮检查完成，2 秒后继续") >= 0, "完成后总调度只应等待两秒");
assert.deepStrictEqual(sleeps, [1000, 1000, 1000]);

// 单独开启情报时，冷却分支也必须回到两秒任务轮转。
phase = "cooldown";
stop = false;
calls = [];
statuses = [];
sleeps = [];
stopAfterSleeps = 1;
var cooldownPanel = makePanel(false);
cooldownPanel.intelligenceLastCompletedAt = 24680;
scheduler.run({
    images: {},
    panel: cooldownPanel,
    shouldStop: function() { return stop; },
    log: function() {},
    setStatus: function(status) { statuses.push(status); },
    onAction: function() {}
});

assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0].lastCompletedAt, 24680, "重启调度后必须将持久化完成时间传给情报模块");
assert.ok(statuses.indexOf("本轮检查完成，2 秒后继续") >= 0, "仅启用情报也不得按剩余冷却休眠");
assert.deepStrictEqual(sleeps, [1000]);
console.log("scheduler intelligence test passed");
