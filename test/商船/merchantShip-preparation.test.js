// merchantShip-preparation.test.js — 验证准备期停留在活动弹窗，整点才点击货轮列表。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var originalClick = global.click;
var originalSleep = global.sleep;
var originalLog = global.log;
var clicks = [];
var events = [];
var shipInListVisible = true;
var idleFleetAvailable = true;

/**
 * 创建供模板匹配桩区分的最小图片对象。
 * @param {string} name 模板名称。
 * @returns {Object} 含固定尺寸的图片替身。
 */
function image(name) {
    return {
        name: name,
        getWidth: function() { return 10; },
        getHeight: function() { return 10; }
    };
}

var imgs = {
    shipIcon: image("shipIcon"),
    shipLarge: image("shipLarge"),
    shipCargoList: image("shipCargoList"),
    shipInList: image("shipInList"),
    shipGoBtn: image("shipGoBtn"),
    fleetGo: image("fleetGo"),
    fleetIdle: image("fleetIdle"),
    fleetUnchecked: image("fleetUnchecked"),
    fleetDispatch: image("fleetDispatch"),
    shipCloseList: image("shipCloseList"),
    shipClosePage: image("shipClosePage")
};

// 准备期只需要识别商船图标和活动弹窗；货轮列表及后续按钮由整点动作识别。
var gameHelper = {
    findFirst: function(template) {
        var points = {
            shipIcon: { x: 10, y: 10 },
            shipLarge: { x: 30, y: 10 },
            shipCargoList: { x: 50, y: 10 },
            shipInList: { x: 70, y: 10 },
            fleetGo: { x: 90, y: 10 },
            shipCloseList: { x: 110, y: 10 },
            shipClosePage: { x: 130, y: 10 }
        };
        if (template.name === "shipInList" && !shipInListVisible) return null;
        return points[template.name] || null;
    },
    findAll: function(template) {
        return template.name === "shipGoBtn" ? [{ x: 80, y: 20 }] : [];
    },
    getMaxYPoint: function(points) { return points[0]; },
    notifyRequiredPositionMissing: function() { return false; }
};

var moduleStubs = {
    "./gameHelper.js": gameHelper,
    "./fleet.js": {
        isIdle: function() { return idleFleetAvailable ? { x: 100, y: 30 } : null; },
        selectUnchecked: function() { events.push("selectFleet"); return 1; },
        dispatch: function() { events.push("dispatch"); return true; }
    },
    "./navigate.js": { detectScene: function() { return "world"; } }
};

Module._load = function(request, parent, isMain) {
    if (moduleStubs[request]) return moduleStubs[request];
    return originalLoad.call(this, request, parent, isMain);
};
global.click = function(x, y) { clicks.push([x, y]); };
global.sleep = function() {};
global.log = function() {};

try {
    var merchantShip = require("../../modules/merchantShip.js");
    var prepared = merchantShip.prepare(imgs, function() {}, function() { return false; });
    assert.deepStrictEqual(prepared, { needBackToBase: false });
    assert.deepStrictEqual(clicks, [[15, 15]], "准备期只能点击商船图标，不得提前进入货轮列表");

    assert.strictEqual(merchantShip.startPrepared(imgs, prepared, function() {}, function() { return false; }), "dispatched");
    assert.deepStrictEqual(clicks, [[15, 15], [55, 15], [85, 25], [95, 15]], "整点必须先点击货轮列表，再执行货轮和舰队前往");
    assert.deepStrictEqual(events, ["selectFleet", "dispatch"]);

    // 驻守或行军导致无空闲舰队时只跳过本轮，绝不能继续点击出征。
    clicks = [];
    events = [];
    idleFleetAvailable = false;
    assert.strictEqual(merchantShip.startPrepared(imgs, prepared, function() {}, function() { return false; }), "noIdleFleet");
    assert.deepStrictEqual(clicks, [[55, 15], [85, 25], [95, 15]], "无空闲舰队时只能进入舰队页确认，不得点击出征");
    assert.deepStrictEqual(events, []);

    // 货轮不在列表是当前整点的终态，关闭两个活动层后交给调度器等待下一整点。
    clicks = [];
    idleFleetAvailable = true;
    shipInListVisible = false;
    assert.strictEqual(merchantShip.startPrepared(imgs, prepared, function() {}, function() { return false; }), "empty");
    assert.deepStrictEqual(clicks, [[55, 15], [115, 15], [135, 15]], "货轮消失时必须关闭列表和商船页面");
} finally {
    Module._load = originalLoad;
    global.click = originalClick;
    global.sleep = originalSleep;
    global.log = originalLog;
}

console.log("merchant ship preparation test passed");
