// required-position-warning.test.js — 验证必要位置缺失会优先走可截图的 warn 日志通道。

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

/**
 * 仅加载 gameHelper 中位于 AutoJs XML UI 之前的公共识图逻辑。
 * Node 无法解析 AutoJs 的 XML 布局语法；本用例只验证必要位置告警路由，因此不需要加载叠加层实现。
 *
 * @returns {Object} 可供断言的 gameHelper 导出对象。
 */
function loadTestableGameHelper() {
    var helperPath = path.resolve(__dirname, "../../modules/gameHelper.js");
    var source = fs.readFileSync(helperPath, "utf8");
    var uiMethodStart = source.indexOf("gameHelper.waitForRewardDismissHint");
    var uiCommentStart = source.lastIndexOf("/**", uiMethodStart);
    if (uiMethodStart < 0 || uiCommentStart < 0) throw new Error("未找到可截取的 AutoJs UI 边界");

    var sandbox = { module: { exports: {} }, exports: {} };
    vm.runInNewContext(source.slice(0, uiCommentStart) + "\nmodule.exports = gameHelper;", sandbox, { filename: helperPath });
    return sandbox.module.exports;
}

var gameHelper = loadTestableGameHelper();

var warnings = [];
var infos = [];

/**
 * 模拟总调度提供的日志回调：普通消息走 info，必要位置缺失走附加 warn 通道。
 *
 * @param {string} message 任务输出的用户可读日志。
 */
function schedulerLog(message) {
    infos.push(message);
}

/**
 * 收集缺位告警，替代真实运行时的截图和 JSONL 写入。
 *
 * @param {string} message 需要升级的必要位置缺失提示。
 */
function appendWarning(message) {
    warnings.push(message);
}

schedulerLog.appendWarning = appendWarning;

assert.strictEqual(gameHelper.notifyRequiredPositionMissing("打捞资源", "钓鱼入口", schedulerLog), false);
assert.deepStrictEqual(warnings, ["[打捞资源] 未识别到必要位置“钓鱼入口”，本轮已停止操作"]);
assert.deepStrictEqual(infos, [], "具备 warn 通道时不应再写重复 info 日志");

console.log("required position warning test passed");
