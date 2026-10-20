// scheduler-gather-order.test.js — 验证普通任务固定按锻造、种植、打捞资源、贸易港口、展区执行

var assert = require("assert");
var Module = require("module");
var calls = [];
var statuses = [];
var stop = false;
var gatherRunResult = "completed";
var tradePortRunResult = { completed: false, waitSeconds: 1 };
var originalLoad = Module._load;

// 调度器依赖 AutoJs6 任务模块；用最小桩只观察任务顺序，不触发任何游戏操作。
var moduleStubs = {
    "./weapon.js": { runOnce: function() { calls.push("weapon"); return true; } },
    "./plantFood.js": { runOnce: function() { calls.push("food"); return true; } },
    "./merchantShip.js": { runOnce: function() { calls.push("ship"); return true; } },
    "./war.js": { runOnce: function() { calls.push("war"); return true; } },
    "./navigate.js": {
        // 调度顺序测试的页面始终有效，避免新守卫改变本用例关注的任务排列。
        detectScene: function() { return "base"; },
        autoLocate: function() { calls.push("locate"); return true; }
    },
    "./gameHelper.js": {
        // 场景桩始终已确认，恢复分支不可达；替身避免 Node 解析 AutoJs XML UI。
        reportRequiredPositionMissing: function() { throw new Error("调度顺序测试不应进入缺位恢复"); }
    },
    "./tradePort.js": { runOnce: function() { calls.push("tradePort"); return tradePortRunResult; } },
    "./resourceGather.js": { runOnce: function() { calls.push("gather"); return gatherRunResult; } },
    "./exhibition.js": { runOnce: function() { calls.push("exhibition"); return { status: "cooldown", waitSeconds: 1 }; } }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function() { stop = true; };
global.log = function() {};

var scheduler = require("../../modules/scheduler.js");

/**
 * 用指定的资源任务结果运行一个调度轮次，验证该结果是否会错误地放行后续任务。
 * @param {"completed"|"unconfirmed"} result 资源模块本轮返回状态。
 * @returns {string[]} 本轮实际执行的任务标识。
 */
function runSchedulerScenario(result) {
    calls = [];
    stop = false;
    gatherRunResult = result;
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: true, food: true, gather: true, tradePort: true, exhibition: true, ship: false, war: false },
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
            _saveConfig: function() {},
            updateFoodLabel: function() {}
        },
        shouldStop: function() { return stop; },
        log: function() {},
        setStatus: function(status) { statuses.push(status); },
        onAction: function() {}
    });
    return calls;
}

assert.deepStrictEqual(runSchedulerScenario("completed"), ["weapon", "locate", "food", "gather", "tradePort", "exhibition"]);
// 设施菜单未确认时必须在资源任务边界截断，不能把贸易港口或展区点击落到该菜单上。
assert.deepStrictEqual(runSchedulerScenario("unconfirmed"), ["weapon", "locate", "food", "gather"]);

/**
 * 验证打捞资源与贸易港口同时冷却时，不会让任一任务独占完整冷却时间。
 */
function testMixedCooldownDoesNotBlockOtherTasks() {
    calls = [];
    statuses = [];
    stop = false;
    gatherRunResult = "cooldown";
    tradePortRunResult = { completed: false, waitSeconds: 600 };
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: false, gather: true, tradePort: true, exhibition: false, intelligence: false, hangUpReward: false, ship: false, war: false },
            weaponFridayOnly: false,
            weaponType: "枪械",
            weaponLevel: "蓝级",
            selectedFood: "水稻",
            warFleetPlans: [],
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
        log: function() {},
        setStatus: function(status) { statuses.push(status); },
        onAction: function() {}
    });
    assert.deepStrictEqual(calls, ["gather", "tradePort"]);
    assert.ok(statuses.indexOf("等待已开启的限时任务") >= 0);
    assert.strictEqual(statuses.filter(function(status) {
        return status.indexOf("冷却中，等待") >= 0;
    }).length, 0);
}

testMixedCooldownDoesNotBlockOtherTasks();
console.log("scheduler regular order test passed");
