// main-resident-demand-status.test.js — AutoJs JSX 主界面的居民需求状态静态契约

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var mainPath = path.resolve(__dirname, "../../main.js");
var mainSource = fs.readFileSync(mainPath, "utf8");

/**
 * 验证主页、跨日按日期重算和调度安全回调均连接到同一居民需求状态展示方法。
 * @param {string} source 主脚本源码。
 */
function assertResidentDemandHomeStatusContract(source) {
    assert.ok(source.indexOf('id="home_resident_demand_status"') >= 0, "主页必须提供居民需求状态标记");
    assert.ok(source.indexOf("function refreshResidentDemandHomeStatus()") >= 0, "主页必须有居民需求状态刷新方法");
    assert.ok(source.indexOf("floatingPanel.getResidentDemandStatusText()") >= 0, "主页状态必须读取面板持久化状态");
    assert.ok(source.indexOf("floatingPanel.refreshResidentDemandStatus()") >= 0, "主页刷新时必须同步当前悬浮面板");
    assert.ok(source.indexOf("function refreshResidentDemandDateStatus()") >= 0, "主页必须在跨日时按完成日期重算状态");
    assert.ok(source.indexOf("refreshResidentDemandDateStatus();") >= 0, "主界面初始化和启动调度前必须刷新跨日状态");
    assert.ok(source.indexOf("setInterval(function() { refreshResidentDemandDateStatus(); }, 60000);") >= 0, "主页必须在运行期间定时刷新跨日状态");
    var statusRefreshStart = source.indexOf("function refreshResidentDemandDateStatus()");
    var statusRefreshEnd = source.indexOf("// ── Init stats", statusRefreshStart);
    var statusRefreshBody = source.slice(statusRefreshStart, statusRefreshEnd);
    assert.strictEqual(statusRefreshBody.indexOf("floatingPanel._saveConfig()"), -1, "跨日展示刷新不能因清除旧状态而改写完成日期");
    assert.ok(source.indexOf("onResidentDemandStateChange: function() { refreshResidentDemandHomeStatus(); }") >= 0, "安全回调落库后必须刷新主页状态");
}

assertResidentDemandHomeStatusContract(mainSource);
console.log("main resident demand status contract test passed");
