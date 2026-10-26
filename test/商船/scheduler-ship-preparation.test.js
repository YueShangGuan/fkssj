// scheduler-ship-preparation.test.js — 验证商船会在整点前进入活动弹窗，并在整点优先开始出征。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var realDate = Date;
var originalSleep = global.sleep;
var originalLog = global.log;
var fakeNow = new realDate("2026-10-19T18:59:00+08:00").getTime();
var stopped = false;
var stopAtEveningWar = false;
var calls = [];
var actionKeys = [];

/**
 * 商船优先场景中若仍执行盟战，立即使测试失败。
 * @returns {boolean} 此函数不会正常返回。
 */
function rejectUnexpectedWarRun() {
    throw new Error("商船整点动作应优先于盟战");
}

/**
 * 记录 20:59 的盟战执行并停止调度，避免测试继续进入下一轮。
 * @returns {boolean} 表示本轮已执行盟战动作。
 */
function recordWarRunAt2059() {
    warActions++;
    stopped = true;
    return true;
}
var warActions = 0;

/**
 * 让调度器每次读取到可控的设备本地时间，验证分钟级准备与整点动作的先后关系。
 * @returns {Date} 当前模拟时间。
 */
function ShipPreparationDate() {
    if (arguments.length > 0) return new realDate(arguments[0]);
    return new realDate(fakeNow);
}
ShipPreparationDate.now = function() { return fakeNow; };
ShipPreparationDate.parse = realDate.parse;
ShipPreparationDate.UTC = realDate.UTC;
ShipPreparationDate.prototype = realDate.prototype;

// 仅替换调度器依赖；商船桩记录准备和整点点击，其他任务若被触发即说明抢占失效。
var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("商船准备期间不应执行锻造"); } },
    "./plantFood.js": { runOnce: function() { throw new Error("商船准备期间不应执行种植"); } },
    "./merchantShip.js": {
        prepare: function() {
            calls.push({ name: "prepare", time: fakeNow });
            return { needBackToBase: false };
        },
        startPrepared: function() {
            calls.push({ name: "start", time: fakeNow });
            stopped = true;
            return "dispatched";
        },
        retryOnce: function() { throw new Error("准备期测试不应触发商船夺回重试"); }
    },
    "./war.js": { runOnce: rejectUnexpectedWarRun },
    "./navigate.js": { detectScene: function() { return "world"; } },
    "./gameHelper.js": { reportRequiredPositionMissing: function() { return false; } },
    "./tradePort.js": {},
    "./resourceGather.js": {},
    "./exhibition.js": {},
    "./intelligence.js": {},
    "./hangUpReward.js": {}
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.Date = ShipPreparationDate;
global.sleep = function(milliseconds) {
    fakeNow += milliseconds;
    // 跳过 20:00 商船的场景只需观察到盟战窗口开始；此后停止测试，避免进入真实盟战循环。
    if (stopAtEveningWar && fakeNow >= new realDate("2026-10-19T20:00:00+08:00").getTime()) stopped = true;
};
global.log = function() {};

try {
    var scheduler = require("../../modules/scheduler.js");
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: false, intelligence: false, resourceCollection: false, ship: true, war: true },
            shipPrepareMinutes: 1,
            shipRetryMinutes: 1,
            warFleetPlans: [],
            warClaimReward: true,
            freq: { war: 20 }
        },
        shouldStop: function() { return stopped; },
        log: function() {},
        setStatus: function() {},
        onAction: function(key) { actionKeys.push(key); }
    });

    assert.deepStrictEqual(calls.map(function(call) { return call.name; }), ["prepare", "start"]);
    assert.strictEqual(calls[0].time, new realDate("2026-10-19T18:59:00+08:00").getTime());
    assert.strictEqual(calls[1].time, new realDate("2026-10-19T19:00:00+08:00").getTime());
    assert.deepStrictEqual(actionKeys, ["ship"]);

    // 20:00 是盟战时段：19:59 不得准备货轮，跨入 20:00 也不得派遣商船。
    fakeNow = new realDate("2026-10-19T19:59:00+08:00").getTime();
    stopped = false;
    stopAtEveningWar = true;
    calls = [];
    actionKeys = [];
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: false, intelligence: false, resourceCollection: false, ship: true, war: true },
            shipPrepareMinutes: 1,
            shipRetryMinutes: 1,
            warFleetPlans: [],
            warClaimReward: true,
            freq: { war: 20 }
        },
        shouldStop: function() { return stopped; },
        log: function() {},
        setStatus: function() {},
        onAction: function(key) { actionKeys.push(key); }
    });

    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(actionKeys, []);

    // 20:59 仍属盟战窗口，即使 21:00 商船即将开启也不得跳转活动弹窗。
    fakeNow = new realDate("2026-10-19T20:59:00+08:00").getTime();
    stopped = false;
    stopAtEveningWar = false;
    calls = [];
    actionKeys = [];
    warActions = 0;
    moduleStubs["./war.js"].runOnce = recordWarRunAt2059;
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: false, intelligence: false, resourceCollection: false, ship: true, war: true },
            shipPrepareMinutes: 1,
            shipRetryMinutes: 1,
            warFleetPlans: [],
            warClaimReward: true,
            freq: { war: 20 }
        },
        shouldStop: function() { return stopped; },
        log: function() {},
        setStatus: function() {},
        onAction: function(key) { actionKeys.push(key); }
    });

    assert.deepStrictEqual(calls, [], "盟战窗口内不得准备 21:00 商船");
    assert.strictEqual(warActions, 1, "20:59 应继续执行盟战动作");
    assert.deepStrictEqual(actionKeys, ["war"]);
} finally {
    Module._load = originalLoad;
    global.Date = realDate;
    global.sleep = originalSleep;
    global.log = originalLog;
}

console.log("scheduler ship preparation test passed");
