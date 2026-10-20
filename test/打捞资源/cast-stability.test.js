// cast-stability.test.js — 验证“甩杆”短暂闪现不会被误判为不限时钓鱼已满

var assert = require("assert");
var fs = require("fs");
var Module = require("module");
var path = require("path");

var sourcePath = path.join(__dirname, "..", "..", "modules", "resourceGather.js");
var moduleSource = fs.readFileSync(sourcePath, "utf8") + "\nmodule.exports._waitForStableCast = waitForStableCast;";
var testModule = new Module(sourcePath, module);
testModule.filename = sourcePath;
testModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
testModule._compile(moduleSource, sourcePath);

var originalDateNow = Date.now;
var fakeNow = 0;
var matchSequence = [];
var matchCount = 0;

global.captureScreen = function() {
    return { recycle: function() {} };
};
global.images = {
    findImage: function() {
        matchCount++;
        return matchSequence.shift() ? { x: 0, y: 0 } : null;
    }
};
global.sleep = function(milliseconds) {
    fakeNow += milliseconds;
};
Date.now = function() { return fakeNow; };

/**
 * 用给定的连续识图结果运行不限时钓鱼结束判断。
 * @param {boolean[]} sequence “甩杆”每次查找时是否存在。
 * @param {number} stopAtMs 到达该虚拟时间后请求停止。
 * @returns {boolean} 是否确认持续存在并通过二次复核。
 */
function runCastCheck(sequence, stopAtMs) {
    fakeNow = 0;
    matchCount = 0;
    matchSequence = sequence.slice();
    return testModule.exports._waitForStableCast({}, function() { return fakeNow >= stopAtMs; });
}

// 瞬间出现一次后消失，必须继续钓鱼而不是退出。
assert.strictEqual(runCastCheck([true, false], 2000), false);
assert.strictEqual(matchCount, 2);

// 连续 3 秒可见还不足以结束；第 4 秒的独立复核仍可见才确认满仓。
assert.strictEqual(runCastCheck([true, true, true, true, true], 5000), true);
assert.strictEqual(matchCount, 5);

Date.now = originalDateNow;
console.log("cast stability test passed");
