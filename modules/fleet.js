// fleet.js — 舰队通用操作，供各任务模块复用

var fleet = {};

var gh = require("./gameHelper.js");

fleet.isIdle = function(imgs, threshold) {
    var pos = gh.findFirst(imgs.fleetIdle, threshold || 0.7, "空闲中");
    if (pos) console.log("检测到空闲舰队: (" + pos.x + ", " + pos.y + ")");
    return pos;
};

fleet.selectUnchecked = function(imgs, threshold) {
    var unchecked = gh.findAll(imgs.fleetUnchecked, threshold || 0.7, "未勾选");
    console.log("未勾选舰队: " + unchecked.length + " 个");
    for (var i = 0; i < unchecked.length; i++) {
        var p = unchecked[i];
        console.log("勾选第 " + (i+1) + " 个: (" + p.x + ", " + p.y + ")");
        click(p.x + imgs.fleetUnchecked.getWidth() / 2, p.y + imgs.fleetUnchecked.getHeight() / 2);
        sleep(500);
    }
    return unchecked.length;
};

/**
 * 点击已识别的出征按钮。
 * 只有调用方已确认需要出征时才可使用；按钮缺失会提示用户而不是猜测点击其他控件。
 * @param {Object} imgs 已加载的图片资源。
 * @param {number} [threshold] 模板相似度阈值。
 * @param {string} [taskName] 发起出征的任务名称。
 * @param {Function} [logFn] 调度器日志回调。
 * @returns {boolean} 已找到并点击出征按钮时返回 true。
 */
fleet.dispatch = function(imgs, threshold, taskName, logFn) {
    var pos = gh.findFirst(imgs.fleetDispatch, threshold || 0.7, "出征");
    if (pos) {
        console.log("出征按钮位置: (" + pos.x + ", " + pos.y + ")");
        click(pos.x + imgs.fleetDispatch.getWidth() / 2, pos.y + imgs.fleetDispatch.getHeight() / 2);
        return true;
    }
    return gh.notifyRequiredPositionMissing(taskName || "舰队", "出征按钮", logFn);
};

module.exports = fleet;
