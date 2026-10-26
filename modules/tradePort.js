// tradePort.js — 贸易港口：领取到货、提交全部交货并关闭弹窗

var tradePort = {};

// 收货后的结算动画会晚于按钮点击显示标题；与底部关闭提示使用同样的有限等待，避免把动画帧误判为“无奖励”。
var RECEIVE_REWARD_TITLE_ATTEMPTS = 10;
var RECEIVE_REWARD_TITLE_RETRY_DELAY_MS = 400;
// 目标 MuMu 1080×2400 奖励页中，该空白点位于奖励物品和底部提示之间；已确认提示后点击不会触及物品或购买入口。
var RECEIVE_REWARD_EMPTY_CLOSE_POINT = [540, 1800];
// 绿色勾会覆盖入口图标的角标区域；上半部是 2026-10-19 现场截图中未受状态变化影响的稳定主体。
var TRADE_PORT_ENTRY_STABLE_HEIGHT_RATIO = 0.48;

/**
 * 使用不含状态角标的入口主体定位贸易港口。
 * 绿色勾只表示可能有船返航，不能作为是否进入港口的判断，也不能参与模板匹配。
 * @param {Object} imgs 已加载的识图资源。
 * @param {Object} gh 游戏识图工具。
 * @returns {Object|null} 入口稳定主体的左上角坐标；未识别时返回 null。
 */
function findTradePortEntry(imgs, gh) {
    var entryImage = imgs.tradePortEntry;
    var stableEntryImage = null;
    var stableHeight = Math.max(1, Math.floor(entryImage.getHeight() * TRADE_PORT_ENTRY_STABLE_HEIGHT_RATIO));
    try {
        // 仅裁取未被绿色勾覆盖的图标主体；识别成功后仍以完整图标中心点击，保持原有点击位置。
        stableEntryImage = images.clip(entryImage, 0, 0, entryImage.getWidth(), stableHeight);
        return gh.findFirst(stableEntryImage, 0.78, "贸易港口入口（忽略绿色勾）");
    } finally {
        // 裁出的 Bitmap 只服务于本次识图，必须释放，避免每轮港口检查累计图像资源。
        try { if (stableEntryImage && stableEntryImage.recycle) stableEntryImage.recycle(); } catch (e) {}
    }
}

/**
 * 在贸易港口内点击模板中心，保留少量随机偏移以避免始终落在同一像素。
 * @param {Object} point 模板左上角坐标。
 * @param {Object} image 已加载的目标模板。
 */
function clickTemplateCenter(point, image) {
    click(
        point.x + Math.round(image.getWidth() / 2) + random(-4, 4),
        point.y + Math.round(image.getHeight() / 2) + random(-4, 4)
    );
}

/**
 * 将同一类操作按钮固定为从上到下的执行顺序，避免模板匹配返回顺序变化导致订单处理顺序不稳定。
 * @param {Array<Object>} points 模板左上角坐标集合。
 * @returns {Array<Object>} 不修改原数组的纵向排序结果。
 */
function sortTopToBottom(points) {
    return points.slice().sort(function(a, b) {
        return a.y - b.y;
    });
}

/**
 * 确保操作从基地开始；贸易港口入口只出现在基地侧栏，不能在未知页面盲点。
 * @param {Object} imgs 已加载的识图资源。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已位于或成功回到基地时返回 true。
 */
function ensureBaseScene(imgs, logFn) {
    var navigate = require("./navigate.js");
    var gh = require("./gameHelper.js");
    var scene = navigate.detectScene(imgs);
    if (scene === "base") return true;
    if (scene === "unknown") {
        return gh.notifyRequiredPositionMissing("贸易港口", "游戏主界面", logFn);
    }

    var basePos = gh.findFirst(imgs.baseIcon, 0.7, "基地图标");
    if (!basePos) {
        return gh.notifyRequiredPositionMissing("贸易港口", "基地入口", logFn);
    }
    clickTemplateCenter(basePos, imgs.baseIcon);
    logFn("[贸易港口] 切换到基地");
    sleep(3000);
    return true;
}

/**
 * 等待收货后的“恭喜获得”标题出现。
 * 收货按钮已点击时，奖励层必然会遮挡港口列表；标题未出现前不能继续识别交货或关闭按钮，避免误把动画过程当作无奖励。
 * @param {Object} imgs 已加载的识图资源。
 * @param {Object} gh 游戏识图工具。
 * @param {Function} shouldStop 停止标记。
 * @returns {Object|null} 奖励标题的模板坐标；超时或停止时返回 null。
 */
function waitForReceiveRewardTitle(imgs, gh, shouldStop) {
    for (var attempt = 0; attempt < RECEIVE_REWARD_TITLE_ATTEMPTS; attempt++) {
        if (shouldStop()) return null;
        var rewardTitlePos = gh.findFirst(imgs.tradePortRewardTitle, 0.8, "贸易港口恭喜获得");
        if (rewardTitlePos) return rewardTitlePos;
        if (attempt < RECEIVE_REWARD_TITLE_ATTEMPTS - 1) sleep(RECEIVE_REWARD_TITLE_RETRY_DELAY_MS);
    }
    return null;
}

/**
 * 关闭“收货”后覆盖全屏的奖励提示。只有底部关闭提示出现时才点击已确认的空白区，避免长奖励列表仍在入场时点击无效。
 * @param {Object} imgs 已加载的识图资源。
 * @param {Object} gh 游戏识图工具。
 * @param {Function} logFn 日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {"closed"|"notReady"|"interrupted"} 奖励层状态；未就绪时不会点击任何关闭区域或港口订单。
 */
function dismissReceiveReward(imgs, gh, logFn, shouldStop) {
    if (shouldStop()) return "interrupted";
    var rewardTitlePos = waitForReceiveRewardTitle(imgs, gh, shouldStop);
    if (!rewardTitlePos) {
        if (!shouldStop()) logFn("[贸易港口] 收货后未确认奖励结算页面，本轮不继续操作遮挡层后的港口订单");
        return shouldStop() ? "interrupted" : "notReady";
    }

    // 奖励物品位于标题下方；底部提示是列表完成入场的唯一关闭前置条件。
    if (!gh.waitForRewardDismissHint(imgs.rewardDismissHint, shouldStop, "贸易港口奖励关闭提示")) {
        if (!shouldStop()) gh.notifyRequiredPositionMissing("贸易港口", "奖励关闭提示", logFn);
        return "notReady";
    }
    // 游戏明确要求点击空白区域关闭；标题和底部提示均已识别后才使用现场验证过的空白坐标。
    click(RECEIVE_REWARD_EMPTY_CLOSE_POINT[0], RECEIVE_REWARD_EMPTY_CLOSE_POINT[1]);
    logFn("[贸易港口] 关闭收货奖励提示");
    sleep(700);
    return "closed";
}

/**
 * 关闭“全部交货”触发的材料不足提示。该提示说明交货未成功，必须先关闭才可安全关闭港口窗口。
 * @param {Object} imgs 已加载的识图资源。
 * @param {Object} gh 游戏识图工具。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 检测到材料不足提示时返回 true。
 */
function dismissInsufficientDelivery(imgs, gh, logFn) {
    var insufficientPos = gh.findFirst(imgs.tradePortInsufficient, 0.8, "贸易港口所需产品不足");
    if (!insufficientPos) return false;

    var closePos = gh.findFirst(imgs.tradePortInsufficientClose, 0.8, "贸易港口材料不足关闭");
    if (closePos) {
        clickTemplateCenter(closePos, imgs.tradePortInsufficientClose);
        sleep(700);
    }
    logFn("[贸易港口] 全部交货失败：所需产品不足");
    return true;
}

/**
 * 领取当前弹窗内的全部到货。识别当前全部按钮后逐项点击，收货奖励层关闭后才继续下一项。
 * @param {Object} imgs 已加载的识图资源。
 * @param {Function} logFn 日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {number} 实际点击的收货按钮数量；-1 表示奖励弹层未准备好而安全中止。
 */
function receiveAll(imgs, logFn, shouldStop) {
    var gh = require("./gameHelper.js");
    var count = 0;
    var receivePositions = sortTopToBottom(gh.findAll(imgs.tradePortReceive, 0.8, "贸易港口收货"));

    // 同屏可能有多条可收货订单。先固定本屏坐标，收货后只关闭对应奖励层，不让模板匹配顺序影响后续订单。
    for (var i = 0; i < receivePositions.length && !shouldStop(); i++) {
        var receivePos = receivePositions[i];
        clickTemplateCenter(receivePos, imgs.tradePortReceive);
        count++;
        logFn("[贸易港口] 点击收货（" + count + "）");
        sleep(1200);
        // 奖励提示会遮住港口列表；若提示未就绪则不能继续点击被遮挡的下一条订单。
        if (dismissReceiveReward(imgs, gh, logFn, shouldStop) === "notReady") return -1;
    }
    return count;
}

/**
 * 逐个尝试当前屏幕全部“全部交货”按钮。材料不足只代表当前订单失败，不能阻止其他订单继续提交。
 * @param {Object} imgs 已加载的识图资源。
 * @param {Object} gh 游戏识图工具。
 * @param {Function} logFn 日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {number} 实际点击的全部交货按钮数量。
 */
function deliverAllVisible(imgs, gh, logFn, shouldStop) {
    var deliveryPositions = sortTopToBottom(gh.findAll(imgs.tradePortAllDeliver, 0.8, "贸易港口全部交货"));
    if (deliveryPositions.length === 0) {
        logFn("[贸易港口] 未出现全部交货，本次仅完成收货检查");
        return 0;
    }

    // 订单完成后卡片状态会变化，但当前港口列表不会重排；使用打开弹窗时的坐标可避免不足订单反复被识别并重复点击。
    for (var i = 0; i < deliveryPositions.length && !shouldStop(); i++) {
        clickTemplateCenter(deliveryPositions[i], imgs.tradePortAllDeliver);
        logFn("[贸易港口] 点击全部交货（" + (i + 1) + "/" + deliveryPositions.length + "），等待游戏结果");
        sleep(1000);

        // “所需产品不足”只针对本条订单。关闭提示后继续后续订单，且不触碰“获取”或钻石购买入口。
        if (!dismissInsufficientDelivery(imgs, gh, logFn)) {
            logFn("[贸易港口] 已提交全部交货，未见已知失败提示");
        }
    }
    return deliveryPositions.length;
}

/**
 * 执行一次贸易港口检查。只有确认关闭已知港口弹窗后才写入完成时间，避免失败时误进入冷却。
 * @param {Object} imgs 已加载的识图资源。
 * @param {number} intervalMinutes 上次完成后的最小间隔，单位分钟。
 * @param {number} lastCompletedAt 上一次完整关闭港口弹窗的毫秒时间戳。
 * @param {Function} uiLog 日志回调。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} onCompleted 完成并关闭弹窗后的持久化回调。
 * @returns {{completed: boolean, waitSeconds: number}} 本次完成状态及该任务自身的剩余冷却秒数；总调度不会据此长时间休眠。
 */
tradePort.runOnce = function(imgs, intervalMinutes, lastCompletedAt, uiLog, shouldStop, onCompleted) {
    var _log = uiLog || function(msg) { log(msg); };
    var intervalMs = Math.max(1, intervalMinutes || 10) * 60 * 1000;
    var now = Date.now();

    // 冷却期内直接返回，不截图也不触屏，避免每轮总调度重复打开港口。
    if (lastCompletedAt && now - lastCompletedAt < intervalMs) {
        var remainingSeconds = Math.ceil((intervalMs - (now - lastCompletedAt)) / 1000);
        return { completed: false, waitSeconds: remainingSeconds };
    }
    // 只有真正执行时才加载识图库，冷却分支不产生任何图像读取或触屏相关依赖。
    var gh = require("./gameHelper.js");
    if (!imgs.tradePortEntry || !imgs.tradePortReceive || !imgs.tradePortRewardTitle || !imgs.rewardDismissHint || !imgs.tradePortAllDeliver || !imgs.tradePortInsufficient || !imgs.tradePortInsufficientClose || !imgs.tradePortClose) {
        _log("[贸易港口] 图片资源未加载，本次跳过");
        return { completed: false, waitSeconds: 60 };
    }
    if (shouldStop() || !ensureBaseScene(imgs, _log)) return { completed: false, waitSeconds: 60 };

    var entryPos = findTradePortEntry(imgs, gh);
    if (!entryPos) {
        gh.notifyRequiredPositionMissing("贸易港口", "贸易港口入口", _log);
        return { completed: false, waitSeconds: 60 };
    }
    clickTemplateCenter(entryPos, imgs.tradePortEntry);
    _log("[贸易港口] 进入贸易港口");
    sleep(1800);
    if (shouldStop()) return { completed: false, waitSeconds: 60 };

    // 先确认港口自身的关闭按钮存在，再执行会消耗货物的“全部交货”。
    var closePos = gh.findFirst(imgs.tradePortClose, 0.8, "贸易港口关闭");
    if (!closePos) {
        gh.notifyRequiredPositionMissing("贸易港口", "港口弹窗关闭按钮", _log);
        return { completed: false, waitSeconds: 60 };
    }

    if (receiveAll(imgs, _log, shouldStop) < 0) {
        _log("[贸易港口] 收货奖励尚未可关闭，本轮不继续操作港口订单");
        return { completed: false, waitSeconds: 60 };
    }
    if (shouldStop()) return { completed: false, waitSeconds: 60 };

    deliverAllVisible(imgs, gh, _log, shouldStop);
    if (shouldStop()) return { completed: false, waitSeconds: 60 };

    // 提交交货后重新识别 X，避免动画或提示层造成旧坐标误点。
    closePos = gh.findFirst(imgs.tradePortClose, 0.8, "贸易港口关闭");
    if (!closePos) {
        gh.notifyRequiredPositionMissing("贸易港口", "港口关闭按钮", _log);
        return { completed: false, waitSeconds: 60 };
    }
    clickTemplateCenter(closePos, imgs.tradePortClose);
    var completedAt = Date.now();
    if (onCompleted) onCompleted(completedAt);
    _log("[贸易港口] 本次任务结束");
    return { completed: true, waitSeconds: Math.ceil(intervalMs / 1000) };
};

module.exports = tradePort;
