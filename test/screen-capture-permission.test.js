// screen-capture-permission.test.js — 验证启动前的录屏会话复用和首次授权分支。

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

/**
 * 从含 AutoJs XML 布局的入口文件中提取可在 Node 中执行的录屏权限辅助方法。
 *
 * @param {Object} overrides AutoJs 运行时依赖的测试替身。
 * @returns {Function} 待测的录屏权限判断函数。
 */
function loadEnsureScreenCapturePermission(overrides) {
    var mainPath = path.resolve(__dirname, "../main.js");
    var source = fs.readFileSync(mainPath, "utf8");
    var start = source.indexOf("function ensureScreenCapturePermission() {");
    var end = source.indexOf("// ── Launch ──", start);
    if (start < 0 || end < 0) throw new Error("未找到录屏权限判断方法");

    var sandbox = {
        images: overrides.images,
        requestScreenCapture: overrides.requestScreenCapture,
        uiHelpers: overrides.uiHelpers
    };
    vm.runInNewContext(source.slice(start, end) + "\nthis.ensure = ensureScreenCapturePermission;", sandbox, { filename: mainPath });
    return sandbox.ensure;
}

/**
 * 构造记录日志与授权调用的最小 AutoJs 运行时替身。
 *
 * @param {Object|null} screenCaptureOptions 当前录屏会话选项；null 表示尚未授权。
 * @param {boolean|Error} requestResult 首次申请录屏权限的返回值或异常。
 * @returns {{ensure: Function, logs: string[], warnings: Object[], requestCalls: boolean[]}} 用于断言的场景结果。
 */
function createScenario(screenCaptureOptions, requestResult) {
    var logs = [];
    var warnings = [];
    var requestCalls = [];
    var ensure = loadEnsureScreenCapturePermission({
        images: {
            getScreenCaptureOptions: function() { return screenCaptureOptions; }
        },
        requestScreenCapture: function(landscape) {
            requestCalls.push(landscape);
            if (requestResult instanceof Error) throw requestResult;
            return requestResult;
        },
        uiHelpers: {
            appendLog: function(message) { logs.push(message); },
            appendWarning: function(message, captureEvidence) {
                warnings.push({ message: message, captureEvidence: captureEvidence });
            }
        }
    });
    return { ensure: ensure, logs: logs, warnings: warnings, requestCalls: requestCalls };
}

var reused = createScenario({ orientation: "portrait" }, false);
assert.strictEqual(reused.ensure(), true);
assert.deepStrictEqual(reused.requestCalls, [], "已有录屏会话时不应重新申请权限");
assert.deepStrictEqual(reused.logs, ["已检测到可用录屏权限，跳过申请"]);

var granted = createScenario(null, true);
assert.strictEqual(granted.ensure(), true);
assert.deepStrictEqual(granted.requestCalls, [false], "首次申请应使用竖屏参数");
assert.deepStrictEqual(granted.logs, ["未检测到录屏权限，正在申请...", "录屏权限已授予"]);
assert.deepStrictEqual(granted.warnings, []);

var denied = createScenario(null, false);
assert.strictEqual(denied.ensure(), false);
assert.deepStrictEqual(denied.requestCalls, [false]);
assert.deepStrictEqual(denied.warnings, [{
    message: "未授予录屏权限，已取消启动",
    captureEvidence: false
}], "拒绝后只写 warn 文本，不能由日志截图引发第二次授权申请");

var failed = createScenario(null, new Error("系统授权页不可用"));
assert.strictEqual(failed.ensure(), false);
assert.deepStrictEqual(failed.requestCalls, [false]);
assert.deepStrictEqual(failed.warnings, [{
    message: "录屏权限申请失败: 系统授权页不可用",
    captureEvidence: false
}], "申请异常同样不能进入会尝试截图的顶层异常路径");

console.log("screen capture permission test passed");
