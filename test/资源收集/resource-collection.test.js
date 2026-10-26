// resource-collection.test.js — 覆盖资源气泡的识图、定位和安全停止边界

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var sourcePath = path.join(__dirname, "..", "..", "modules", "resourceCollection.js");
var source = fs.readFileSync(sourcePath, "utf8");

/**
 * 创建带固定尺寸的模板替身，确保测试只验证业务状态机而不依赖真实截图。
 * @param {string} name 模板名称。
 * @returns {{name:string,getWidth:Function,getHeight:Function}} 图片替身。
 */
function makeImage(name) {
    return {
        name: name,
        getWidth: function() { return 60; },
        getHeight: function() { return 60; }
    };
}

/**
 * 构造资源收集模块需要的完整模板集合。
 * @returns {Object} 模板键到图片替身的映射。
 */
function makeImages() {
    return {
        baseIcon: makeImage("baseIcon"),
        forgeHouse: makeImage("forgeHouse"),
        forgeBack: makeImage("forgeBack"),
        resourceExperienceSea: makeImage("sea"),
        resourceExperienceEquipment: makeImage("equipment"),
        resourceExperienceHero: makeImage("hero"),
        resourceFactoryBrick: makeImage("brick"),
        resourceFactoryNecklace: makeImage("necklace"),
        resourceFactoryCrate: makeImage("crate")
    };
}

/**
 * 在 VM 中加载资源收集模块，并由替身控制识图、地图准备和触屏事件。
 * @param {Object} options 场景选项。
 * @returns {{api:Object,state:Object,imgs:Object}} 被测模块与场景状态。
 */
function loadScenario(options) {
    options = options || {};
    var imgs = makeImages();
    var state = {
        clicks: [],
        logs: [],
        notifications: [],
        findCalls: [],
        bubbleSearchSilentFlags: [],
        forgeTrips: 0,
        pinches: 0,
        scene: options.scene || "base",
        afterPrepare: false
    };
    var navigate = {
        detectScene: function() { return state.scene; },
        goToForgeAndBack: function() {
            state.forgeTrips++;
            state.afterPrepare = true;
            return options.forgeSuccess !== false;
        },
        pinchZoomOut: function() { state.pinches++; }
    };
    var gameHelper = {
        findFirst: function(image, threshold, name, silent) {
            state.findCalls.push(image.name);
            if (image !== imgs.baseIcon) state.bubbleSearchSilentFlags.push(silent);
            if (image === imgs.baseIcon) return options.baseEntryMissing ? null : { x: 100, y: 100 };
            var current = state.afterPrepare ? options.afterPrepareCandidates : options.directCandidates;
            return current && current.indexOf(image.name) >= 0 ? { x: 200, y: 300 } : null;
        },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            state.notifications.push([taskName, positionName]);
            return false;
        }
    };
    var context = {
        module: { exports: {} },
        exports: {},
        require: function(request) {
            if (request === "./navigate.js") return navigate;
            if (request === "./gameHelper.js") return gameHelper;
            throw new Error("unexpected require: " + request);
        },
        click: function(x, y) { state.clicks.push([x, y]); },
        sleep: function() {},
        log: function(message) { state.logs.push(message); },
        Date: Date,
        console: console
    };
    vm.runInNewContext(source, context, { filename: sourcePath });
    return { api: context.module.exports, state: state, imgs: imgs };
}

/**
 * 生成默认启用的资源收集配置，并允许场景覆盖单项开关或冷却。
 * @param {Object} overrides 覆盖配置。
 * @returns {Object} 模块输入配置。
 */
function makeConfig(overrides) {
    overrides = overrides || {};
    return {
        experience: Object.assign({ enabled: true, intervalMinutes: 10, lastCompletedAt: 0 }, overrides.experience),
        factory: Object.assign({ enabled: true, intervalMinutes: 10, lastCompletedAt: 0 }, overrides.factory)
    };
}

/**
 * 验证直接命中经验气泡时无需经锻造坊重置地图，并只点击气泡中心一次。
 */
function testDirectExperienceCollect() {
    var scenario = loadScenario({ directCandidates: ["sea"] });
    var result = scenario.api.runOnce(scenario.imgs, makeConfig({ factory: { enabled: false } }), function() { return false; }, function(message) { scenario.state.logs.push(message); });
    assert.strictEqual(result.experience.status, "completed");
    assert.strictEqual(scenario.state.forgeTrips, 0);
    assert.strictEqual(scenario.state.pinches, 0);
    assert.deepStrictEqual(scenario.state.clicks, [[230, 330]], "必须点击已识别经验气泡模板中心");
}

/**
 * 验证首轮未命中时会执行一次锻造坊往返与双指缩小，随后才点击收集目标。
 */
function testPrepareMapBeforeSecondSearch() {
    var scenario = loadScenario({ afterPrepareCandidates: ["equipment"] });
    var result = scenario.api.runOnce(scenario.imgs, makeConfig({ factory: { enabled: false } }), function() { return false; }, function() {});
    assert.strictEqual(result.experience.status, "completed");
    assert.strictEqual(scenario.state.forgeTrips, 1);
    assert.strictEqual(scenario.state.pinches, 1, "应复用种田的两次双指缩小流程");
    assert.deepStrictEqual(scenario.state.clicks, [[230, 330]]);
}

/**
 * 验证工厂只收取任意一个已识别产物，不会在气泡摆动期间继续遍历点击其他工厂。
 */
function testFactoryCollectsOneBubble() {
    var scenario = loadScenario({ directCandidates: ["crate", "brick"] });
    var result = scenario.api.runOnce(scenario.imgs, makeConfig({ experience: { enabled: false } }), function() { return false; }, function() {});
    assert.strictEqual(result.factory.status, "completed");
    assert.strictEqual(scenario.state.clicks.length, 1, "工厂生产收集每轮只能点击一个气泡");
    assert.strictEqual(scenario.state.forgeTrips, 0);
}

/**
 * 验证没有可领取资源是正常轮询结果：可以准备地图，但不能提示缺位或误点任何建筑。
 */
function testNoTargetIsSilent() {
    var scenario = loadScenario({});
    var result = scenario.api.runOnce(scenario.imgs, makeConfig({ factory: { enabled: false } }), function() { return false; }, function(message) { scenario.state.logs.push(message); });
    assert.strictEqual(result.experience.status, "idle");
    assert.strictEqual(scenario.state.forgeTrips, 1);
    assert.strictEqual(scenario.state.clicks.length, 0);
    assert.strictEqual(scenario.state.notifications.length, 0, "正常无气泡不得触发必要位置提示");
    assert.deepStrictEqual(scenario.state.bubbleSearchSilentFlags, [true, true, true, true, true, true], "候选气泡未命中必须静默，避免正常轮询污染日志");
}

/**
 * 验证停止请求和未知页面都会在触屏前安全结束，不猜测锻造坊或气泡坐标。
 */
function testStopAndUnknownSceneAreSafe() {
    var stopped = loadScenario({ directCandidates: ["sea"] });
    var stoppedResult = stopped.api.runOnce(stopped.imgs, makeConfig(), function() { return true; }, function() {});
    assert.strictEqual(stoppedResult.experience.status, "interrupted");
    assert.strictEqual(stopped.state.clicks.length, 0);

    var unknown = loadScenario({ scene: "unknown", directCandidates: ["sea"] });
    var unknownResult = unknown.api.runOnce(unknown.imgs, makeConfig({ factory: { enabled: false } }), function() { return false; }, function() {});
    assert.strictEqual(unknownResult.experience.status, "failed");
    assert.strictEqual(unknown.state.clicks.length, 0);
    assert.deepStrictEqual(unknown.state.notifications, [["资源收集", "游戏主界面"]]);
}

testDirectExperienceCollect();
testPrepareMapBeforeSecondSearch();
testFactoryCollectsOneBubble();
testNoTargetIsSilent();
testStopAndUnknownSceneAreSafe();

console.log("resource collection tests passed");
