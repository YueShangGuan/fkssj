// scheduler-war-plan-snapshot.test.js — 验证城战计划在总调度器启动时复制，运行中不会被面板对象改写。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var realDate = Date;
var originalSleep = global.sleep;
var originalLog = global.log;
var stopped = false;
var receivedPlans = null;
var receivedClaimReward = null;
var panel = {
    taskEnabled: { war: true, ship: false },
    warFleetPlans: [
        { mode: "attack", target: "F6", repairAccelerate: true, marchAccelerate: false },
        { mode: "defend", target: "E8", repairAccelerate: false, marchAccelerate: true },
        { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }
    ],
    warClaimReward: true,
    freq: { war: 20 }
};

/**
 * 固定到盟战活动窗口，令调度器只执行一次城战，再由 sleep 桩结束循环。
 * @returns {Date} 固定的本地 20:10 时间。
 */
function WarWindowDate() {
    return new realDate("2026-10-19T20:10:00+08:00");
}
WarWindowDate.now = function() { return new realDate("2026-10-19T20:10:00+08:00").getTime(); };
WarWindowDate.parse = realDate.parse;
WarWindowDate.UTC = realDate.UTC;
WarWindowDate.prototype = realDate.prototype;

// 所有模块均为最小替身；本用例只验证城战调用拿到的配置副本，不触发任何游戏操作。
var moduleStubs = {
    "./weapon.js": {},
    "./plantFood.js": {},
    "./merchantShip.js": {},
    "./war.js": {
        runOnce: function(imgs, plans, log, claimReward) {
            receivedPlans = plans;
            receivedClaimReward = claimReward;
            // 模拟运行期间的外部写入；已交给城战模块的计划必须维持启动快照。
            panel.warFleetPlans[0].mode = "defend";
            panel.warFleetPlans[0].target = "G9";
            panel.warClaimReward = false;
            return true;
        }
    },
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
global.Date = WarWindowDate;
global.sleep = function() { stopped = true; };
global.log = function() {};

try {
    var scheduler = require("../../modules/scheduler.js");
    scheduler.run({
        images: {},
        panel: panel,
        shouldStop: function() { return stopped; },
        log: function() {},
        setStatus: function() {},
        onAction: function() {}
    });

    assert.notStrictEqual(receivedPlans, panel.warFleetPlans, "城战必须获得独立计划数组");
    assert.deepStrictEqual(receivedPlans[0], { mode: "attack", target: "F6", repairAccelerate: true, marchAccelerate: false });
    assert.strictEqual(receivedClaimReward, true, "领取奖励开关也必须冻结为启动时的值");
} finally {
    Module._load = originalLoad;
    global.Date = realDate;
    global.sleep = originalSleep;
    global.log = originalLog;
}

console.log("scheduler war plan snapshot test passed");
