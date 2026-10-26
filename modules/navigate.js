// navigate.js — 自动定位到种植区域

var navigate = {};

var gh = require("./gameHelper.js");
var MAIN_SCENE_RECOVERY_ATTEMPTS = 6;
var MAIN_SCENE_RECOVERY_RETRY_DELAY_MS = 700;
// MuMu 1080×2400 奖励页中，(540, 1800) 是物品和底部提示之间的空白关闭区；标题仅可作为页面确认模板。
var REWARD_EMPTY_CLOSE_POINT = [540, 1800];

/**
 * 将模板匹配坐标转换为安全的中心点击。
 * 恢复流程只会调用已识别的模板，禁止用固定坐标猜测当前弹层。
 * @param {{x: number, y: number}} point 模板左上角坐标。
 * @param {Object} image 对应的模板图片。
 */
function clickTemplateCenter(point, image) {
    click(point.x + image.getWidth() / 2, point.y + image.getHeight() / 2);
}

/**
 * 写入异常恢复过程日志；调度器提供的回调会同步写入界面和运行 JSONL。
 * @param {Function} logFn 可选的任务日志回调。
 * @param {string} message 用户可读的恢复状态。
 */
function logRecovery(logFn, message) {
    if (typeof logFn === "function") logFn("[全局恢复] " + message);
    else log("[全局恢复] " + message);
}

/**
 * 从必要元素缺失后的未知页面恢复至已确认的游戏主界面。
 * 每轮只执行一个已识别控件，页面切换后重新识别，避免把同一轮的后续点击落到动画或新弹层上。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} [shouldStop] 停止标记，返回 true 时不再执行触控。
 * @param {Function} [logFn] 用于记录恢复过程的日志回调。
 * @returns {boolean} 已确认基地或世界主界面时返回 true；无法安全识别时返回 false。
 */
navigate.recoverToMainScene = function(imgs, shouldStop, logFn) {
    var isStopRequested = typeof shouldStop === "function" ? shouldStop : function() { return false; };
    for (var attempt = 1; attempt <= MAIN_SCENE_RECOVERY_ATTEMPTS; attempt++) {
        if (isStopRequested()) {
            logRecovery(logFn, "收到停止请求，取消回主页操作");
            return false;
        }

        var scene = navigate.detectScene(imgs);
        if (scene !== "unknown") {
            logRecovery(logFn, "第 " + attempt + " 轮确认已在" + (scene === "base" ? "基地" : "世界") + "主界面");
            return true;
        }

        // 奖励领取页会遮挡返回控件；先完成明确的领奖链路，才能安全判断后续页面。
        var claimPoint = imgs.exhibitionClaimReward && gh.findFirst(imgs.exhibitionClaimReward, 0.8, "全局恢复领取奖励");
        if (claimPoint) {
            clickTemplateCenter(claimPoint, imgs.exhibitionClaimReward);
            logRecovery(logFn, "第 " + attempt + " 轮点击领取奖励");
            sleep(900);
            continue;
        }

        var rewardPoint = imgs.tradePortRewardTitle && gh.findFirst(imgs.tradePortRewardTitle, 0.8, "全局恢复恭喜获得");
        if (rewardPoint) {
            // 奖励物品仍在入场时空白区点击会被吞掉，必须等待既有关闭提示后才关闭。
            if (!gh.waitForRewardDismissHint(imgs.rewardDismissHint, isStopRequested, "全局恢复奖励关闭提示")) {
                logRecovery(logFn, "第 " + attempt + " 轮未确认奖励关闭提示，停止恢复");
                return false;
            }
            // 标题证明当前是奖励层；游戏明确要求点击空白区域关闭，不能把标题当成关闭控件。
            click(REWARD_EMPTY_CLOSE_POINT[0], REWARD_EMPTY_CLOSE_POINT[1]);
            logRecovery(logFn, "第 " + attempt + " 轮关闭恭喜获得弹层");
            sleep(700);
            continue;
        }

        var closePoint = imgs.exhibitionClose && gh.findFirst(imgs.exhibitionClose, 0.8, "全局恢复弹窗关闭");
        if (closePoint) {
            clickTemplateCenter(closePoint, imgs.exhibitionClose);
            logRecovery(logFn, "第 " + attempt + " 轮关闭右上角弹窗");
            sleep(700);
            continue;
        }

        var backPoint = imgs.exhibitionBack && gh.findFirst(imgs.exhibitionBack, 0.8, "全局恢复左下角返回");
        if (backPoint) {
            clickTemplateCenter(backPoint, imgs.exhibitionBack);
            logRecovery(logFn, "第 " + attempt + " 轮点击左下角返回");
            sleep(900);
            continue;
        }

        // 生产等非任务弹层不带展区专用返回图，但会显示同一类红色箭头；仅在未知页且专用恢复入口均未命中时使用现场确认的通用模板。
        var genericBackPoint = imgs.genericBack && gh.findFirst(imgs.genericBack, 0.8, "全局恢复通用返回");
        if (genericBackPoint) {
            clickTemplateCenter(genericBackPoint, imgs.genericBack);
            logRecovery(logFn, "第 " + attempt + " 轮点击通用返回");
            sleep(900);
            continue;
        }

        // 未匹配任何恢复控件时仅等待页面动画，不用系统返回或坐标点击扩大异常。
        logRecovery(logFn, "第 " + attempt + " 轮未识别到可安全操作的恢复控件");
        if (attempt < MAIN_SCENE_RECOVERY_ATTEMPTS) sleep(MAIN_SCENE_RECOVERY_RETRY_DELAY_MS);
    }
    logRecovery(logFn, "连续 " + MAIN_SCENE_RECOVERY_ATTEMPTS + " 轮未确认主界面，停止恢复");
    return false;
};

/**
 * 检测当前游戏导航场景。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {"world"|"base"|"unknown"} 可确认的主界面类型；未识别时返回 unknown。
 */
navigate.detectScene = function(imgs) {
    var baseInWorld = gh.findFirst(imgs.baseIcon, 0.7, "基地图标");
    if (baseInWorld) return "world";
    var worldInBase = gh.findFirst(imgs.worldIcon, 0.7, "世界图标");
    if (worldInBase) return "base";
    return "unknown";
};

// 双指内缩（缩放地图到最小）
navigate.pinchZoomOut = function(_log) {
    gh.pinchZoomOut();
    _log("双指缩放：缩小地图");
    sleep(1000);
    gh.pinchZoomOut();
    _log("双指缩放：再次缩小");
    sleep(1000);
};

/**
 * 点击锻造屋并返回，以它作为种植区定位的稳定视觉锚点。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @param {string} [taskName] 发起定位的任务名；用于在必要位置缺失时给出准确提示。
 * @returns {boolean} 锚点来回均已确认时返回 true。
 */
navigate.goToForgeAndBack = function(imgs, _log, taskName) {
    var owner = taskName || "种植";
    var forgePos = gh.findFirst(imgs.forgeHouse, 0.7, "锻造屋");
    if (!forgePos) {
        return gh.notifyRequiredPositionMissing(owner, "锻造屋定位锚点", _log);
    }
    click(forgePos.x + imgs.forgeHouse.getWidth() / 2, forgePos.y + imgs.forgeHouse.getHeight() / 2);
    _log("点击锻造屋");
    sleep(2000);

    // 检测锻造完成弹窗，点击底部关闭（与 weapon.js 一致）
    var dm = context.getResources().getDisplayMetrics();
    if (imgs.duanzaoDone) {
        var forgeDonePos = gh.findFirst(imgs.duanzaoDone, 0.7, "锻造完成");
        if (forgeDonePos) {
            click(random(100, dm.widthPixels - 100), dm.heightPixels - random(80, 200));
            _log("锻造完成，点击底部关闭");
            sleep(2000);
        }
    }

    var backPos = gh.findFirst(imgs.forgeBack, 0.7, "锻造屋返回");
    if (!backPos) {
        _log("未找到锻造屋返回按钮，等待...");
        sleep(2000);
        backPos = gh.findFirst(imgs.forgeBack, 0.7, "锻造屋返回");
    }
    if (backPos) {
        click(backPos.x + imgs.forgeBack.getWidth() / 2, backPos.y + imgs.forgeBack.getHeight() / 2);
        _log("点击锻造屋返回");
        sleep(1500);
        return true;
    }
    return gh.notifyRequiredPositionMissing(owner, "锻造屋返回", _log);
};

// 从屏幕中间向左滑动，距离为锻造屋图片宽度
navigate.swipeLeft = function(imgs, _log) {
    var dm = context.getResources().getDisplayMetrics();
    var cx = Math.round(dm.widthPixels / 2);
    var cy = Math.round(dm.heightPixels / 2);
    var dist = imgs.forgeSize ? imgs.forgeSize.getWidth() + imgs.forgeSize.getWidth()/2 : Math.round(dm.widthPixels / 5);
    var rand = random(-20, 20);
    swipe(cx + rand, cy, cx + dist + rand, cy, 2000 + random(-100, 100));
    _log("向右滑动（距离: " + dist + "px）");
    sleep(2000);
};

/**
 * 将画面安全定位至种植区域。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @returns {boolean} 已完成种植区定位时返回 true。
 */
navigate.autoLocate = function(imgs, _log) {
    _log("开始自动定位...");

    // 1. 检测当前界面
    var scene = navigate.detectScene(imgs);
    _log("当前界面: " + (scene === "world" ? "世界" : scene === "base" ? "基地" : "未知"));

    if (scene === "unknown") {
        return gh.notifyRequiredPositionMissing("种植", "游戏主界面", _log);
    }

    // 2. 如果在世界，点击基地切换到基地
    if (scene === "world") {
        var basePos = gh.findFirst(imgs.baseIcon, 0.7, "基地图标");
        if (!basePos) return gh.notifyRequiredPositionMissing("种植", "基地入口", _log);
        click(basePos.x + imgs.baseIcon.getWidth() / 2, basePos.y + imgs.baseIcon.getHeight() / 2);
        _log("点击基地图标，切换到基地");
        sleep(3000);
    }

    // 3. 双指缩放至最小地图
    navigate.pinchZoomOut(_log);

    // 4. 点击锻造屋初始化位置
    if (!navigate.goToForgeAndBack(imgs, _log)) return false;
    sleep(1000);

    // 5. 向左滑动定位到种植区
    navigate.swipeLeft(imgs, _log);

    _log("自动定位完成");
    return true;
};

module.exports = navigate;
