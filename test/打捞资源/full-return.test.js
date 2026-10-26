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
    + "\nmodule.exports._waitForGatherFacility = waitForGatherFacility;"
    + "\nmodule.exports._GROUPS = GROUPS;";
var testModule = new Module(sourcePath, module);
testModule.filename = sourcePath;
testModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
testModule._compile(moduleSource, sourcePath);

var fakeNow = 0;
var matchSequence = [];
var matchedImages = [];
var clicks = [];
var pinchCalls = 0;
var overlayCalls = [];
var interactionEvents = [];
var recoveryReports = [];
var fakeGameHelper = {
    /**
     * 记录设施框选请求，验证点击前会复用种植流程的绿色识别框。
     * @param {{x: number, y: number}} point 已识别模板的左上角坐标。
     * @param {Object} image 与识别结果对应的模板图片。
     */
    showOverlay: function(point, image) {
        overlayCalls.push({ point: point, image: image });
        interactionEvents.push(["overlay", point.x, point.y]);
    },
    /**
     * 记录采集流程缺位时是否复用了统一的必要位置告警与回主页恢复入口。
     * @param {string} taskName 任务名称。
     * @param {string} positionName 未确认的必要位置。
     * @returns {boolean} 本测试只验证调用，恢复结果由调度器的场景守卫处理。
     */
    reportRequiredPositionMissing: function(taskName, positionName, taskLog) {
        recoveryReports.push([taskName, positionName]);
        // 真实公共入口会先输出缺位证据；测试桩保留该可观测行为，避免把恢复调用误当成静默吞错。
        if (typeof taskLog === "function") taskLog("[" + taskName + "] 未识别到必要位置“" + positionName + "”，本轮已停止操作");
        return false;
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
 * 坐标对象可额外携带 similarity，以验证每个类别只会调用其经过实机核验的设施模板。
     * @returns {{matches: Array}} 模拟的设施模板匹配结果。
     */
    matchTemplate: function(screen, image) {
        matchedImages.push(image);
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

// 新版钓鱼页面以右下角“自动”替代旧版“甩杆”；任一稳定页面控件命中都应确认入口已完成。
fakeNow = 0;
matchSequence = [null, { x: 90, y: 100 }];
assert.strictEqual(
    testModule.exports._waitForFishingStarted({}, {}, function() { return false; }),
    true
);
assert.strictEqual(fakeNow, 0, "新版自动按钮首帧命中即可证明已经离开设施菜单");

// 拾荒泊位的小人休息和外出时画面互斥；休息状态未命中后必须改用外出状态模板，而不是回退到固定坐标。
fakeNow = 0;
var scavengingFacilityResting = {
    getWidth: function() { return 190; },
    getHeight: function() { return 140; }
};
var scavengingFacilityAway = {
    getWidth: function() { return 80; },
    getHeight: function() { return 120; }
};
var scavengingGroup = testModule.exports._GROUPS.filter(function(group) { return group.key === "scavenging"; })[0];
assert.deepStrictEqual(scavengingGroup.facilityTemplates, [
    { imageKey: "gatherScavengingFacilityStateOne", label: "拾荒设施-休息" },
    { imageKey: "gatherScavengingFacilityStateTwo", label: "拾荒设施-外出" }
]);
matchedImages = [];
matchSequence = [null, { x: 360, y: 480, similarity: 0.91 }];
assert.deepStrictEqual(
    testModule.exports._waitForGatherFacility({
        gatherScavengingFacilityStateOne: scavengingFacilityResting,
        gatherScavengingFacilityStateTwo: scavengingFacilityAway
    }, scavengingGroup, function() { return false; }),
    { point: { x: 360, y: 480 }, image: scavengingFacilityAway, label: "拾荒设施-外出", similarity: 0.91 }
);
assert.deepStrictEqual(matchedImages, [scavengingFacilityResting, scavengingFacilityAway], "休息状态未命中时必须顺序尝试外出状态");
assert.strictEqual(fakeNow, 0, "外出状态首轮命中后不应额外等待或回退到坐标点击");

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

// 识别到设施后必须先绘制绿色框再点击模板中心，并等待入口；入口缺失时即使导航图标仍可见，也必须强制返回并确认主界面。
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
    false,
    fakeGameHelper
), { entered: false, shouldContinue: false, unconfirmedEntry: false });
assert.deepStrictEqual(clicks, [[78, 200], [902, 671], [898, 1068], [200, 280], [78, 2202]]);
assert.strictEqual(pinchCalls, 1, "前往后必须先缩小两次地图再找设施");
assert.deepStrictEqual(overlayCalls, [{ point: { x: 100, y: 200 }, image: fishingFacility }]);
// 未找到入口后会强制点击左下返回；断言仅覆盖设施识别框与设施中心点击的顺序。
assert.deepStrictEqual(interactionEvents.slice(-3, -1), [["overlay", 100, 200], ["click", 200, 280]]);

// 设施命中后入口也命中时，必须按“设施中心 → 入口中心”顺序完成点击并报告已进入采集页。
clicks = [];
pinchCalls = 0;
overlayCalls = [];
interactionEvents = [];
fakeNow = 0;
matchSequence = [{ x: 100, y: 200 }, { x: 300, y: 400 }, { x: 500, y: 600 }];
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
), { entered: true, shouldContinue: true });
assert.deepStrictEqual(clicks, [[902, 671], [898, 1068], [200, 280], [400, 480]]);
assert.strictEqual(pinchCalls, 1);
assert.deepStrictEqual(overlayCalls, [{ point: { x: 100, y: 200 }, image: fishingFacility }]);
// 成功路径最后还会点击采集入口，因此取倒数第三、倒数第二项核对设施框选与设施点击的先后。
assert.deepStrictEqual(interactionEvents.slice(-3, -1), [["overlay", 100, 200], ["click", 200, 280]]);
assert.strictEqual(fakeNow, 8000, "设施选中后必须等待详情卡进入可交互状态，再识别并点击钓鱼入口");

// 钓鱼入口点击后必须看到“甩杆”状态；设施菜单仍显示入口时不能直接开始固定时长等待。
clicks = [];
pinchCalls = 0;
overlayCalls = [];
interactionEvents = [];
recoveryReports = [];
matchSequence = [{ x: 100, y: 200 }, { x: 300, y: 400 }];
for (var fishingStartAttempt = 0; fishingStartAttempt < 15; fishingStartAttempt++) matchSequence.push(null);
matchSequence.push({ x: 4, y: 8 });
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
), { entered: false, shouldContinue: false, unconfirmedEntry: false });
assert.deepStrictEqual(clicks, [[902, 671], [898, 1068], [200, 280], [400, 480], [78, 2202]]);
assert.strictEqual(pinchCalls, 1);
assert.deepStrictEqual(recoveryReports, [["打捞资源", "钓鱼开始状态"]], "钓鱼页未确认时必须触发既有通用回主页恢复入口");

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
), { entered: false, shouldContinue: false, unconfirmedEntry: false });
assert.deepStrictEqual(clicks, [[78, 200], [902, 1351], [898, 1068]]);
assert.strictEqual(pinchCalls, 1);
assert.deepStrictEqual(overlayCalls, []);
assert.ok(facilityFailureLogs.some(function(message) { return message.indexOf("下潜设施") >= 0; }));

// 地图上未识别到设施且返回后仍无法确认主界面时，必须把失败升级为未确认，禁止调度器继续点击其他任务。
clicks = [];
pinchCalls = 0;
overlayCalls = [];
interactionEvents = [];
matchSequence = [];
assert.deepStrictEqual(testModule.exports._enterCollection(
    { gatherSalvage: {}, gatherSalvageFacility: {}, baseIcon: {}, worldIcon: {} },
    {
        group: {
            key: "salvage",
            label: "打捞",
            actionImage: "gatherSalvage",
            facilityName: "下潜设施",
            facilityTemplates: [{ imageKey: "gatherSalvageFacility", label: "下潜设施" }]
        },
        stock: { getButton: [902, 1351] }
    },
    { x: 1, y: 1 },
    function() { return false; },
    function() {},
    false,
    fakeGameHelper
), { entered: false, shouldContinue: false, unconfirmedEntry: true });
assert.deepStrictEqual(clicks, [[78, 200], [902, 1351], [898, 1068], [78, 2202]]);
assert.strictEqual(pinchCalls, 1);
assert.deepStrictEqual(overlayCalls, []);

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
