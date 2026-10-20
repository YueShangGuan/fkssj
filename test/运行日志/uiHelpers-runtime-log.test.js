// 验证持久化运行日志在不依赖 AutoJs6 设备运行时的文件格式、异常截图和滚动策略。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const helperPath = path.resolve(__dirname, "../../modules/uiHelpers.js");

/**
 * 加载 uiHelpers，并用内存版 AutoJs API 验证日志行为，不触及真实设备或工作区文件。
 *
 * @param {Object} initialFiles 初始虚拟文件，用于覆盖会话清理等场景。
 * @param {boolean} [hasScreenCapture=true] 是否模拟当前脚本持有录屏会话。
 * @returns {Object} 测试所需的 helpers、内存文件和 UI 状态。
 */
function createHarness(initialFiles, hasScreenCapture) {
    const files = Object.assign({}, initialFiles);
    const panelState = { text: "", scrolls: 0 };
    const fileApi = {
        append(filePath, text) {
            files[filePath] = (files[filePath] || "") + text;
        },
        ensureDir() {},
        join: path.posix.join,
        listDir(directory, filter) {
            const prefix = directory.endsWith("/") ? directory : directory + "/";
            return Object.keys(files)
                .filter((filePath) => filePath.startsWith(prefix))
                .map((filePath) => filePath.slice(prefix.length))
                .filter((name) => !name.includes("/"))
                .filter((name) => !filter || filter(name));
        },
        remove(filePath) {
            delete files[filePath];
        }
    };
    const sandbox = {
        module: { exports: {} },
        exports: {},
        files: fileApi,
        threads: {
            lock() {
                return { lock() {}, unlock() {} };
            }
        },
        java: {
            io: {
                File: function(filePath) {
                    this.length = () => Buffer.byteLength(files[filePath] || "", "utf8");
                }
            },
            lang: {
                String: function(value) {
                    this.getBytes = () => Buffer.from(String(value), "utf8");
                }
            }
        },
        captureScreen(filePath) {
            files[filePath] = "mock screenshot";
        },
        images: {
            getScreenCaptureOptions() {
                return hasScreenCapture === false ? null : { orientation: "portrait" };
            }
        },
        log() {},
        $ui: {
            run(callback) { callback(); },
            post(callback) { callback(); },
            txt_log: { setText(text) { panelState.text = text; } },
            log_scroll: { fullScroll() { panelState.scrolls += 1; } }
        },
        android: { view: { View: { FOCUS_DOWN: 1 } } }
    };
    vm.runInNewContext(fs.readFileSync(helperPath, "utf8"), sandbox, { filename: helperPath });
    return { helpers: sandbox.module.exports, files, panelState };
}

/**
 * Finds all JSONL files written by the runtime logger.
 *
 * @param {Object} files In-memory files maintained by the harness.
 * @returns {string[]} JSONL runtime-log paths.
 */
function runtimeLogPaths(files) {
    return Object.keys(files).filter((filePath) => filePath.endsWith(".jsonl"));
}

{
    const harness = createHarness();
    harness.helpers.appendLog("资源加载完成");
    harness.helpers.appendError("调度器异常", new Error("mock failure"));

    const logPaths = runtimeLogPaths(harness.files);
    assert.strictEqual(logPaths.length, 1, "同一会话应追加到同一个 JSONL 分段");
    const records = harness.files[logPaths[0]].trim().split("\n").map(JSON.parse);

    assert.strictEqual(records[0].level, "info");
    assert.strictEqual(records[0].message, "资源加载完成");
    assert.strictEqual(records[1].level, "error");
    assert.match(records[1].message, /调度器异常: mock failure/);
    assert.match(records[1].stack, /mock failure/);
    assert.ok(records[1].screenshotPath, "异常记录应关联现场截图");
    assert.strictEqual(harness.files[records[1].screenshotPath], "mock screenshot");
    assert.match(harness.panelState.text, /调度器异常: mock failure/);
}

{
    const harness = createHarness();
    const message = "[打捞资源] 未识别到必要位置“钓鱼入口”，本轮已停止操作";
    harness.helpers.appendWarning(message);
    harness.helpers.appendWarning(message);

    const logPath = runtimeLogPaths(harness.files)[0];
    const records = harness.files[logPath].trim().split("\n").map(JSON.parse);
    assert.strictEqual(records.length, 2, "重复告警应保留完整事件时间线");
    assert.strictEqual(records[0].level, "warn");
    assert.strictEqual(records[0].message, message);
    assert.ok(records[0].screenshotPath, "首次必要位置缺失应关联现场截图");
    assert.strictEqual(harness.files[records[0].screenshotPath], "mock screenshot");
    assert.strictEqual(records[1].level, "warn");
    assert.strictEqual(records[1].screenshotPath, undefined, "同类重复告警不应重复保存相同画面");
}

{
    const harness = createHarness();
    const message = "未授予录屏权限，已取消启动";
    harness.helpers.appendWarning(message, false);

    const logPath = runtimeLogPaths(harness.files)[0];
    const record = JSON.parse(harness.files[logPath].trim());
    assert.strictEqual(record.level, "warn");
    assert.strictEqual(record.message, message);
    assert.strictEqual(record.screenshotPath, undefined, "无录屏会话的告警不能尝试保存截图");
    assert.strictEqual(Object.keys(harness.files).filter((filePath) => filePath.endsWith(".png")).length, 0);
}

{
    const harness = createHarness({}, false);
    harness.helpers.appendWarning("录屏会话不存在");
    harness.helpers.appendError("启动失败", new Error("录屏会话不存在"));

    const logPath = runtimeLogPaths(harness.files)[0];
    const records = harness.files[logPath].trim().split("\n").map(JSON.parse);
    assert.strictEqual(records[0].level, "warn");
    assert.strictEqual(records[0].screenshotPath, undefined, "未持有会话时告警不应隐式申请截图权限");
    assert.strictEqual(records[1].level, "error");
    assert.strictEqual(records[1].screenshotPath, undefined, "未持有会话时异常日志不应隐式申请截图权限");
    assert.strictEqual(Object.keys(harness.files).filter((filePath) => filePath.endsWith(".png")).length, 0);
}

{
    const harness = createHarness();
    harness.helpers.appendLog("x".repeat(2 * 1024 * 1024));
    harness.helpers.appendLog("分段后的下一条记录");

    assert.strictEqual(runtimeLogPaths(harness.files).length, 2, "超过 2 MiB 后应切换到新日志分段");
}

{
    const oldSessions = {};
    for (let day = 1; day <= 9; day += 1) {
        const token = "202601" + String(day).padStart(2, "0") + "-000000-000";
        oldSessions["/sdcard/水世界运行日志/fkssj-run-" + token + "-001.jsonl"] = "{}\n";
    }
    const harness = createHarness(oldSessions);
    harness.helpers.appendLog("触发会话保留清理");

    const retainedSessions = new Set(runtimeLogPaths(harness.files).map((filePath) => {
        return filePath.replace(/-\d{3}\.jsonl$/, "");
    }));
    assert.ok(retainedSessions.size <= 8, "日志目录最多保留 8 个最近会话");
}

console.log("uiHelpers runtime log tests passed");
