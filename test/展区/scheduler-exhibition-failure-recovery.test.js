// scheduler-exhibition-failure-recovery.test.js — 验证展区失败后即使恢复主界面也会执行模块退避。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var exhibitionCalls = 0;
var recoveryCalls = 0;
var statuses = [];
var sleeps = [];
var scene = "base";
var stop = false;

// 只模拟“展区失败 -> 恢复主界面”的最短调度链，验证恢复后回到短轮转而不独占退避。
var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("不应执行锻造"); } },
    "./plantFood.js": { runOnce: function() { throw new Error("不应执行种植"); } },
    "./merchantShip.js": { runOnce: function() { throw new Error("不应执行商船"); } },
    "./war.js": { runOnce: function() { throw new Error("不应执行盟战"); } },
    "./navigate.js": {
        detectScene: function() { return scene; },
        recoverToMainScene: function() {
            recoveryCalls++;
            scene = "base";
            return true;
        }
    },
    "./gameHelper.js": {
        reportRequiredPositionMissing: function() { return false; }
    },
    "./resourceGather.js": { runOnce: function() { throw new Error("不应执行打捞"); } },
    "./tradePort.js": { runOnce: function() { throw new Error("不应执行贸易港口"); } },
    "./exhibition.js": {
        runOnce: function() {
            exhibitionCalls++;
            if (exhibitionCalls > 1) throw new Error("首个两秒轮转内不应立即重跑展区");
            scene = "unknown";
            return { status: "failed", waitSeconds: 60 };
        }
    },
    "./intelligence.js": { runOnce: function() { throw new Error("不应执行情报"); } },
    "./hangUpReward.js": { runOnce: function() { throw new Error("不应执行挂机奖励"); } }
};

/**
 * 为该场景替换调度器任务依赖，仅保留展区失败与主页恢复分支。
 * @param {string} request 被加载模块路径。
 * @param {Object} parent 发起加载的模块。
 * @param {boolean} isMain 是否为入口模块。
 * @returns {Object} 测试桩或原始模块。
 */
Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function(milliseconds) {
    sleeps.push(milliseconds);
    // 首个短轮转秒级等待足够证明已进入等待分支，并阻止测试继续到下一调度轮。
    stop = true;
};
global.log = function() {};

try {
    var scheduler = require("../../modules/scheduler.js");
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: true, intelligence: false, resourceCollection: false, ship: false, war: false },
            weaponFridayOnly: false,
            freq: { weapon: 30, food: 30, tradePort: 10, exhibition: 10, intelligence: 4, hangUpReward: 1, ship: 60, war: 20 },
            gatherIntervalMinutes: 60,
            gatherThresholdPercent: 90,
            gatherDurationMinutes: 5,
            tradePortLastCompletedAt: 0,
            exhibitionLastCompletedAt: 0,
            intelligenceLastCompletedAt: 0,
            exhibitionDurationHours: 4,
            exhibitionSites: []
        },
        shouldStop: function() { return stop; },
        log: function() {},
        setStatus: function(status) { statuses.push(status); },
        onAction: function() {}
    });

    assert.strictEqual(exhibitionCalls, 1);
    assert.strictEqual(recoveryCalls, 1);
    assert.ok(statuses.indexOf("本轮检查完成，2 秒后继续") >= 0);
    assert.deepStrictEqual(sleeps, [1000]);
} finally {
    Module._load = originalLoad;
}

console.log("scheduler exhibition failure recovery test passed");
