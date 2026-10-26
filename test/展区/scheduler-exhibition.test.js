// scheduler-exhibition.test.js — 验证展区位于贸易港口之后，并在完成后使用分钟级等待与持久化时间

var assert = require("assert");
var Module = require("module");
var calls = [];
var statuses = [];
var sleeps = [];
var stop = false;
var saves = 0;
var originalLoad = Module._load;

// 总调度依赖 AutoJs6 任务模块；本测试只观察模块调用、完成时间写回和等待秒数。
var moduleStubs = {
    "./weapon.js": { runOnce: function() { calls.push("weapon"); return true; } },
    "./plantFood.js": { runOnce: function() { calls.push("food"); return true; } },
    "./merchantShip.js": { runOnce: function() { calls.push("ship"); return true; } },
    "./war.js": { runOnce: function() { calls.push("war"); return true; } },
    "./navigate.js": {
        // 展区顺序测试不模拟页面异常，始终提供已确认的基地场景给新增安全守卫。
        detectScene: function() { return "base"; },
        autoLocate: function() { calls.push("locate"); return true; }
    },
    "./gameHelper.js": {
        // 当前测试只覆盖已确认主界面下的展区调度，不应进入缺位恢复；替身避免 Node 解析 AutoJs XML UI。
        reportRequiredPositionMissing: function() { throw new Error("展区调度测试不应进入缺位恢复"); }
    },
    "./tradePort.js": { runOnce: function() { calls.push("tradePort"); return { completed: false, waitSeconds: 1 }; } },
    "./resourceGather.js": { runOnce: function() { calls.push("gather"); return "completed"; } },
    "./exhibition.js": {
        runOnce: function(imgs, config, shouldStop, log, onCompleted) {
            calls.push("exhibition");
            assert.strictEqual(config.intervalMinutes, 10);
            assert.strictEqual(config.lastCompletedAt, 0);
            assert.strictEqual(config.durationHours, 4);
            assert.deepStrictEqual(config.sites, ["旧灯塔瞭望台"]);
            onCompleted(123456);
            return { status: "completed", waitSeconds: 600 };
        }
    }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function(milliseconds) {
    sleeps.push(milliseconds);
// 第一个短轮转等待足以断开无限调度循环。
    stop = true;
};
global.log = function() {};

var scheduler = require("../../modules/scheduler.js");
var panel = {
    taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: true, ship: false, war: false },
    weaponFridayOnly: false,
    weaponType: "枪械",
    weaponLevel: "蓝级",
    selectedFood: "水稻",
    warFleetPlans: [{ mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }, { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }, { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }],
    warClaimReward: true,
    freq: { weapon: 30, food: 30, tradePort: 10, exhibition: 10, ship: 60, war: 20 },
    gatherIntervalMinutes: 60,
    gatherThresholdPercent: 90,
    gatherDurationMinutes: 5,
    tradePortLastCompletedAt: 0,
    exhibitionLastCompletedAt: 0,
    exhibitionDurationHours: 4,
    exhibitionSites: ["旧灯塔瞭望台"],
    _saveConfig: function() { saves++; },
    updateFoodLabel: function() {}
};

scheduler.run({
    images: {},
    panel: panel,
    shouldStop: function() { return stop; },
    log: function() {},
    setStatus: function(status) { statuses.push(status); },
    onAction: function(task) { calls.push("action:" + task); }
});

assert.deepStrictEqual(calls, ["exhibition", "action:exhibition"]);
assert.strictEqual(panel.exhibitionLastCompletedAt, 123456);
assert.strictEqual(saves, 1);
assert.ok(statuses.indexOf("本轮检查完成，2 秒后继续") >= 0, "展区成功后总调度只应等待两秒");
assert.deepStrictEqual(sleeps, [1000]);
console.log("scheduler exhibition test passed");
