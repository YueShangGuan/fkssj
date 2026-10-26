// scheduler-recovery-continue.test.js — 验证任务失败后的主界面恢复只跳过当前动作，不重跑本轮前序任务。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var calls = [];
var statuses = [];
var stop = false;
var sceneChecks = 0;

var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("锻造未启用，不应执行"); } },
    "./plantFood.js": { runOnce: function() { calls.push("food"); return false; } },
    "./merchantShip.js": { runOnce: function() { throw new Error("商船未启用，不应执行"); } },
    "./war.js": { runOnce: function() { throw new Error("盟战未启用，不应执行"); } },
    "./navigate.js": {
        detectScene: function() {
            sceneChecks++;
            // 调度开始和限时任务后正常；种植后进入未知页，恢复后再确认基地。
            return sceneChecks === 3 ? "unknown" : "base";
        },
        recoverToMainScene: function() { calls.push("recover"); return true; }
    },
    "./gameHelper.js": {
        // 模拟入口线程未注册回调，使调度线程必须执行相同的有限恢复方法。
        reportRequiredPositionMissing: function() { calls.push("report"); return false; }
    },
    "./resourceGather.js": {
        runOnce: function() { calls.push("gather"); stop = true; return "completed"; }
    },
    "./tradePort.js": { runOnce: function() { throw new Error("停止后不应执行贸易港口"); } },
    "./exhibition.js": { runOnce: function() { throw new Error("停止后不应执行展区"); } },
    "./intelligence.js": { runOnce: function() { throw new Error("停止后不应执行情报"); } },
    "./hangUpReward.js": { runOnce: function() { throw new Error("停止后不应执行挂机奖励"); } }
};

/**
 * 为调度器注入确定的页面和任务桩，仅验证恢复后任务顺序。
 * @param {string} request 被加载模块路径。
 * @param {Object} parent 发起加载的模块。
 * @param {boolean} isMain 是否为入口模块。
 * @returns {Object} 测试桩或原始模块。
 */
Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function() {};
global.log = function() {};

try {
    var scheduler = require("../../modules/scheduler.js");
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: true, gather: true, tradePort: false, exhibition: false, intelligence: false, resourceCollection: false, ship: false, war: false },
            weaponFridayOnly: false,
            selectedFood: "水稻",
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
        log: function() {},
        setStatus: function(status) { statuses.push(status); },
        onAction: function() {}
    });

    assert.deepStrictEqual(calls, ["food", "report", "recover", "gather"]);
    assert.ok(statuses.indexOf("已回到主界面，继续本轮后续任务") >= 0);
} finally {
    Module._load = originalLoad;
}

console.log("scheduler recovery continue test passed");
