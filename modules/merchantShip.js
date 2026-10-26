// merchantShip.js — 搁浅商船任务

var merchantShip = {};

var gh = require("./gameHelper.js");
var fleet = require("./fleet.js");

/**
 * 从已打开的货轮列表内完成一次货轮筛选、前往、选舰队和出征。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {"dispatched"|"empty"|"noIdleFleet"|"failed"} 当前商船处理结果。
 */
function dispatchFromCargoList(imgs, _log, shouldStop) {
    if (shouldStop()) return "failed";

    // 货轮列表只有在活动刷新后才有目标；先确认列表状态，避免点击到准备页背后的其他控件。
    var inList = gh.findFirst(imgs.shipInList, 0.8, "货轮在列表");
    if (!inList) {
        _log("货轮不在列表，本轮已打完，关闭页面");
        // 关闭货轮列表
        var closeListPos = gh.findFirst(imgs.shipCloseList, 0.7, "关闭货轮列表");
        if (closeListPos) {
            click(closeListPos.x + imgs.shipCloseList.getWidth() / 2, closeListPos.y + imgs.shipCloseList.getHeight() / 2);
            _log("点击关闭货轮列表");
            sleep(1500);
        } else gh.notifyRequiredPositionMissing("商船", "货轮列表关闭按钮", _log);
        // 关闭搁浅商船页面
        var closePagePos = gh.findFirst(imgs.shipClosePage, 0.7, "关闭搁浅商船页面");
        if (closePagePos) {
            click(closePagePos.x + imgs.shipClosePage.getWidth() / 2, closePagePos.y + imgs.shipClosePage.getHeight() / 2);
            _log("点击关闭搁浅商船页面");
            sleep(1500);
        } else gh.notifyRequiredPositionMissing("商船", "搁浅商船页面关闭按钮", _log);
        return "empty";
    }
    _log("货轮在列表中，准备前往");
    sleep(1000);
    if (shouldStop()) return "failed";

    // 点击前往按钮（点击最上面的）
    var goBtns = gh.findAll(imgs.shipGoBtn, 0.7, "前往按钮");
    if (goBtns.length === 0) { gh.notifyRequiredPositionMissing("商船", "前往按钮", _log); return "failed"; }
    var topGoBtn = gh.getMaxYPoint(goBtns);
    click(topGoBtn.x + imgs.shipGoBtn.getWidth() / 2, topGoBtn.y + imgs.shipGoBtn.getHeight() / 2);
    _log("点击前往按钮: (" + topGoBtn.x + ", " + topGoBtn.y + ")");
    sleep(2000);

    if (shouldStop()) return "failed";

    // 点击舰队前往
    var fleetGo = gh.findFirst(imgs.fleetGo, 0.7, "舰队前往");
    if (!fleetGo) { gh.notifyRequiredPositionMissing("商船", "舰队前往按钮", _log); return "failed"; }
    click(fleetGo.x + imgs.fleetGo.getWidth() / 2, fleetGo.y + imgs.fleetGo.getHeight() / 2);
    _log("点击舰队前往");
    sleep(2000);

    if (shouldStop()) return "failed";

    // 驻守或行军中的舰队不会显示空闲标记；此时保留下一次夺回机会，绝不能误点出征。
    if (!fleet.isIdle(imgs)) {
        _log("无空闲舰队，本轮商船跳过，等待下次夺回重试");
        return "noIdleFleet";
    }

    // 勾选并出征
    var count = fleet.selectUnchecked(imgs);
    _log("已勾选 " + count + " 个舰队");
    if (count === 0) {
        // 空闲标签和可勾选控件必须同时存在，避免页面动画或模板误命中时点击出征。
        _log("未找到可勾选的空闲舰队，本轮商船跳过，等待下次夺回重试");
        return "noIdleFleet";
    }
    sleep(500);
    if (fleet.dispatch(imgs, null, "商船", _log)) {
        _log("出征成功");
        return "dispatched";
    }
    return "failed";
}

/**
 * 提前进入搁浅货轮活动弹窗，并确认整点可点击的货轮列表入口。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {{needBackToBase: boolean}|null} 已打开活动弹窗时返回回程上下文；失败时返回 null。
 */
merchantShip.prepare = function(imgs, _log, shouldStop) {
    var navigate = require("./navigate.js");

    if (!imgs.shipIcon || !imgs.shipLarge || !imgs.shipCargoList) return null;

    _log("[商船] 提前进入活动弹窗");
    if (shouldStop()) return null;

    // 准备阶段只允许从已确认的基地或世界主界面进入，避免把活动图标点击到普通任务残留的页面。
    var scene = navigate.detectScene(imgs);
    _log("[商船] 当前界面: " + (scene === "world" ? "世界" : scene === "base" ? "基地" : "未知"));
    if (scene === "unknown") {
        gh.notifyRequiredPositionMissing("商船", "游戏主界面", _log);
        return null;
    }

    var needBackToBase = (scene === "base");
    if (needBackToBase) {
        var worldPos = gh.findFirst(imgs.worldIcon, 0.7, "世界图标");
        if (!worldPos) {
            gh.notifyRequiredPositionMissing("商船", "世界入口", _log);
            return null;
        }
        click(worldPos.x + imgs.worldIcon.getWidth() / 2, worldPos.y + imgs.worldIcon.getHeight() / 2);
        _log("[商船] 切换到世界");
        sleep(3000);
        if (shouldStop()) return null;
    }

    var iconPos = gh.findFirst(imgs.shipIcon, 0.7, "商船图标");
    if (!iconPos) {
        gh.notifyRequiredPositionMissing("商船", "搁浅商船入口", _log);
        if (needBackToBase) merchantShip._goBackToBase(imgs, _log);
        return null;
    }
    click(iconPos.x + imgs.shipIcon.getWidth() / 2, iconPos.y + imgs.shipIcon.getHeight() / 2);
    _log("[商船] 点击商船图标");
    sleep(2000);
    if (shouldStop()) return null;

    // 万吨商轮仅用于确认已进入截图所示的活动弹窗，准备期不得点击它以免提前进入货轮列表。
    var popupPos = gh.findFirst(imgs.shipLarge, 0.7, "万吨商轮");
    if (!popupPos) {
        gh.notifyRequiredPositionMissing("商船", "搁浅商船活动弹窗", _log);
        if (needBackToBase) merchantShip._goBackToBase(imgs, _log);
        return null;
    }
    return { needBackToBase: needBackToBase };
};

/**
 * 在整点消费已打开的活动弹窗：先点击货轮列表，再执行已有的选货轮、选舰队和出征流程。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{needBackToBase: boolean}} prepared 准备阶段返回的回程上下文。
 * @param {Function} _log 调度器日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {"dispatched"|"empty"|"noIdleFleet"|"failed"} 当前商船处理结果。
 */
merchantShip.startPrepared = function(imgs, prepared, _log, shouldStop) {
    if (!prepared || shouldStop()) return "failed";
    if (!imgs.shipCargoList || !imgs.shipInList || !imgs.shipGoBtn) return "failed";
    if (!imgs.fleetGo || !imgs.fleetIdle || !imgs.fleetUnchecked || !imgs.fleetDispatch) return "failed";

    var cargoListPos = gh.findFirst(imgs.shipCargoList, 0.7, "货轮列表");
    if (!cargoListPos) {
        gh.notifyRequiredPositionMissing("商船", "货轮列表按钮", _log);
        return "failed";
    }
    click(cargoListPos.x + imgs.shipCargoList.getWidth() / 2, cargoListPos.y + imgs.shipCargoList.getHeight() / 2);
    _log("[商船] 点击货轮列表");
    sleep(1200);
    if (shouldStop()) return "failed";

    // 舰队空闲状态可能在最后一分钟变化，因此只在整点打开的实际列表中选择舰队，不能提前据此取消准备。
    var result = dispatchFromCargoList(imgs, _log, shouldStop);
    _log("[商船] 结果: " + result);

    if (prepared.needBackToBase) {
        sleep(1000);
        merchantShip._goBackToBase(imgs, _log);
    }
    return result;
};

/**
 * 在同一商船时段重新走一轮完整的进入活动、查货轮和派舰队流程。
 * 重试不能复用上一轮残留页面，避免在他人已抢占、舰队状态变化后点击旧控件。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {"dispatched"|"empty"|"noIdleFleet"|"failed"} 当前商船处理结果。
 */
merchantShip.retryOnce = function(imgs, _log, shouldStop) {
    var prepared = merchantShip.prepare(imgs, _log, shouldStop);
    if (!prepared) return "failed";
    return merchantShip.startPrepared(imgs, prepared, _log, shouldStop);
};

/**
 * 如果商船从基地界面发起，则结束后返回基地供普通任务继续执行。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @returns {boolean} 已识别并点击基地入口时返回 true。
 */
merchantShip._goBackToBase = function(imgs, _log) {
    var basePos = gh.findFirst(imgs.baseIcon, 0.7, "基地图标");
    if (basePos) {
        click(basePos.x + imgs.baseIcon.getWidth() / 2, basePos.y + imgs.baseIcon.getHeight() / 2);
        _log("[商船] 切换回基地");
        sleep(3000);
    } else {
        return gh.notifyRequiredPositionMissing("商船", "基地入口", _log);
    }
    return true;
};

module.exports = merchantShip;
