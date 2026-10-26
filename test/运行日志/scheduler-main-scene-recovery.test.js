// scheduler-main-scene-recovery.test.js — 验证未知主界面优先恢复而非进入无触控退避。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var recoveryReports = [];
var logs = [];
var statuses = [];
var stop = false;
var directRecoveryCalls = 0;

var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./plantFood.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./merchantShip.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./war.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./navigate.js": {
        detectScene: function() { return "unknown"; },
        // 入口线程的回调不可见时，调度线程必须直接调用同一套有限恢复链路。
        recoverToMainScene: function(imgs, shouldStop, logFn) {
            directRecoveryCalls++;
            logFn("测试恢复成功");
            stop = true;
            return true;
        }
    },
    "./gameHelper.js": {
        reportRequiredPositionMissing: function(taskName, positionName) {
            recoveryReports.push([taskName, positionName]);
            return false;
        }
    },
    "./resourceGather.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./tradePort.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./exhibition.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./intelligence.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } },
    "./hangUpReward.js": { runOnce: function() { throw new Error("停止请求已生效，恢复后不应执行任务"); } }
};

/**
 * 在加载调度器时替换任务依赖，使测试只覆盖未知主页的恢复分支。
 * @param {string} request 被加载模块路径。
 * @param {Object} parent 发起加载的模块。
 * @param {boolean} isMain 是否为入口模块。
 * @returns {Object} 测试桩或原始模块。
 */
Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function() { throw new Error("恢复成功时不应进入退避等待"); };
global.log = function() {};

try {
    var scheduler = require("../../modules/scheduler.js");
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: false, intelligence: false, resourceCollection: false, ship: false, war: false },
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
        log: function(message) { logs.push(message); },
        setStatus: function(status) { statuses.push(status); },
        onAction: function() {}
    });

    assert.deepStrictEqual(recoveryReports, [["调度", "调度开始时游戏主界面"]]);
    assert.strictEqual(directRecoveryCalls, 1, "告警回调未恢复时调度线程应直接执行页面感知恢复");
    assert.ok(logs.some(function(message) { return message.indexOf("已恢复主界面") >= 0; }));
    assert.ok(statuses.indexOf("已回到主界面，继续本轮后续任务") >= 0);
} finally {
    Module._load = originalLoad;
}

console.log("scheduler main-scene recovery test passed");
