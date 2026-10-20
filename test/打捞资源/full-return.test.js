// full-return.test.js — 验证不限时拾荒/打捞会识别满仓返航按钮并点击该专属出口

var assert = require("assert");
var fs = require("fs");
var Module = require("module");
var path = require("path");

var sourcePath = path.join(__dirname, "..", "..", "modules", "resourceGather.js");
var moduleSource = fs.readFileSync(sourcePath, "utf8")
    + "\nmodule.exports._waitForFullWarehouse = waitForFullWarehouse;"
    + "\nmodule.exports._waitForCollectionEntry = waitForCollectionEntry;"
    + "\nmodule.exports._waitForFishingStarted = waitForFishingStarted;"
    + "\nmodule.exports._returnFromFullWarehouse = returnFromFullWarehouse;"
    + "\nmodule.exports._returnToMainScene = returnToMainScene;"
    + "\nmodule.exports._enterCollection = enterCollection;"
    + "\nmodule.exports._waitForGatherFacility = waitForGatherFacility;";
var testModule = new Module(sourcePath, module);
testModule.filename = sourcePath;
testModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
testModule._compile(moduleSource, sourcePath);

var fakeNow = 0;
var matchSequence = [];
var clicks = [];
var pinchCalls = 0;
var overlayCalls = [];
var interactionEvents = [];
var fakeGameHelper = {
    /**
     * 记录设施框选请求，验证点击前会复用种植流程的绿色识别框。
     * @param {{x: number, y: number}} point 已识别模板的左上角坐标。
     * @param {Object} image 与识别结果对应的模板图片。
     */
    showOverlay: function(point, image) {
        overlayCalls.push({ point: point, image: image });
        interactionEvents.push(["overlay", point.x, point.y]);
    }
};
var originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
    if (request === "./navigate.js") {
        return {
            /**
             * 模拟资源流程复用导航模块执行两次缩小地图。
             * @param {Function} taskLog 任务日志回调；该桩不需要写入日志。
             */
            pinchZoomOut: function(taskLog) {
                pinchCalls++;
            }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

global.captureScreen = function() {
    return { recycle: function() {} };
};
global.images = {
    findImage: function() {
        return matchSequence.shift() || null;
    },
    /**
     * 将测试队列的坐标转换为带相似度的 matchTemplate 返回值。
     * 坐标对象可额外携带 similarity，以验证多个拾荒动画模板会选择分数最高者。
     * @returns {{matches: Array}} 模拟的设施模板匹配结果。
     */
    matchTemplate: function() {
        var match = matchSequence.shift();
        if (!match) return { matches: [] };
        return {
            matches: [{
                point: { x: match.x, y: match.y },
                similarity: typeof match.similarity === "number" ? match.similarity : 0.99
            }]
        };
    }
};
/**
 * 模拟 AutoJs 触控，并与绿色框事件一起记录顺序以验证先框选后点击。
 * @param {number} x 点击横坐标。
 * @param {number} y 点击纵坐标。
 */
global.click = function(x, y) {
    clicks.push([x, y]);
    interactionEvents.push(["click", x, y]);
};
global.sleep = function(milliseconds) { fakeNow += milliseconds; };

/**
 * 等待给定次数后模拟出现满仓返航按钮。
 * @param {Array} sequence 每次模板查找对应的坐标或 null。
 * @param {number} stopAtMs 到达该虚拟时间后请求停止。
 * @returns {{x: number, y: number}|null} 找到的模板坐标。
 */
function waitForFullReturn(sequence, stopAtMs) {
    fakeNow = 0;
    matchSequence = sequence.slice();
    return testModule.exports._waitForFullWarehouse({}, function() { return fakeNow >= stopAtMs; });
}

// 满仓按钮尚未出现时必须继续等待，不能因为一次未命中就退出采集。
assert.deepStrictEqual(waitForFullReturn([null, { x: 12, y: 24 }], 2000), { x: 12, y: 24 });
assert.strictEqual(fakeNow, 1000);

// 地图目标点点击后入口可能经历数帧转场；仅轮询已确认模板，延迟出现仍可安全进入采集。
fakeNow = 0;
matchSequence = [null, null, { x: 50, y: 60 }];
assert.deepStrictEqual(
    testModule.exports._waitForCollectionEntry({}, function() { return false; }),
    { x: 50, y: 60 }
);
assert.strictEqual(fakeNow, 800);

// 拾荒有两个动画模板；同一张截图中必须比较两者分数并选择最高者，而不是按扫描顺序或退回到坐标点击。
fakeNow = 0;
var scavengingStateOne = {
    getWidth: function() { return 180; },
    getHeight: function() { return 210; }
};
var scavengingStateTwo = {
    getWidth: function() { return 220; },
    getHeight: function() { return 220; }
};
matchSequence = [{ x: 240, y: 360, similarity: 0.91 }, { x: 360, y: 480, similarity: 0.97 }];
assert.deepStrictEqual(
    testModule.exports._waitForGatherFacility({
        gatherScavengingFacilityStateOne: scavengingStateOne,
        gatherScavengingFacilityStateTwo: scavengingStateTwo
    }, {
        facilityTemplates: [
            { imageKey: "gatherScavengingFacilityStateOne", label: "拾荒设施状态一" },
            { imageKey: "gatherScavengingFacilityStateTwo", label: "拾荒设施状态二" }
        ]
    }, function() { return false; }),
    { point: { x: 360, y: 480 }, image: scavengingStateTwo, label: "拾荒设施状态二", similarity: 0.97 }
);
assert.strictEqual(fakeNow, 0, "同一轮应连续比对两个拾荒动画模板，不额外等待");

// 识别到满仓返航后，必须点击模板中心、关闭结算层，再用主界面图标确认返回完成。
clicks = [];
matchSequence = [{ x: 1, y: 2 }, { x: 2, y: 3 }, null, { x: 4, y: 8 }];
assert.strictEqual(testModule.exports._returnFromFullWarehouse(
    { x: 10, y: 20 },
    { getWidth: function() { return 100; }, getHeight: function() { return 80; } },
    {
        tradePortRewardTitle: { getWidth: function() { return 30; }, getHeight: function() { return 40; } },
        rewardDismissHint: {},
        baseIcon: {},
        worldIcon: {}
    },
    { x: 1, y: 1 },
    function() {}
), true);
assert.deepStrictEqual(clicks, [[60, 60], [540, 1800]]);

// 固定时长打捞有收获时，未回主界面才点左下返回，再关闭可选结算层并确认主界面。
clicks = [];
matchSequence = [null, null, { x: 1, y: 2 }, { x: 2, y: 3 }, { x: 4, y: 8 }];
assert.strictEqual(testModule.exports._returnToMainScene(
    {
        tradePortRewardTitle: { getWidth: function() { return 30; }, getHeight: function() { return 40; } },
        rewardDismissHint: {},
        baseIcon: {},
        worldIcon: {}
    },
    { x: 1, y: 1 },
    function() {}
), true);
assert.deepStrictEqual(clicks, [[78, 2202], [540, 1800]]);

// 满仓且本轮无收获时没有结算层，左下返回后应直接确认主界面。
clicks = [];
matchSequence = [null, null, null, { x: 4, y: 8 }];
assert.strictEqual(testModule.exports._returnToMainScene(
    { tradePortRewardTitle: {}, baseIcon: {}, worldIcon: {} },
    { x: 1, y: 1 },
    function() {}
), true);
assert.deepStrictEqual(clicks, [[78, 2202]]);

// 满仓无收获自动返回主界面时，固定左下坐标在主界面可能是其他功能，必须完全不触碰。
clicks = [];
var autoReturnLogs = [];
matchSequence = [{ x: 4, y: 8 }];
assert.strictEqual(testModule.exports._returnToMainScene(
    { baseIcon: {}, worldIcon: {} },
    { x: 1, y: 1 },
    function(message) { autoReturnLogs.push(message); }
), true);
assert.deepStrictEqual(clicks, []);
assert.ok(autoReturnLogs.some(function(message) { return message.indexOf("不再点击固定返回坐标") >= 0; }));

// 识别到设施后必须先绘制绿色框再点击模板中心，并等待入口；若入口缺失但游戏已经回到主界面，不能补点固定左下返回坐标。
clicks = [];
pinchCalls = 0;
overlayCalls = [];
interactionEvents = [];
var fishingFacility = {
    getWidth: function() { return 200; },
    getHeight: function() { return 160; }
};
// 首次命中钓鱼设施，前十次为入口模板的有限轮询；之后才检查基地、世界主界面图标。
matchSequence = [
    { x: 100, y: 200 },
    null, null, null, null, null,
    null, null, null, null, null,
    null, { x: 4, y: 8 }
];
assert.deepStrictEqual(testModule.exports._enterCollection(
    { gatherFishing: {}, gatherFishingFacility: fishingFacility, baseIcon: {}, worldIcon: {} },
    {
        group: {
            label: "钓鱼",
            actionImage: "gatherFishing",
            facilityName: "钓鱼设施",
            facilityTemplates: [{ imageKey: "gatherFishingFacility", label: "钓鱼设施" }]
        },
        stock: { getButton: [902, 671] }
    },
    { x: 1, y: 1 },
    function() { return false; },
    function() {},
    false,
    fakeGameHelper
), { entered: false, shouldContinue: false, unconfirmedEntry: true });
assert.deepStrictEqual(clicks, [[78, 200], [902, 671], [898, 1068], [200, 280]]);
assert.strictEqual(pinchCalls, 1, "前往后必须先缩小两次地图再找设施");
assert.deepStrictEqual(overlayCalls, [{ point: { x: 100, y: 200 }, image: fishingFacility }]);
assert.deepStrictEqual(interactionEvents.slice(-2), [["overlay", 100, 200], ["click", 200, 280]]);

// 设施命中后入口也命中时，必须按“设施中心 → 入口中心”顺序完成点击并报告已进入采集页。
clicks = [];
pinchCalls = 0;
overlayCalls = [];
interactionEvents = [];
matchSequence = [{ x: 100, y: 200 }, { x: 300, y: 400 }, { x: 500, y: 600 }];
assert.deepStrictEqual(testModule.exports._enterCollection(
    { gatherFishing: fishingFacility, gatherFishingFacility: fishingFacility, gatherCast: {}, baseIcon: {}, worldIcon: {} },
    {
        group: {
            label: "钓鱼",
            actionImage: "gatherFishing",
            facilityName: "钓鱼设施",
            facilityTemplates: [{ imageKey: "gatherFishingFacility", label: "钓鱼设施" }]
        },
        stock: { getButton: [902, 671] }
    },
    { x: 1, y: 1 },
    function() { return false; },
    function() {},
    true,
    fakeGameHelper
), { entered: true, shouldContinue: true });
assert.deepStrictEqual(clicks, [[902, 671], [898, 1068], [200, 280], [400, 480]]);
assert.strictEqual(pinchCalls, 1);
assert.deepStrictEqual(overlayCalls, [{ point: { x: 100, y: 200 }, image: fishingFacility }]);
// 成功路径最后还会点击采集入口，因此取倒数第三、倒数第二项核对设施框选与设施点击的先后。
assert.deepStrictEqual(interactionEvents.slice(-3, -1), [["overlay", 100, 200], ["click", 200, 280]]);

// 钓鱼入口点击后必须看到“甩杆”状态；设施菜单仍显示入口时不能直接开始固定时长等待。
clicks = [];
pinchCalls = 0;
overlayCalls = [];
interactionEvents = [];
matchSequence = [{ x: 100, y: 200 }, { x: 300, y: 400 }];
for (var fishingStartAttempt = 0; fishingStartAttempt < 15; fishingStartAttempt++) matchSequence.push(null);
assert.deepStrictEqual(testModule.exports._enterCollection(
    { gatherFishing: fishingFacility, gatherFishingFacility: fishingFacility, gatherCast: {}, baseIcon: {}, worldIcon: {} },
    {
        group: {
            key: "fishing",
            label: "钓鱼",
            actionImage: "gatherFishing",
            facilityName: "钓鱼设施",
            facilityTemplates: [{ imageKey: "gatherFishingFacility", label: "钓鱼设施" }]
        },
        stock: { getButton: [902, 671] }
    },
    { x: 1, y: 1 },
    function() { return false; },
    function() {},
    true,
    fakeGameHelper
), { entered: false, shouldContinue: false, unconfirmedEntry: true });
assert.deepStrictEqual(clicks, [[902, 671], [898, 1068], [200, 280], [400, 480]]);
assert.strictEqual(pinchCalls, 1);

// 下潜设施缺失时必须只报告安全失败，不能点击白色手势或旧地图固定点来碰运气。
clicks = [];
pinchCalls = 0;
overlayCalls = [];
interactionEvents = [];
var facilityFailureLogs = [];
matchSequence = [];
for (var facilityAttempt = 0; facilityAttempt < 10; facilityAttempt++) matchSequence.push(null);
matchSequence.push(null, { x: 4, y: 8 });
assert.deepStrictEqual(testModule.exports._enterCollection(
    { gatherSalvage: {}, gatherSalvageFacility: {}, baseIcon: {}, worldIcon: {} },
    {
        group: {
            label: "打捞",
            actionImage: "gatherSalvage",
            facilityName: "下潜设施",
            facilityTemplates: [{ imageKey: "gatherSalvageFacility", label: "下潜设施" }]
        },
        stock: { getButton: [902, 1351] }
    },
    { x: 1, y: 1 },
    function() { return false; },
    function(message) { facilityFailureLogs.push(message); },
    false,
    fakeGameHelper
), { entered: false, shouldContinue: false });
assert.deepStrictEqual(clicks, [[78, 200], [902, 1351], [898, 1068]]);
assert.strictEqual(pinchCalls, 1);
assert.deepStrictEqual(overlayCalls, []);
assert.ok(facilityFailureLogs.some(function(message) { return message.indexOf("下潜设施") >= 0; }));

// 没有出现“恭喜获得”时不能直接认定已回到主界面，留给下轮安全重试。
clicks = [];
matchSequence = [null];
assert.strictEqual(testModule.exports._returnFromFullWarehouse(
    { x: 10, y: 20 },
    { getWidth: function() { return 100; }, getHeight: function() { return 80; } },
    { tradePortRewardTitle: {} },
    { x: 1, y: 1 },
    function() {}
), false);
assert.deepStrictEqual(clicks, [[60, 60]]);

// “恭喜获得”标题已出现但底部关闭提示缺失时，不得提前点击标题关闭层。
clicks = [];
matchSequence = [{ x: 1, y: 2 }];
assert.strictEqual(testModule.exports._returnFromFullWarehouse(
    { x: 10, y: 20 },
    { getWidth: function() { return 100; }, getHeight: function() { return 80; } },
    {
        tradePortRewardTitle: { getWidth: function() { return 30; }, getHeight: function() { return 40; } },
        rewardDismissHint: {}
    },
    { x: 1, y: 1 },
    function() {}
), false);
assert.deepStrictEqual(clicks, [[60, 60]]);

console.log("full return test passed");
Module._load = originalLoad;
