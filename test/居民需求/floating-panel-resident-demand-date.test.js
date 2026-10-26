// floating-panel-resident-demand-date.test.js — 不解析 AutoJs JSX，验证居民需求完成日期的本地持久化语义

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var panelPath = path.resolve(__dirname, "../../modules/floatingPanel.js");
var fullSource = fs.readFileSync(panelPath, "utf8");
var plainSourceEnd = fullSource.indexOf("panel.showBall = function(ctx)");

assert.ok(plainSourceEnd > 0, "floatingPanel 的 AutoJs JSX 前必须保留可独立验证的状态层");
var source = fullSource.slice(0, plainSourceEnd) + "\nmodule.exports = panel;";

/**
 * 构造受控设备本地时间，兼容模块对 Date 的单参数和多参数构造调用。
 * @param {number} now 固定毫秒时间戳。
 * @returns {Function} 可注入 VM 的 Date 构造函数。
 */
function makeDate(now) {
    function FakeDate(value) {
        if (arguments.length === 0) return new Date(now);
        if (arguments.length === 1) return new Date(value);
        if (arguments.length === 2) return new Date(arguments[0], arguments[1]);
        if (arguments.length === 3) return new Date(arguments[0], arguments[1], arguments[2]);
        if (arguments.length === 4) return new Date(arguments[0], arguments[1], arguments[2], arguments[3]);
        if (arguments.length === 5) return new Date(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4]);
        if (arguments.length === 6) return new Date(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]);
        return new Date(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6]);
    }
    FakeDate.now = function() { return now; };
    FakeDate.parse = Date.parse;
    FakeDate.UTC = Date.UTC;
    return FakeDate;
}

/**
 * 读取浮窗 JSX 前的状态层，并以内存存储替身观察配置恢复和写回。
 * @param {Object|null} config 模拟的 fkssj_config 内容。
 * @param {number} now 固定设备时间。
 * @returns {{panel:Object,writes:Array<Object>}} 面板对象和持久化快照。
 */
function loadPanel(config, now) {
    var writes = [];
    var context = {
        module: { exports: {} },
        exports: {},
        Date: makeDate(now),
        isFinite: isFinite,
        console: console,
        storages: {
            create: function() {
                return {
                    get: function(key) { return key === "config" ? config : null; },
                    put: function(key, value) {
                        if (key === "config") writes.push(value);
                    }
                };
            }
        }
    };
    vm.runInNewContext(source, context, { filename: panelPath });
    return { panel: context.module.exports, writes: writes };
}

/**
 * 返回与业务持久化格式一致的本地日期键。
 * @param {number} timestamp 毫秒时间戳。
 * @returns {string} `YYYY-MM-DD` 日期键。
 */
function dateKey(timestamp) {
    var date = new Date(timestamp);
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return date.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
}

var yesterday = new Date(2026, 9, 23, 23, 59, 59).getTime();
var today = new Date(2026, 9, 24, 0, 1, 0).getTime();
var tomorrow = new Date(2026, 9, 25, 0, 1, 0).getTime();

/**
 * 昨天的完成日期只用于审计，脚本跨零点继续运行时必须立即展示为今天未完成。
 */
function testYesterdayCompletedDateDoesNotBlockToday() {
    var loaded = loadPanel({
        residentDemandLastCheckedAt: yesterday,
        residentDemandCompletedDate: dateKey(yesterday)
    }, today);
    assert.strictEqual(loaded.panel.residentDemandCompletedDate, dateKey(yesterday));
    assert.strictEqual(loaded.panel.isResidentDemandCompletedToday(today), false);
    assert.strictEqual(loaded.panel.getResidentDemandStatusText(today), "今日未完成");
    assert.strictEqual(loaded.writes.length, 0, "跨日状态重算不应篡改昨天的审计日期");
}

/**
 * 同一天的完成日期才允许显示已完成；安全回调写入日期后，新一天无需清理字段即可恢复未完成。
 */
function testCompletionDateIsComparedOnEveryCurrentDayCheck() {
    var loaded = loadPanel({ residentDemandCompletedDate: dateKey(today) }, today);
    assert.strictEqual(loaded.panel.getResidentDemandStatusText(today), "今日已完成");

    assert.strictEqual(loaded.panel.applyResidentDemandSafeCheck({
        lastCheckedAt: today,
        completedDate: dateKey(today)
    }), true);
    assert.strictEqual(loaded.writes.length, 1, "安全返回基地后必须一次性保存巡检与完成日期");
    assert.strictEqual(loaded.writes[0].residentDemandCompletedDate, dateKey(today));
    assert.strictEqual(loaded.writes[0].residentDemandDailyCompletedAt, undefined, "不得继续持久化旧完成时间戳");
    assert.strictEqual(loaded.panel.getResidentDemandStatusText(tomorrow), "今日未完成");
}

/**
 * 损坏日期或旧时间戳字段均不是完成日期，升级后不能继续短路今日调度。
 */
function testInvalidAndLegacyCompletionValuesAreUnfinished() {
    var malformed = loadPanel({ residentDemandCompletedDate: "2026-02-30" }, today);
    assert.strictEqual(malformed.panel.getResidentDemandStatusText(today), "今日未完成");

    var legacy = loadPanel({ residentDemandDailyCompletedAt: today }, today);
    assert.strictEqual(legacy.panel.getResidentDemandStatusText(today), "今日未完成");
}

testYesterdayCompletedDateDoesNotBlockToday();
testCompletionDateIsComparedOnEveryCurrentDayCheck();
testInvalidAndLegacyCompletionValuesAreUnfinished();
console.log("floating panel resident demand date test passed");
