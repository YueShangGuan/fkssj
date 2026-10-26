// plant-full-stock-exit.test.js — 验证满仓播种失败时会退出选种栏并切换到下一种作物

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var clicks = [];
var gestures = [];
var logs = [];
var switchedFoods = [];
var missingPositions = [];
var landDisappearedAfterTap = false;
var constructionBlueprintVisible = false;
var constructionBlueprintThresholds = [];
// 选种界面是否出现与土地纹理命中分离，验证种植必须等待正向页面状态。
var seedSelectorVisible = true;

/**
 * 创建具有 AutoJs6 图片尺寸接口的模板桩，让种植模块可在 Node 中计算实际点击坐标。
 * @param {string} name 模板的业务名称。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} 图片模板桩。
 */
function createTemplate(name) {
    return {
        name: name,
        getWidth: function() { return 40; },
        getHeight: function() { return 40; }
    };
}

var foodNames = ["水稻", "玉米", "土豆", "西红柿", "胡萝卜", "卷心菜", "大豆", "南瓜"];
var imgs = {
    crops: {},
    seeds: {},
    tudi: createTemplate("土地"),
    constructionBlueprint: createTemplate("建筑蓝图"),
    liandao: createTemplate("镰刀"),
    stockFull: createTemplate("库存已满")
};
for (var i = 0; i < foodNames.length; i++) {
    imgs.crops[foodNames[i]] = createTemplate(foodNames[i]);
    imgs.seeds[foodNames[i]] = createTemplate(foodNames[i] + "种子");
}

// 模拟当前满仓选种页：种子图标仍可见，但拖拽后土地状态不变，并显示库存已满提示。
var gameHelper = {
    findAll: function() { return []; },
    findAllToFilter: function() { return [{ x: 400, y: 1600 }]; },
    findLandStable: function() { return landDisappearedAfterTap ? [] : [{ x: 400, y: 1600 }]; },
    findFirst: function(image, threshold) {
        if (image === imgs.constructionBlueprint) {
            constructionBlueprintThresholds.push(threshold);
            return constructionBlueprintVisible ? { x: 200, y: 600 } : null;
        }
        if (image === imgs.stockFull) return { x: 600, y: 1000 };
        return seedSelectorVisible ? { x: 60, y: 2100 } : null;
    },
    showOverlay: function() {},
    getMaxYPoint: function(points) { return points[0]; },
    notifyRequiredPositionMissing: function(taskName, positionName) {
        missingPositions.push([taskName, positionName]);
        return false;
    }
};

// 仅替换种植模块的图片识别依赖，测试不会调用真实截图或设备触控。
Module._load = function(request, parent, isMain) {
    if (request === "./gameHelper.js") return gameHelper;
    if (request === "./navigate.js") return { autoLocate: function() { return true; } };
    return originalLoad.call(this, request, parent, isMain);
};

/**
 * 记录模块计划执行的触控坐标，用于验证先点击土地、再点击海水空白区的顺序。
 * @param {number} x 点击横坐标。
 * @param {number} y 点击纵坐标。
 */
global.click = function(x, y) { clicks.push([x, y]); };
// 记录播种拖拽，确认测试覆盖的是“种子可见但满仓失败”而不是模板缺失分支。
global.gesture = function() { gestures.push(Array.prototype.slice.call(arguments)); };
// 测试只验证动作顺序，不等待真实游戏动画。
global.sleep = function() {};

try {
    var plantFood = require("../../modules/plantFood.js");
    assert.strictEqual(plantFood.runOnce(
        imgs,
        { foodType: "水稻", intervalSeconds: 30, lastCompletedAt: 0 },
        function() { return false; },
        function(message) { logs.push(message); },
        function(nextFood) { switchedFoods.push(nextFood); }
    ), true);
    assert.deepStrictEqual(clicks, [[420, 1640], [120, 1200]]);
    assert.strictEqual(gestures.length, 1);
    assert.deepStrictEqual(switchedFoods, ["玉米"]);
    assert.ok(logs.some(function(message) { return message.indexOf("确认: 水稻 库存已满") >= 0; }));
    assert.ok(logs.some(function(message) { return message.indexOf("退出选种界面") >= 0; }));
    assert.ok(logs.some(function(message) { return message.indexOf("水稻 本轮未完成播种") >= 0; }));
    assert.ok(!logs.some(function(message) { return message === "水稻 本轮完成"; }), "播种失败不能被记录为本轮完成");
    assert.deepStrictEqual(missingPositions, [], "满仓播种失败不应被当作土地模板缺失");

    // 点击土地后识别不到稳定土地时，选种栏仍可能已经打开；必须先点击安全空白区再上报失败。
    clicks = [];
    gestures = [];
    logs = [];
    switchedFoods = [];
    missingPositions = [];
    landDisappearedAfterTap = true;
    assert.strictEqual(plantFood.runOnce(
        imgs,
        { foodType: "水稻", intervalSeconds: 30, lastCompletedAt: 0 },
        function() { return false; },
        function(message) { logs.push(message); },
        function(nextFood) { switchedFoods.push(nextFood); }
    ), true);
    assert.deepStrictEqual(clicks, [[420, 1640], [120, 1200]]);
    assert.strictEqual(gestures.length, 0, "未确认土地时不能开始播种拖拽");
    assert.deepStrictEqual(switchedFoods, [], "土地状态未知时不能切换作物");
    assert.deepStrictEqual(missingPositions, [["种植", "播种土地"]]);
    assert.ok(logs.some(function(message) { return message.indexOf("退出选种界面") >= 0; }));

    // 未完工地块会打开建筑蓝图，不能再点击海水空白区假装关闭选种栏；必须通过既有通用回主页链路安全退出。
    clicks = [];
    gestures = [];
    logs = [];
    switchedFoods = [];
    missingPositions = [];
    constructionBlueprintThresholds = [];
    landDisappearedAfterTap = false;
    constructionBlueprintVisible = true;
    assert.strictEqual(plantFood.runOnce(
        imgs,
        { foodType: "水稻", intervalSeconds: 30, lastCompletedAt: 0 },
        function() { return false; },
        function(message) { logs.push(message); },
        function(nextFood) { switchedFoods.push(nextFood); }
    ), true);
    assert.deepStrictEqual(clicks, [[420, 1640]], "建筑蓝图弹层上不得尝试关闭选种栏");
    assert.strictEqual(gestures.length, 0, "未完工地块不得开始播种拖拽");
    assert.deepStrictEqual(switchedFoods, [], "未完工地块不是作物满仓，不能切换作物");
    assert.deepStrictEqual(missingPositions, [["种植", "已建成可播种农田"]]);
    assert.deepStrictEqual(constructionBlueprintThresholds, [0.6], "建筑弹层必须使用经现场截图验证的专用阈值");
    assert.ok(logs.some(function(message) { return message.indexOf("未完工地块") >= 0; }));

    constructionBlueprintVisible = false;

    // 未出现建筑蓝图也不能凭泥土纹理开播；缺少种子图标时同样走通用回主页恢复，且不触发海水坐标点击。
    clicks = [];
    gestures = [];
    logs = [];
    missingPositions = [];
    seedSelectorVisible = false;
    assert.strictEqual(plantFood.runOnce(
        imgs,
        { foodType: "水稻", intervalSeconds: 30, lastCompletedAt: 0 },
        function() { return false; },
        function(message) { logs.push(message); }
    ), true);
    assert.deepStrictEqual(clicks, [[420, 1640]], "未知弹层上不得尝试关闭选种栏");
    assert.strictEqual(gestures.length, 0, "未确认选种界面不得开始播种拖拽");
    assert.deepStrictEqual(missingPositions, [["种植", "选种界面"]]);
    assert.ok(logs.some(function(message) { return message.indexOf("未确认选种界面") >= 0; }));

    // 总调度会在两秒后再次轮转到种植；未到种植自身间隔必须不定位农田、不识图也不触屏。
    clicks = [];
    gestures = [];
    logs = [];
    assert.strictEqual(plantFood.runOnce(
        imgs,
        { foodType: "水稻", intervalSeconds: 30, lastCompletedAt: Date.now() },
        function() { return false; },
        function(message) { logs.push(message); }
    ), false);
    assert.deepStrictEqual(clicks, [], "种植冷却期不得点击土地或选种栏");
    assert.deepStrictEqual(gestures, [], "种植冷却期不得开始收割或播种手势");
    assert.deepStrictEqual(logs, [], "种植正常冷却应保持静默");

    seedSelectorVisible = true;
} finally {
    Module._load = originalLoad;
}

console.log("plant full-stock exit test passed");
