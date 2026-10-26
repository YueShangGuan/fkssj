// scheduler-ship-retry.test.js — 验证商船夺回重试不阻塞普通任务，且货轮消失后结束本时段。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var realDate = Date;
var originalSleep = global.sleep;
var originalLog = global.log;
var fakeNow = new realDate("2026-10-19T18:59:00+08:00").getTime();
var stopped = false;
var calls = [];
var actionKeys = [];
var weaponChecks = 0;
var retryCount = 0;

/**
 * 使用可控的设备本地时间驱动商船提前准备、整点首轮和分钟级夺回重试。
 * @returns {Date} 当前模拟时间。
 */
function ShipRetryDate() {
    if (arguments.length > 0) return new realDate(arguments[0]);
    return new realDate(fakeNow);
}
ShipRetryDate.now = function() { return fakeNow; };
ShipRetryDate.parse = realDate.parse;
ShipRetryDate.UTC = realDate.UTC;
ShipRetryDate.prototype = realDate.prototype;

var moduleStubs = {
    "./weapon.js": {
        runOnce: function() {
            weaponChecks++;
            return false;
        }
    },
    "./plantFood.js": {},
    "./merchantShip.js": {
        prepare: function() {
            calls.push({ name: "prepare", time: fakeNow });
            return { needBackToBase: false };
        },
        startPrepared: function() {
            calls.push({ name: "start", time: fakeNow });
            return "dispatched";
        },
        retryOnce: function() {
            retryCount++;
            calls.push({ name: "retry", time: fakeNow });
            if (retryCount === 1) return "noIdleFleet";
            if (retryCount === 3) {
                stopped = true;
                return "empty";
            }
            return "dispatched";
        }
    },
    "./war.js": {},
    "./navigate.js": { detectScene: function() { return "world"; } },
    "./gameHelper.js": { reportRequiredPositionMissing: function() { return false; } },
    "./tradePort.js": {},
    "./resourceGather.js": {},
    "./residentDemand.js": {},
    "./exhibition.js": {},
    "./intelligence.js": {},
    "./hangUpReward.js": {},
    "./resourceCollection.js": {}
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.Date = ShipRetryDate;
global.sleep = function(milliseconds) { fakeNow += milliseconds; };
global.log = function() {};

try {
    var scheduler = require("../../modules/scheduler.js");
    scheduler.run({
        images: {},
        panel: {
            taskEnabled: { weapon: true, food: false, gather: false, tradePort: false, residentDemand: false, exhibition: false, intelligence: false, resourceCollection: false, ship: true, war: false },
            shipPrepareMinutes: 1,
            shipRetryMinutes: 1,
            warFleetPlans: [],
            warClaimReward: false,
            freq: { weapon: 30, war: 20 }
        },
        shouldStop: function() { return stopped; },
        log: function() {},
        setStatus: function() {},
        onAction: function(key) { actionKeys.push(key); }
    });

    assert.deepStrictEqual(calls.map(function(call) { return call.name; }), ["prepare", "start", "retry", "retry", "retry"]);
    assert.strictEqual(calls[0].time, new realDate("2026-10-19T18:59:00+08:00").getTime());
    assert.strictEqual(calls[1].time, new realDate("2026-10-19T19:00:00+08:00").getTime());
    assert.strictEqual(calls[2].time, new realDate("2026-10-19T19:01:00+08:00").getTime());
    assert.strictEqual(calls[3].time, new realDate("2026-10-19T19:02:00+08:00").getTime());
    assert.strictEqual(calls[4].time, new realDate("2026-10-19T19:03:00+08:00").getTime());
    assert.ok(weaponChecks > 0, "等待夺回重试期间必须继续执行普通任务检查");
    assert.deepStrictEqual(actionKeys, ["ship", "ship"], "无空闲舰队和货轮消失都不应记录为实际出征");
} finally {
    Module._load = originalLoad;
    global.Date = realDate;
    global.sleep = originalSleep;
    global.log = originalLog;
}

console.log("scheduler ship retry test passed");
