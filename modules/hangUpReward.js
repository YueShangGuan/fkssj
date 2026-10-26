// hangUpReward.js — 闯关挂机奖励领取与安全返回主界面

var hangUpReward = {};

var BASE_WIDTH = 1080;
var BASE_HEIGHT = 2400;
// “恭喜获得”层要求点击空白区域关闭；该点位位于奖励列表下方，避开物品、标题和底部提示文字。
var EMPTY_REWARD_CLOSE_POINT = [540, 1800];
// 游戏弹窗有入场动画；有限轮询只等待已知模板出现，超时后仍安全停止且绝不补点坐标。
var STATE_CONFIRM_ATTEMPTS = 5;
var STATE_CONFIRM_RETRY_DELAY_MS = 400;

/**
 * 点击已识别模板的中心，避免模板左上角坐标随裁图尺寸变化而落在控件边缘。
 * @param {{x: number, y: number}} point 模板左上角坐标。
 * @param {Object} image 已加载的模板图片。
 */
function clickTemplateCenter(point, image) {
    click(
        Math.round(point.x + image.getWidth() / 2),
        Math.round(point.y + image.getHeight() / 2)
    );
}

/**
 * 读取实际屏幕相对 MuMu 原始 1080×2400 截图的缩放比例。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {{x: number, y: number}|null} 可用的横纵缩放比例；无法读取时返回 null。
 */
function getScreenScale(gameHelper) {
    var resolution = gameHelper.getRealResolution();
    if (!resolution || resolution.length < 2 || resolution[0] <= 0 || resolution[1] <= 0) return null;
    return { x: resolution[0] / BASE_WIDTH, y: resolution[1] / BASE_HEIGHT };
}

/**
 * 按原始 MuMu 截图坐标点击固定安全区域。
 * @param {number[]} point 原始 1080×2400 截图坐标。
 * @param {{x: number, y: number}} scale 当前屏幕缩放比例。
 */
function clickFixedPoint(point, scale) {
    click(Math.round(point[0] * scale.x), Math.round(point[1] * scale.y));
}

/**
 * 检查本任务进入、领取和安全返回所需的全部模板是否已加载。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {boolean} 所有必需模板均可用时返回 true。
 */
function hasRequiredImages(imgs) {
    var required = [
        "hangUpRewardEntry",
        "hangUpRewardTv",
        "hangUpRewardTitle",
        "hangUpRewardClaim",
        "hangUpRewardCongrats",
        "rewardDismissHint",
        "hangUpRewardBack"
    ];
    for (var i = 0; i < required.length; i++) {
        if (!imgs || !imgs[required[i]]) return false;
    }
    return true;
}

/**
 * 在闯关页同时确认电视入口和红色返回按钮，避免将其他页面的相似图标当作领奖入口。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {{tv: Object, back: Object}|null} 两个控件均存在时返回坐标；否则返回 null。
 */
function findStageControls(imgs, gameHelper) {
    var tvPoint = gameHelper.findFirst(imgs.hangUpRewardTv, 0.8, "挂机奖励电视入口");
    if (!tvPoint) return null;
    var backPoint = gameHelper.findFirst(imgs.hangUpRewardBack, 0.8, "挂机奖励闯关返回");
    if (!backPoint) return null;
    return { tv: tvPoint, back: backPoint };
}

/**
 * 在领取后确认仍处于闯关页并取得返回按钮。
 * 领取会把电视入口切换为倒计时样式，不能继续把领取前的电视模板当作返回前置条件。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {Object|null} 闯关返回按钮坐标；未确认时返回 null。
 */
function findStageBack(imgs, gameHelper) {
    return gameHelper.findFirst(imgs.hangUpRewardBack, 0.8, "挂机奖励闯关返回");
}

/**
 * 在有限时间内等待可识别的目标状态，处理游戏动画完成时间的轻微波动。
 * 本辅助方法只重复识图，不会在状态未确认时触发任何触屏动作。
 * @param {Function} findState 返回当前已确认状态的函数。
 * @param {Function} shouldStop 停止标记。
 * @returns {Object|null} 已确认的状态结果；超时或停止时返回 null。
 */
function waitForConfirmedState(findState, shouldStop) {
    for (var attempt = 0; attempt < STATE_CONFIRM_ATTEMPTS; attempt++) {
        if (shouldStop()) return null;
        var state = findState();
        if (state) return state;
        if (attempt < STATE_CONFIRM_ATTEMPTS - 1) sleep(STATE_CONFIRM_RETRY_DELAY_MS);
    }
    return null;
}

/**
 * 执行一次挂机奖励领取。完成时间由调用方保留在本次总调度会话中，不持久化到本地配置。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{intervalHours: number, lastCompletedAt: number}} config 小时级间隔与本会话上次完成时间。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} uiLog 调度器日志回调。
 * @returns {{status: "cooldown"|"completed"|"interrupted"|"failed", waitSeconds: number}} 本轮状态及该任务自身的冷却或失败退避秒数；总调度继续短轮转。
 */
hangUpReward.runOnce = function(imgs, config, shouldStop, uiLog) {
    var _log = uiLog || function(message) { log(message); };
    var stopRequested = shouldStop || function() { return false; };
    var intervalHours = Number(config && config.intervalHours);
    var lastCompletedAt = Number(config && config.lastCompletedAt) || 0;
    if (!isFinite(intervalHours) || intervalHours <= 0) {
        _log("[挂机奖励] 配置无效，本轮跳过");
        return { status: "failed", waitSeconds: 30 };
    }
    if (stopRequested()) {
        _log("[挂机奖励] 收到停止请求，未进入本轮操作");
        return { status: "interrupted", waitSeconds: 0 };
    }

    var intervalMs = intervalHours * 60 * 60 * 1000;
    var now = Date.now();
    // 冷却判断必须先于模板校验、识图和触屏，保证总调度重复调用时完全跳过本任务。
    if (lastCompletedAt && now - lastCompletedAt < intervalMs) {
        var remainingSeconds = Math.max(1, Math.ceil((intervalMs - (now - lastCompletedAt)) / 1000));
        return { status: "cooldown", waitSeconds: remainingSeconds };
    }

    if (!hasRequiredImages(imgs)) {
        _log("[挂机奖励] 图片资源未加载，本轮跳过");
        return { status: "failed", waitSeconds: 30 };
    }

    var gameHelper = require("./gameHelper.js");
    var scale = getScreenScale(gameHelper);
    if (!scale) {
        _log("[挂机奖励] 无法读取屏幕分辨率，本轮跳过");
        return { status: "failed", waitSeconds: 30 };
    }

    try {
        var entryPoint = gameHelper.findFirst(imgs.hangUpRewardEntry, 0.8, "挂机奖励闯关入口");
        if (!entryPoint) {
            gameHelper.notifyRequiredPositionMissing("挂机奖励", "主界面闯关入口", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        clickTemplateCenter(entryPoint, imgs.hangUpRewardEntry);
        _log("[挂机奖励] 进入闯关界面");
        sleep(1800);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };

        var stageControls = waitForConfirmedState(function() {
            return findStageControls(imgs, gameHelper);
        }, stopRequested);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };
        if (!stageControls) {
            gameHelper.notifyRequiredPositionMissing("挂机奖励", "闯关界面入口和返回按钮", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        clickTemplateCenter(stageControls.tv, imgs.hangUpRewardTv);
        _log("[挂机奖励] 打开挂机奖励弹窗");
        sleep(1000);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };

        var rewardTitlePoint = waitForConfirmedState(function() {
            return gameHelper.findFirst(imgs.hangUpRewardTitle, 0.8, "挂机奖励标题");
        }, stopRequested);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };
        if (!rewardTitlePoint) {
            gameHelper.notifyRequiredPositionMissing("挂机奖励", "挂机奖励弹窗标题", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        var claimPoint = waitForConfirmedState(function() {
            return gameHelper.findFirst(imgs.hangUpRewardClaim, 0.8, "挂机奖励领取按钮");
        }, stopRequested);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };
        if (!claimPoint) {
            gameHelper.notifyRequiredPositionMissing("挂机奖励", "领取奖励按钮", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        clickTemplateCenter(claimPoint, imgs.hangUpRewardClaim);
        _log("[挂机奖励] 点击领取奖励");
        sleep(1000);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };

        var congratsPoint = waitForConfirmedState(function() {
            return gameHelper.findFirst(imgs.hangUpRewardCongrats, 0.8, "挂机奖励恭喜获得");
        }, stopRequested);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };
        if (!congratsPoint) {
            gameHelper.notifyRequiredPositionMissing("挂机奖励", "恭喜获得页面", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        // 奖励标题会先出现；必须等到底部关闭提示出现，才说明固定空白区已可生效。
        if (!gameHelper.waitForRewardDismissHint(imgs.rewardDismissHint, stopRequested, "挂机奖励关闭提示")) {
            if (!stopRequested()) gameHelper.notifyRequiredPositionMissing("挂机奖励", "奖励关闭提示", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        // 已确认奖励层与底部提示后才点固定空白区，避免在其他页面误触物品、加速或返回控件。
        clickFixedPoint(EMPTY_REWARD_CLOSE_POINT, scale);
        _log("[挂机奖励] 关闭恭喜获得页面");
        sleep(800);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };

        // 领奖后电视入口会变成倒计时样式；仅以稳定的红色返回按钮确认已回到闯关页。
        var backPoint = waitForConfirmedState(function() {
            return findStageBack(imgs, gameHelper);
        }, stopRequested);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };
        if (!backPoint) {
            gameHelper.notifyRequiredPositionMissing("挂机奖励", "闯关返回按钮", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        clickTemplateCenter(backPoint, imgs.hangUpRewardBack);
        _log("[挂机奖励] 返回主界面");
        sleep(1500);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };

        var finalEntryPoint = waitForConfirmedState(function() {
            return gameHelper.findFirst(imgs.hangUpRewardEntry, 0.8, "挂机奖励主界面确认");
        }, stopRequested);
        if (stopRequested()) return { status: "interrupted", waitSeconds: 0 };
        if (!finalEntryPoint) {
            gameHelper.notifyRequiredPositionMissing("挂机奖励", "主界面闯关入口确认", _log);
            return { status: "failed", waitSeconds: 30 };
        }
        _log("[挂机奖励] 本轮完成，已安全返回主界面");
        return { status: "completed", waitSeconds: Math.ceil(intervalMs / 1000) };
    } catch (e) {
        _log("[挂机奖励] 执行异常：" + e.message);
        return { status: "failed", waitSeconds: 30 };
    }
};

module.exports = hangUpReward;
