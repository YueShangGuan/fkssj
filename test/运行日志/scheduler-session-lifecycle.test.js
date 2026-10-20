// scheduler-session-lifecycle.test.js — 验证停止后立即重新运行不会让旧调度线程继续操作或关闭新会话

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var mainSource = fs.readFileSync(path.join(__dirname, "..", "..", "main.js"), "utf8");

// main.js 含 AutoJs JSX，不能由 Node 直接加载；先锁定会话号实际传入启动、停止和线程 finally 的三个边界。
assert.match(mainSource, /var schedulerSessionId = 0;/);
assert.match(mainSource, /var sessionId = \+\+schedulerSessionId;/);
assert.match(mainSource, /return !schedulerRunning \|\| sessionId !== schedulerSessionId;/);
assert.match(mainSource, /if \(schedulerRunning && sessionId === schedulerSessionId\) stopScheduler\(\);/);
assert.match(mainSource, /schedulerRunning = false;\s*\/\/ 使正在 sleep 或等待页面状态的旧线程永久失效，即使随后立即创建了新会话。\s*schedulerSessionId\+\+;/);

/**
 * 建模 main.js 的会话代号语义，验证旧会话在停止后立即重启时不能再通过停止判断。
 * @returns {{first: number, second: number, firstShouldStop: boolean, secondShouldStop: boolean, oldFinallyMayStop: boolean}} 两次会话及其停止判定。
 */
function simulateImmediateRestart() {
    var schedulerRunning = false;
    var schedulerSessionId = 0;

    function start() {
        var sessionId = ++schedulerSessionId;
        schedulerRunning = true;
        return sessionId;
    }

    function stop() {
        schedulerRunning = false;
        schedulerSessionId++;
    }

    var first = start();
    stop();
    var second = start();
    return {
        first: first,
        second: second,
        firstShouldStop: !schedulerRunning || first !== schedulerSessionId,
        secondShouldStop: !schedulerRunning || second !== schedulerSessionId,
        oldFinallyMayStop: schedulerRunning && first === schedulerSessionId
    };
}

var restart = simulateImmediateRestart();
assert.ok(restart.second > restart.first);
assert.strictEqual(restart.firstShouldStop, true, "旧线程必须在下一次安全检查退出");
assert.strictEqual(restart.secondShouldStop, false, "新线程应保持可运行");
assert.strictEqual(restart.oldFinallyMayStop, false, "旧线程 finally 不得关闭新会话");

console.log("scheduler session lifecycle test passed");
