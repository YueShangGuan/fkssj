// resourceCollection.js — 主城经验气泡与工厂生产物资收集

var resourceCollection = {};

var MATCH_THRESHOLD = 0.8;
var BASE_CONFIRM_ATTEMPTS = 3;
var BASE_CONFIRM_RETRY_DELAY_MS = 400;

/**
 * 读取分钟级子功能的有效冷却。面板已限制为正整数，但模块仍拦截损坏的本地配置，避免高频重复触屏。
 * @param {Object} config 子功能配置。
 * @returns {number|null} 有效分钟数；无效时返回 null。
 */
function getIntervalMinutes(config) {
    var minutes = Number(config && config.intervalMinutes);
    return isFinite(minutes) && minutes > 0 && Math.floor(minutes) === minutes ? minutes : null;
}

/**
 * 判断子功能是否仍处于本次总调度会话内的冷却期。
 * @param {Object} config 子功能配置。
 * @param {number} intervalMinutes 有效冷却分钟数。
 * @returns {boolean} 尚未到下一次检查时间时返回 true。
 */
function isCoolingDown(config, intervalMinutes) {
    var completedAt = Number(config && config.lastCompletedAt) || 0;
    return completedAt > 0 && Date.now() - completedAt < intervalMinutes * 60 * 1000;
}

/**
 * 在当前整张截图中查找任一指定气泡。模板匹配会在每次调用时重新截图，因此气泡左右摆动不会依赖固定坐标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Array<string>} imageKeys 候选模板键。
 * @param {Object} gameHelper 公共识图工具。
 * @param {string} label 用于识图日志的业务名称。
 * @returns {{point:Object,image:Object,key:string}|null} 首个已确认候选；没有命中时返回 null。
 */
function findCollectible(imgs, imageKeys, gameHelper, label) {
    for (var i = 0; i < imageKeys.length; i++) {
        var key = imageKeys[i];
        var image = imgs && imgs[key];
        if (!image) continue;
        // 气泡不存在是正常轮询结果；静默未命中，保留后续页面或资源缺失时的真实告警。
        var point = gameHelper.findFirst(image, MATCH_THRESHOLD, label + "气泡", true);
        if (point) return { point: point, image: image, key: key };
    }
    return null;
}

/**
 * 点击模板中心。气泡的内部图标位于模板中心，避免因图钉尖端或摆动阴影而点到建筑物。
 * @param {{point:Object,image:Object}} candidate 已识别候选。
 */
function clickCollectibleCenter(candidate) {
    click(
        Math.round(candidate.point.x + candidate.image.getWidth() / 2),
        Math.round(candidate.point.y + candidate.image.getHeight() / 2)
    );
}

/**
 * 在有限轮询内确认仍安全处于基地。领取若打开意外弹层，不能把后续子功能的点击继续落在弹层上。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} navigate 场景导航模块。
 * @param {Function} shouldStop 停止请求。
 * @returns {boolean} 确认基地时返回 true。
 */
function waitForBaseScene(imgs, navigate, shouldStop) {
    for (var attempt = 0; attempt < BASE_CONFIRM_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (navigate.detectScene(imgs) === "base") return true;
        if (attempt < BASE_CONFIRM_ATTEMPTS - 1) sleep(BASE_CONFIRM_RETRY_DELAY_MS);
    }
    return false;
}

/**
 * 将世界场景安全切换到基地；未知场景不能猜测入口或固定坐标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} navigate 场景导航模块。
 * @param {Object} gameHelper 公共识图工具。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 调度器日志。
 * @returns {boolean} 已确认基地时返回 true。
 */
function ensureBaseScene(imgs, navigate, gameHelper, shouldStop, logFn) {
    var scene = navigate.detectScene(imgs);
    if (scene === "base") return true;
    if (scene !== "world") return gameHelper.notifyRequiredPositionMissing("资源收集", "游戏主界面", logFn);

    var basePoint = gameHelper.findFirst(imgs.baseIcon, 0.7, "基地图标");
    if (!basePoint) return gameHelper.notifyRequiredPositionMissing("资源收集", "基地入口", logFn);
    click(basePoint.x + imgs.baseIcon.getWidth() / 2, basePoint.y + imgs.baseIcon.getHeight() / 2);
    sleep(1500);
    if (waitForBaseScene(imgs, navigate, shouldStop)) return true;
    return gameHelper.notifyRequiredPositionMissing("资源收集", "基地界面确认", logFn);
}

/**
 * 未发现气泡时，以锻造坊往返重置地图锚点后执行两次缩小。整个任务组最多准备一次，避免两个子功能重复移动地图。
 * @param {Object} context 本轮共享的地图准备状态。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} navigate 场景导航模块。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 调度器日志。
 * @returns {boolean} 地图准备完成且已确认基地时返回 true。
 */
function prepareSearchView(context, imgs, navigate, shouldStop, logFn) {
    if (context.prepared) return false;
    context.prepared = true;
    if (!navigate.goToForgeAndBack(imgs, logFn, "资源收集")) return false;
    if (shouldStop()) return false;
    navigate.pinchZoomOut(logFn);
    if (shouldStop()) return false;
    return waitForBaseScene(imgs, navigate, shouldStop);
}

/**
 * 运行一个分钟级收集子功能。无目标是正常结果，只在确定气泡存在后触屏一次。
 * @param {string} label 面板显示的子功能名称。
 * @param {Array<string>} imageKeys 该子功能允许点击的模板键。
 * @param {Object} config 子功能配置。
 * @param {Object} context 本轮共享的地图准备状态。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} navigate 场景导航模块。
 * @param {Object} gameHelper 公共识图工具。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 调度器日志。
 * @returns {{status:string,safe:boolean}} 子功能状态及是否仍可继续后续子功能。
 */
function collectCategory(label, imageKeys, config, context, imgs, navigate, gameHelper, shouldStop, logFn) {
    if (!config || config.enabled !== true) return { status: "disabled", safe: true };
    var intervalMinutes = getIntervalMinutes(config);
    if (!intervalMinutes) {
        logFn("[资源收集 / " + label + "] 配置无效，本轮跳过");
        return { status: "failed", safe: true };
    }
    if (shouldStop()) return { status: "interrupted", safe: true };
    if (isCoolingDown(config, intervalMinutes)) return { status: "cooldown", safe: true };
    for (var i = 0; i < imageKeys.length; i++) {
        if (!imgs || !imgs[imageKeys[i]]) {
            logFn("[资源收集 / " + label + "] 图片资源未加载，本轮跳过");
            return { status: "failed", safe: true };
        }
    }
    if (!ensureBaseScene(imgs, navigate, gameHelper, shouldStop, logFn)) return { status: "failed", safe: false };

    var candidate = findCollectible(imgs, imageKeys, gameHelper, label);
    if (!candidate) {
        if (!prepareSearchView(context, imgs, navigate, shouldStop, logFn)) {
            return { status: shouldStop() ? "interrupted" : "idle", safe: waitForBaseScene(imgs, navigate, shouldStop) };
        }
        candidate = findCollectible(imgs, imageKeys, gameHelper, label);
    }
    // 地图准备后的再次查找仍无结果是正常轮询结果，不提示也不写冷却。
    if (!candidate) return { status: "idle", safe: true };

    clickCollectibleCenter(candidate);
    logFn("[资源收集 / " + label + "] 点击可领取气泡");
    sleep(800);
    if (shouldStop()) return { status: "interrupted", safe: true };
    if (!waitForBaseScene(imgs, navigate, shouldStop)) {
        gameHelper.notifyRequiredPositionMissing("资源收集", label + "领取后基地界面", logFn);
        return { status: "failed", safe: false };
    }
    return { status: "completed", safe: true };
}

/**
 * 执行一次经验气泡和工厂产物检查。两个子功能共享一次锻造坊往返与缩小地图，完成时间由总调度器仅在本会话保存。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{experience:Object,factory:Object}} config 两个分钟级子功能配置。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} uiLog 调度器日志。
 * @returns {{experience:{status:string,safe:boolean},factory:{status:string,safe:boolean}}} 子功能执行结果。
 */
resourceCollection.runOnce = function(imgs, config, shouldStop, uiLog) {
    var stopRequested = shouldStop || function() { return false; };
    var logFn = uiLog || function(message) { log(message); };
    var navigate = require("./navigate.js");
    var gameHelper = require("./gameHelper.js");
    var context = { prepared: false };
    var result = {
        experience: collectCategory(
            "收集资源",
            ["resourceExperienceSea", "resourceExperienceEquipment", "resourceExperienceHero"],
            config && config.experience,
            context,
            imgs,
            navigate,
            gameHelper,
            stopRequested,
            logFn
        ),
        factory: { status: "disabled", safe: true }
    };
    if (stopRequested() || !result.experience.safe) return result;
    result.factory = collectCategory(
        "工厂生产收集",
        ["resourceFactoryBrick", "resourceFactoryNecklace", "resourceFactoryCrate"],
        config && config.factory,
        context,
        imgs,
        navigate,
        gameHelper,
        stopRequested,
        logFn
    );
    return result;
};

module.exports = resourceCollection;
