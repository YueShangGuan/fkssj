// global-return-main.test.js — 验证必要元素缺失后的通用回主页状态机。

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;

/**
 * 构造带固定尺寸的图片模板替身，便于断言模板中心点击。
 * @param {string} name 模板业务名称。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} 测试模板。
 */
function makeImage(name) {
    return {
        name: name,
        getWidth: function() { return 10; },
        getHeight: function() { return 10; }
    };
}

/**
 * 构造覆盖奖励、弹窗与返回场景的模板集合。
 * @returns {Object} 回主页流程需要的测试模板。
 */
function makeImages() {
    return {
        baseIcon: makeImage("基地"),
        worldIcon: makeImage("世界"),
        exhibitionClaimReward: makeImage("领取奖励"),
        tradePortRewardTitle: makeImage("恭喜获得"),
        rewardDismissHint: makeImage("点击空白区域关闭"),
        exhibitionClose: makeImage("关闭"),
        exhibitionBack: makeImage("返回")
    };
}

/**
 * 按当前模拟页面返回可见模板坐标，未出现的模板一律返回 null。
 * @param {Object} imgs 测试模板。
 * @param {{page: string}} state 当前页面状态。
 * @param {Object} image 需要匹配的模板。
 * @returns {{x: number, y: number}|null} 模板位置或 null。
 */
function findVisibleTemplate(imgs, state, image) {
    if (image === imgs.worldIcon && state.page === "base") return { x: 10, y: 10 };
    if (image === imgs.exhibitionClaimReward && state.page === "claim") return { x: 100, y: 10 };
    if (image === imgs.tradePortRewardTitle && state.page === "congrats") return { x: 200, y: 10 };
    if (image === imgs.exhibitionClose && state.page === "dialog") return { x: 300, y: 10 };
    if (image === imgs.exhibitionBack && (state.page === "treasure" || state.page === "exhibition")) return { x: 400, y: 10 };
    return null;
}

/**
 * 使用可控页面状态加载导航模块，隔离 AutoJs6 截图和触控 API。
 * @param {{page: string}} state 当前页面状态。
 * @param {boolean} [rewardDismissible=true] 奖励层是否已出现安全关闭提示。
 * @returns {{navigate: Object, imgs: Object, clicks: number[][]}} 可执行的测试场景。
 */
function loadScenario(state, rewardDismissible) {
    var imgs = makeImages();
    var clicks = [];
    var sceneChecks = 0;
    Module._load = function(request, parent, isMain) {
        if (request === "./gameHelper.js") {
            return {
                findFirst: function(image) {
                    // 每轮 detectScene 都会查询世界图标，计数可验证每次点击后均重新确认页面。
                    if (image === imgs.worldIcon) sceneChecks += 1;
                    return findVisibleTemplate(imgs, state, image);
                },
                waitForRewardDismissHint: function() { return rewardDismissible !== false; }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve("../../modules/navigate.js")];
    var navigate = require("../../modules/navigate.js");
    global.click = function(x, y) {
        clicks.push([x, y]);
        if (x === 105 && state.page === "claim") state.page = "congrats";
        // 奖励标题仅用于确认页面；只有物品与底部提示之间的已验证空白区才会关闭弹层。
        else if (x === 540 && y === 1800 && state.page === "congrats") state.page = "dialog";
        else if (x === 305 && state.page === "dialog") state.page = "treasure";
        else if (x === 405 && state.page === "treasure") state.page = "exhibition";
        else if (x === 405 && state.page === "exhibition") state.page = "base";
    };
    global.sleep = function() {};
    global.log = function() {};
    return {
        navigate: navigate,
        imgs: imgs,
        clicks: clicks,
        getSceneChecks: function() { return sceneChecks; }
    };
}

try {
    var baseScenario = loadScenario({ page: "base" });
    assert.strictEqual(baseScenario.navigate.recoverToMainScene(baseScenario.imgs, function() { return false; }, function() {}), true);
    assert.deepStrictEqual(baseScenario.clicks, []);

    var fullScenario = loadScenario({ page: "claim" });
    assert.strictEqual(fullScenario.navigate.recoverToMainScene(fullScenario.imgs, function() { return false; }, function() {}), true);
    assert.deepStrictEqual(fullScenario.clicks, [[105, 15], [540, 1800], [305, 15], [405, 15], [405, 15]]);
    assert.strictEqual(fullScenario.getSceneChecks(), 6, "每次点击后都应重新确认当前页面");

    var blockedRewardScenario = loadScenario({ page: "congrats" }, false);
    assert.strictEqual(blockedRewardScenario.navigate.recoverToMainScene(blockedRewardScenario.imgs, function() { return false; }, function() {}), false);
    assert.deepStrictEqual(blockedRewardScenario.clicks, []);

    var stoppedScenario = loadScenario({ page: "dialog" });
    assert.strictEqual(stoppedScenario.navigate.recoverToMainScene(stoppedScenario.imgs, function() { return true; }, function() {}), false);
    assert.deepStrictEqual(stoppedScenario.clicks, []);

    var unknownScenario = loadScenario({ page: "unknown" });
    assert.strictEqual(unknownScenario.navigate.recoverToMainScene(unknownScenario.imgs, function() { return false; }, function() {}), false);
    assert.deepStrictEqual(unknownScenario.clicks, []);
    assert.strictEqual(unknownScenario.getSceneChecks(), 6, "无恢复控件时最多执行六轮识别");
} finally {
    Module._load = originalLoad;
}

console.log("global return-main test passed");
