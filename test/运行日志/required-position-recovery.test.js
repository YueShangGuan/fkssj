// required-position-recovery.test.js — 验证必要位置缺失先记录证据，再触发且仅触发一次全局恢复。

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var events = [];
var recoveryCalls = 0;

/**
 * 读取 gameHelper 中不包含 AutoJs JSX 浮窗的公共工具段，避免 Node 解析器误把界面 XML 当 JavaScript。
 * @returns {Object} 可供 Node 回归测试调用的公共识图工具。
 */
function loadGameHelper() {
    var sourcePath = path.join(__dirname, "..", "..", "modules", "gameHelper.js");
    var source = fs.readFileSync(sourcePath, "utf8");
    var jsxStart = source.indexOf("gameHelper.showOverlay = function");
    if (jsxStart < 0) throw new Error("未找到 AutoJs 浮窗方法，无法隔离公共工具段");
    var context = {
        module: { exports: {} },
        exports: {},
        console: console
    };
    vm.runInNewContext(source.slice(0, jsxStart) + "module.exports = gameHelper;", context, { filename: sourcePath });
    return context.module.exports;
}

var gameHelper = loadGameHelper();

/**
 * 记录普通日志，便于验证恢复异常不会替换缺位告警。
 * @param {string} message 日志文本。
 */
function logFn(message) {
    events.push("info:" + message);
}

/**
 * 模拟运行时告警通道；生产环境会在该通道中保留首次截图。
 * @param {string} message 告警文本。
 */
logFn.appendWarning = function(message) {
    events.push("warning:" + message);
};

gameHelper.setMainSceneRecovery(function(taskName, positionName, callback) {
    recoveryCalls += 1;
    events.push("recovery:" + taskName + ":" + positionName);
    // 模拟恢复期间出现第二处缺位，重入保护不能再次调用处理器。
    assert.strictEqual(gameHelper.reportRequiredPositionMissing("恢复", "嵌套缺位", callback), false);
    return true;
});

try {
    assert.strictEqual(gameHelper.notifyRequiredPositionMissing("展区", "领取奖励", logFn), false);
    assert.strictEqual(recoveryCalls, 1);
    assert.strictEqual(events[0].indexOf("warning:[展区] 未识别到必要位置") === 0, true);
    assert.strictEqual(events[1], "recovery:展区:领取奖励");
    assert.ok(events.some(function(event) { return event.indexOf("全局恢复正在执行") >= 0; }));
} finally {
    gameHelper.setMainSceneRecovery(null);
}

console.log("required-position recovery test passed");
