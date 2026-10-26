// scheduler-unknown-scene.test.js — 验证未知页面会短路本轮后续任务，避免连锁误触。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var calls = [];
var logs = [];
var statuses = [];
var sleeps = [];
var stop = false;
var sceneChecks = 0;
var recoveryReports = [];
var directRecoveryAttempts = 0;

/**
 * 用最小桩隔离 AutoJs6 任务模块，并让种植子方法返回后首次场景确认变为未知页面。
 */
var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("锻造不应执行"); } },
    "./plantFood.js": {
        // 冷却与定位已封装到种植子模块；这里仅模拟它返回后遗留未知页面。
        runOnce: function() { calls.push("food"); return false; }
    },
    "./merchantShip.js": { runOnce: function() { throw new Error("未知页面后不应运行商船"); } },
    "./war.js": { runOnce: function() { throw new Error("未知页面后不应运行盟战"); } },
    "./navigate.js": {
        detectScene: function() {
            sceneChecks += 1;
            // 调度开始与限时任务后的守卫均正常，种植子方法返回后才模拟页面被弹层覆盖。
            return sceneChecks < 3 ? "base" : "unknown";
        },
        // 页面感知恢复确认失败后，调度器才应进入原有的无触控退避。
        recoverToMainScene: function() {
            directRecoveryAttempts++;
            return false;
        }
    },
    "./gameHelper.js": {
        reportRequiredPositionMissing: function(taskName, positionName) {
            recoveryReports.push([taskName, positionName]);
            return false;
        }
    },
    "./resourceGather.js": { runOnce: function() { throw new Error("未知页面后不应运行打捞"); } },
    "./tradePort.js": { runOnce: function() { throw new Error("未知页面后不应运行贸易港口"); } },
    "./exhibition.js": { runOnce: function() { throw new Error("未知页面后不应运行展区"); } },
    "./intelligence.js": { runOnce: function() { throw new Error("未知页面后不应运行情报"); } },
    "./hangUpReward.js": { runOnce: function() { throw new Error("未知页面后不应运行挂机奖励"); } }
};

/**
 * 在加载调度器时替换任务依赖，确保本测试只验证调度短路行为。
 *
 * @param {string} request 被加载模块路径。
 * @param {Object} parent 发起加载的模块。
 * @param {boolean} isMain 是否为入口模块。
 * @returns {Object} 测试桩或原始模块。
 */
Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};

/**
 * 只执行一次退避等待即可终止循环，避免测试等待真实 30 秒。
 *
 * @param {number} milliseconds 请求的等待时长。
 */
global.sleep = function(milliseconds) {
    sleeps.push(milliseconds);
    stop = true;
};
global.log = function() {};

try {
    var scheduler = require("../../modules/scheduler.js");
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: true, gather: true, tradePort: true, exhibition: true, intelligence: true, hangUpReward: true, ship: false, war: false },
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
            intelligenceLastCompletedAt: 0,
            exhibitionDurationHours: 4,
            exhibitionSites: [],
            _saveConfig: function() {},
            updateFoodLabel: function() {}
        },
        shouldStop: function() { return stop; },
        log: function(message) { logs.push(message); },
        setStatus: function(status) { statuses.push(status); },
        onAction: function() {}
    });

    assert.deepStrictEqual(calls, ["food"]);
    assert.strictEqual(sceneChecks, 3, "应在调度开始、限时任务后和种植失败后依次确认场景");
    assert.ok(logs.some(function(message) { return message.indexOf("种植后未确认游戏主界面") >= 0; }));
    assert.deepStrictEqual(recoveryReports, [["调度", "种植后游戏主界面"]]);
    assert.strictEqual(directRecoveryAttempts, 1, "恢复失败后才应执行无触控退避");
    assert.ok(statuses.indexOf("主界面未确认，30 秒后重试") >= 0);
    assert.deepStrictEqual(sleeps, [1000], "退避应逐秒等待，以便用户可随时停止调度");
} finally {
    Module._load = originalLoad;
}

console.log("scheduler unknown-scene test passed");
