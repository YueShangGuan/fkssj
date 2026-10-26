// scheduler-hang-up-reward.test.js — 验证挂机奖励的会话冷却和脚本重启重置行为

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var calls = [];
var actions = [];
var sleeps = 0;
var stop = false;
var phase = "same-session";

/**
 * 为调度器提供 AutoJs6 模块替身，使测试仅验证任务顺序、会话时间与等待行为。
 */
var moduleStubs = {
    "./weapon.js": { runOnce: function() { throw new Error("锻造不应执行"); } },
    "./plantFood.js": { runOnce: function() { throw new Error("种植不应执行"); } },
    "./merchantShip.js": { runOnce: function() { throw new Error("商船不应执行"); } },
    "./war.js": { runOnce: function() { throw new Error("盟战不应执行"); } },
    "./navigate.js": {
        // 挂机奖励冷却测试不涉及场景流转，返回基地以通过调度器的主界面守卫。
        detectScene: function() { return "base"; },
        autoLocate: function() { throw new Error("定位不应执行"); }
    },
    "./gameHelper.js": {
        // 当前场景桩固定为基地，缺位恢复不应触发；替身避免 Node 解析 AutoJs XML UI。
        reportRequiredPositionMissing: function() { throw new Error("挂机奖励冷却测试不应进入缺位恢复"); }
    },
    "./tradePort.js": { runOnce: function() { throw new Error("贸易港口不应执行"); } },
    "./resourceGather.js": { runOnce: function() { throw new Error("打捞不应执行"); } },
    "./exhibition.js": { runOnce: function() { throw new Error("展区不应执行"); } },
    "./intelligence.js": { runOnce: function() { return { status: "cooldown", waitSeconds: 14400 }; } },
    // 挂机奖励现属于资源收集任务组；本测试只验证第一项，因此两个地图收集子项均关闭。
    "./resourceCollection.js": { runOnce: function() { return { experience: { status: "disabled", safe: true }, factory: { status: "disabled", safe: true } }; } },
    "./hangUpReward.js": {
        runOnce: function(imgs, config) {
            calls.push({ intervalHours: config.intervalHours, lastCompletedAt: config.lastCompletedAt });
            if (phase === "mixed-cooldown") return { status: "cooldown", waitSeconds: 3600 };
            if (phase === "same-session" && calls.length === 1) return { status: "completed", waitSeconds: 3600 };
            if (phase === "same-session") {
                // 第二次调用必须携带第一轮完成后的会话时间，模块据此可直接跳过。
                assert.ok(config.lastCompletedAt > 0, "同一会话第二轮必须传入完成时间");
                stop = true;
                return { status: "cooldown", waitSeconds: 3600 };
            }
            // 新 scheduler.run 会新建会话变量，不能沿用上一次运行的完成时间。
            assert.strictEqual(config.lastCompletedAt, 0, "重启调度器后挂机奖励冷却应重置");
            stop = true;
            return { status: "completed", waitSeconds: 3600 };
        }
    }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.sleep = function() {
    sleeps++;
    // 冷却任务也只走一次两秒轮转，后续轮次由模块内部直接返回。
    if (phase === "mixed-cooldown" && sleeps >= 3) stop = true;
};
global.log = function() {};

var scheduler = require("../../modules/scheduler.js");

/**
 * 创建仅开启挂机奖励的面板快照；默认间隔必须为 1 小时。
 * @returns {Object} 调度器所需的最小面板对象。
 */
function makePanel() {
    return {
        taskEnabled: { weapon: false, food: false, gather: false, tradePort: false, exhibition: false, intelligence: false, resourceCollection: true, ship: false, war: false },
        weaponFridayOnly: false,
        weaponType: "枪械",
        weaponLevel: "蓝级",
        selectedFood: "水稻",
        warFleetPlans: [{ mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }, { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }, { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }],
        warClaimReward: true,
        freq: { weapon: 30, food: 30, tradePort: 10, exhibition: 10, intelligence: 4, hangUpReward: 1, resourceExperience: 10, resourceFactory: 10, ship: 60, war: 20 },
        resourceCollection: { hangUpReward: true, experience: false, factory: false },
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
    };
}

var panel = makePanel();
scheduler.run({
    images: {},
    panel: panel,
    shouldStop: function() { return stop; },
    log: function() {},
    setStatus: function() {},
    onAction: function(taskKey) { actions.push(taskKey); }
});

assert.strictEqual(calls.length, 2, "同一会话应在首次完成后再次调用任务并交由冷却分支跳过");
assert.strictEqual(calls[0].intervalHours, 1, "默认完成后间隔必须为 1 小时");
assert.strictEqual(calls[0].lastCompletedAt, 0);
// 挂机奖励没有主页统计卡片，与贸易港口、展区一样不应额外触发 onAction。
assert.strictEqual(actions.length, 0);
assert.strictEqual(sleeps, 2, "首次完成后总调度只应等待两秒并快速进入下一轮");

phase = "restart";
stop = false;
calls = [];
scheduler.run({
    images: {},
    panel: makePanel(),
    shouldStop: function() { return stop; },
    log: function() {},
    setStatus: function() {},
    onAction: function(taskKey) { actions.push(taskKey); }
});

assert.strictEqual(calls.length, 1, "重启调度器后应立即重新检查挂机奖励");
assert.strictEqual(calls[0].intervalHours, 1);

/**
 * 验证小时级冷却不会独占总调度，所有任务均由自身冷却分支快速返回。
 */
function testCooldownDoesNotBlockOtherEnabledTasks() {
    phase = "mixed-cooldown";
    stop = false;
    calls = [];
    sleeps = 0;
    var statuses = [];
    var mixedPanel = makePanel();
    mixedPanel.taskEnabled.intelligence = true;
    scheduler.run({
        images: {},
        panel: mixedPanel,
        shouldStop: function() { return stop; },
        log: function() {},
        setStatus: function(status) { statuses.push(status); },
        onAction: function() {}
    });

    assert.strictEqual(calls.length, 1, "混合任务仍应检查挂机奖励一次");
    assert.ok(statuses.indexOf("本轮检查完成，2 秒后继续") >= 0, "混合任务应保持两秒任务轮转");
}

testCooldownDoesNotBlockOtherEnabledTasks();
console.log("scheduler hang-up reward test passed");
