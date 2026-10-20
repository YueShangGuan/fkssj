// merchantShip.js — 搁浅商船任务

var merchantShip = {};

var gh = require("./gameHelper.js");
var fleet = require("./fleet.js");

/**
 * 在商船列表内完成一次货轮筛选、前往、选舰队和出征。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @returns {"ok"|"empty"|"fail"} 当前商船处理结果。
 */
function runOnce(imgs, _log) {
    // 1. 点击搁浅商船图标
    var iconPos = gh.findFirst(imgs.shipIcon, 0.7, "商船图标");
    if (!iconPos) { gh.notifyRequiredPositionMissing("商船", "搁浅商船入口", _log); return "fail"; }
    click(iconPos.x + imgs.shipIcon.getWidth() / 2, iconPos.y + imgs.shipIcon.getHeight() / 2);
    _log("点击商船图标");
    sleep(2000);

    // 2. 点击万吨商轮
    var largePos = gh.findFirst(imgs.shipLarge, 0.7, "万吨商轮");
    if (!largePos) { gh.notifyRequiredPositionMissing("商船", "万吨商轮", _log); return "fail"; }
    click(largePos.x + imgs.shipLarge.getWidth() / 2, largePos.y + imgs.shipLarge.getHeight() / 2);
    _log("点击万吨商轮");
    sleep(2000);

    // 3. 检测万吨货轮是否在列表
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

    // 4. 点击前往按钮（点击最上面的）
    var goBtns = gh.findAll(imgs.shipGoBtn, 0.7, "前往按钮");
    if (goBtns.length === 0) { gh.notifyRequiredPositionMissing("商船", "前往按钮", _log); return "fail"; }
    var topGoBtn = gh.getMaxYPoint(goBtns);
    click(topGoBtn.x + imgs.shipGoBtn.getWidth() / 2, topGoBtn.y + imgs.shipGoBtn.getHeight() / 2);
    _log("点击前往按钮: (" + topGoBtn.x + ", " + topGoBtn.y + ")");
    sleep(2000);

    // 5. 点击舰队前往
    var fleetGo = gh.findFirst(imgs.fleetGo, 0.7, "舰队前往");
    if (!fleetGo) { gh.notifyRequiredPositionMissing("商船", "舰队前往按钮", _log); return "fail"; }
    click(fleetGo.x + imgs.fleetGo.getWidth() / 2, fleetGo.y + imgs.fleetGo.getHeight() / 2);
    _log("点击舰队前往");
    sleep(2000);

    // 6. 勾选并出征
    var count = fleet.selectUnchecked(imgs);
    _log("已勾选 " + count + " 个舰队");
    sleep(500);
    if (fleet.dispatch(imgs, null, "商船", _log)) {
        _log("出征成功");
        return "ok";
    }
    return "fail";
}

/**
 * 执行一次商船检查与出征；触发时机由总调度器统一决定。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 调度器日志回调。
 * @param {Function} shouldStop 停止标记。
 * @returns {boolean} 已处理商船或确认本轮为空时返回 true。
 */
merchantShip.runOnce = function(imgs, _log, shouldStop) {
    var navigate = require("./navigate.js");

    if (!imgs.shipIcon || !imgs.shipLarge || !imgs.shipInList || !imgs.shipGoBtn) return false;
    if (!imgs.fleetGo || !imgs.fleetUnchecked || !imgs.fleetDispatch) return false;

    _log("[商船] 限时任务开始");
    if (shouldStop()) return false;

    // 检测当前界面
    var scene = navigate.detectScene(imgs);
    _log("[商船] 当前界面: " + (scene === "world" ? "世界" : scene === "base" ? "基地" : "未知"));
    if (scene === "unknown") return gh.notifyRequiredPositionMissing("商船", "游戏主界面", _log);

    // 如果在基地，切换到世界
    var needBackToBase = (scene === "base");
    if (needBackToBase) {
        var worldPos = gh.findFirst(imgs.worldIcon, 0.7, "世界图标");
        if (!worldPos) return gh.notifyRequiredPositionMissing("商船", "世界入口", _log);
        click(worldPos.x + imgs.worldIcon.getWidth() / 2, worldPos.y + imgs.worldIcon.getHeight() / 2);
        _log("[商船] 切换到世界");
        sleep(3000);
        if (shouldStop()) return false;
    }

    // 检测空闲舰队
    var idle = fleet.isIdle(imgs);
    if (!idle) {
        _log("[商船] 无空闲舰队，跳过");
        if (needBackToBase) merchantShip._goBackToBase(imgs, _log);
        return false;
    }

    sleep(1000);
    if (shouldStop()) { if (needBackToBase) merchantShip._goBackToBase(imgs, _log); return false; }

    var result = runOnce(imgs, _log);
    _log("[商船] 结果: " + result);

    // 切回基地
    if (needBackToBase) {
        sleep(1000);
        merchantShip._goBackToBase(imgs, _log);
    }

    return result === "ok" || result === "empty";
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
