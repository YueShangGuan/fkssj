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
    "./tradePort.js": { runOnce: function() {
        calls.push("tradePort");
        // 冷却场景没有展区收尾动作；贸易港口被检查一次后结束该测试轮，避免新的短轮询持续运行。
        if (gatherRunResult === "cooldown") stop = true;
        return tradePortRunResult;
    } },
    "./resourceGather.js": { runOnce: function() {
        calls.push("gather");
        // 只有资源模块已经返回未确认状态时才结束用例；此前的任务间短等待必须继续执行。
        if (gatherRunResult === "unconfirmed") stop = true;
        return gatherRunResult;
    } },
    "./exhibition.js": { runOnce: function() {
        calls.push("exhibition");
        // 完整普通任务顺序在展区结束后已验证，无须让总调度开始下一轮。
        stop = true;
        return { status: "cooldown", waitSeconds: 1 };
    } }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
// 正常任务间会有短等待；停止标记由对应的末尾任务桩设置，避免在同一轮的前置动作后提前终止。
global.sleep = function() {};
global.log = function() {};

var scheduler = require("../../modules/scheduler.js");

/**
 * 用指定的资源任务结果运行一个调度轮次，验证当前采集失败不会错误地丢弃同轮后续任务。
 * @param {"completed"|"failed"|"unconfirmed"} result 资源模块本轮返回状态。
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

// 本用例只验证业务任务顺序；种植前的定位属于种植模块内部准备，不能作为总调度任务顺序的断言项。
assert.deepStrictEqual(runSchedulerScenario("completed"), ["weapon", "food", "gather", "tradePort", "exhibition"]);
// 资源模块已自行返回并确认主界面时，失败仅结束本次采集，后续任务可继续执行。
assert.deepStrictEqual(runSchedulerScenario("failed"), ["weapon", "food", "gather", "tradePort", "exhibition"]);
// 仅在资源模块尝试返回后仍无法确认主界面时阻断本轮，避免后续任务触碰残留菜单。
assert.deepStrictEqual(runSchedulerScenario("unconfirmed"), ["weapon", "food", "gather"]);

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
            taskEnabled: { weapon: false, food: false, gather: true, tradePort: true, exhibition: false, intelligence: false, resourceCollection: false, ship: false, war: false },
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
    assert.ok(statuses.indexOf("本轮检查完成，2 秒后继续") >= 0);
}

testMixedCooldownDoesNotBlockOtherTasks();
console.log("scheduler regular order test passed");
