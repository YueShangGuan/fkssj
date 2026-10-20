// hang-up-reward.test.js — 以 Node VM 覆盖挂机奖励的冷却、领取、异常与停止安全边界

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var sourcePath = path.join(__dirname, "..", "..", "modules", "hangUpReward.js");
var source = fs.readFileSync(sourcePath, "utf8");

/**
 * 构造只带固定尺寸的模板替身，使测试只关注状态机和点击顺序而不依赖真实图片。
 * @param {string} name 模板名称。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} AutoJs 图片替身。
 */
function makeImage(name) {
    return {
        name: name,
        getWidth: function() { return 100; },
        getHeight: function() { return 100; }
    };
}

/**
 * 构造挂机奖励模块所需的全部模板键。
 * @returns {Object} 模板键到图片替身的映射。
 */
function makeImages() {
    return {
        hangUpRewardEntry: makeImage("entry"),
        hangUpRewardTv: makeImage("tv"),
        hangUpRewardTitle: makeImage("title"),
        hangUpRewardClaim: makeImage("claim"),
        hangUpRewardCongrats: makeImage("congrats"),
        rewardDismissHint: makeImage("dismissHint"),
        hangUpRewardBack: makeImage("back")
    };
}

/**
 * 在隔离 VM 中加载模块，并可按场景替换 AutoJs 全局函数。
 * @param {Object} overrides 运行时依赖替身。
 * @returns {{api: Object, context: Object}} 被测模块与其 VM 上下文。
 */
function loadHangUpReward(overrides) {
    overrides = overrides || {};
    var context = {
        module: { exports: {} },
        exports: {},
        require: overrides.require || function() { throw new Error("Unexpected require"); },
        click: overrides.click || function() {},
        sleep: overrides.sleep || function() {},
        log: overrides.log || function() {},
        Date: overrides.Date || Date,
        console: console
    };
    vm.runInNewContext(source, context, { filename: sourcePath });
    return { api: context.module.exports, context: context };
}

/**
 * 构造能够完整推进主界面、闯关页、奖励弹窗与恭喜获得页的视觉状态机。
 * @param {Object} options 场景选项。
 * @returns {{loaded: Object, imgs: Object, state: Object, clicks: Array}} 可运行的领奖场景。
 */
function createFlowScenario(options) {
    options = options || {};
    var imgs = makeImages();
    var state = { page: "main" };
    var clicks = [];
    var notifications = [];
    var congratsLookupCount = 0;
    var dismissHintLookupCount = 0;

    /**
     * 判断当前场景是否故意隐藏指定视觉状态，用于覆盖状态机的每个安全中止边界。
     * @param {string} key 状态键。
     * @returns {boolean} 该状态应被隐藏时返回 true。
     */
    function isMissing(key) {
        return options.missing === key;
    }

    var gameHelper = {
        getRealResolution: function() { return [1080, 2400]; },
        /**
         * 记录任务因缺失必要位置而报告的提示，验证状态机不会仅依赖异常中断。
         * @param {string} taskName 任务名称。
         * @param {string} positionName 必要位置名称。
         * @returns {false} 与真实公共工具保持相同的安全失败返回值。
         */
        notifyRequiredPositionMissing: function(taskName, positionName) {
            notifications.push([taskName, positionName]);
            return false;
        },
        findFirst: function(image) {
            if (image === imgs.hangUpRewardEntry) {
                return state.page === "main" && !isMissing(state.returnedToMain ? "finalMain" : "entry") ? { x: 10, y: 10 } : null;
            }
            if (image === imgs.hangUpRewardTv) {
                return state.page === "stage" && !isMissing("stageTv") && !(options.hideTvAfterClaim && state.rewardClaimed) ? { x: 100, y: 10 } : null;
            }
            if (image === imgs.hangUpRewardBack) {
                return state.page === "stage" && !isMissing(state.rewardClaimed ? "postClaimBack" : "stageBack") ? { x: 200, y: 10 } : null;
            }
            if (image === imgs.hangUpRewardTitle) return state.page === "reward" && !isMissing("title") ? { x: 300, y: 10 } : null;
            if (image === imgs.hangUpRewardClaim) return state.page === "reward" && !isMissing("claim") ? { x: 400, y: 10 } : null;
            if (image === imgs.hangUpRewardCongrats) {
                congratsLookupCount++;
                return state.page === "congrats" && !isMissing("congrats") && congratsLookupCount > (options.delayedCongratsLookups || 0) ? { x: 500, y: 10 } : null;
            }
            return null;
        },
        /**
         * 模拟奖励物品完成入场后才出现的底部关闭提示，确保空白区域不会在提示前被点击。
         * @param {Object} image 待确认的模板。
         * @returns {boolean} 当前奖励弹层已可关闭时返回 true。
         */
        waitForRewardDismissHint: function(image) {
            if (image !== imgs.rewardDismissHint || state.page !== "congrats" || isMissing("dismissHint")) return false;
            // 与真实识图工具一致，单次调用会在有限轮询中等待提示完成入场。
            for (var attempt = 0; attempt < 10; attempt++) {
                dismissHintLookupCount++;
                if (dismissHintLookupCount > (options.delayedDismissHintLookups || 0)) return true;
            }
            return false;
        }
    };
    var loaded = loadHangUpReward({
        require: function(request) {
            if (request === "./gameHelper.js") return gameHelper;
            throw new Error("Unexpected require: " + request);
        },
        click: function(x, y) {
            clicks.push([x, y]);
            if (x === 60 && y === 60 && state.page === "main") state.page = "stage";
            else if (x === 150 && y === 60 && state.page === "stage") state.page = "reward";
            else if (x === 450 && y === 60 && state.page === "reward") {
                state.page = "congrats";
                state.rewardClaimed = true;
            }
            else if (x === 540 && y === 1800 && state.page === "congrats") state.page = "stage";
            else if (x === 250 && y === 60 && state.page === "stage") {
                state.page = "main";
                state.returnedToMain = true;
            }
        },
        sleep: options.sleep || function() {}
    });
    return { loaded: loaded, imgs: imgs, state: state, clicks: clicks, notifications: notifications };
}

/**
 * 验证冷却分支在加载游戏工具和产生点击之前直接返回。
 */
function testCooldownSkipsAllIo() {
    var requireCalls = 0;
    var clickCalls = 0;
    var loaded = loadHangUpReward({
        Date: { now: function() { return 10000; } },
        require: function() { requireCalls++; throw new Error("冷却期不应加载依赖"); },
        click: function() { clickCalls++; }
    });
    var result = loaded.api.runOnce(makeImages(), { intervalHours: 1, lastCompletedAt: 9500 }, function() { return false; }, function() {});
    assert.strictEqual(result.status, "cooldown");
    assert.strictEqual(requireCalls, 0);
    assert.strictEqual(clickCalls, 0);
}

/**
 * 验证完整流程按用户截图顺序领取、关闭奖励、回到闯关页并最终确认主界面。
 */
function testCompleteFlowReturnsToMainScene() {
    var scenario = createFlowScenario();
    var result = scenario.loaded.api.runOnce(scenario.imgs, { intervalHours: 1, lastCompletedAt: 0 }, function() { return false; }, function() {});
    assert.strictEqual(result.status, "completed");
    assert.strictEqual(scenario.state.page, "main");
    assert.deepStrictEqual(scenario.clicks, [[60, 60], [150, 60], [450, 60], [540, 1800], [250, 60]]);
}

/**
 * 验证领奖后电视入口改成倒计时样式时，仍以闯关返回按钮确认页面并安全回到主界面。
 */
function testClaimedStageCanReturnWhenTvChanges() {
    var scenario = createFlowScenario({ hideTvAfterClaim: true });
    var result = scenario.loaded.api.runOnce(scenario.imgs, { intervalHours: 1, lastCompletedAt: 0 }, function() { return false; }, function() {});
    assert.strictEqual(result.status, "completed");
    assert.strictEqual(scenario.state.page, "main");
    assert.deepStrictEqual(scenario.clicks, [[60, 60], [150, 60], [450, 60], [540, 1800], [250, 60]]);
}

/**
 * 验证“恭喜获得”弹层仍在入场动画时会有限等待模板，而不是误判失败或在未确认时点空白区。
 */
function testDelayedCongratsStillCompletesSafely() {
    var scenario = createFlowScenario({ delayedCongratsLookups: 2 });
    var result = scenario.loaded.api.runOnce(scenario.imgs, { intervalHours: 1, lastCompletedAt: 0 }, function() { return false; }, function() {});
    assert.strictEqual(result.status, "completed");
    assert.strictEqual(scenario.state.page, "main");
    assert.deepStrictEqual(scenario.clicks, [[60, 60], [150, 60], [450, 60], [540, 1800], [250, 60]]);
}

/**
 * 验证长奖励列表的底部关闭提示延迟出现时，脚本仍会等待提示而不会提前点击空白区。
 */
function testDelayedDismissHintStillCompletesSafely() {
    var scenario = createFlowScenario({ delayedDismissHintLookups: 2 });
    var result = scenario.loaded.api.runOnce(scenario.imgs, { intervalHours: 1, lastCompletedAt: 0 }, function() { return false; }, function() {});
    assert.strictEqual(result.status, "completed");
    assert.strictEqual(scenario.state.page, "main");
    assert.deepStrictEqual(scenario.clicks, [[60, 60], [150, 60], [450, 60], [540, 1800], [250, 60]]);
}

/**
 * 验证领取前无法确认奖励弹窗标题时不会猜测性点击领取按钮或返回按钮。
 */
function testMissingRewardTitleStopsWithoutClaim() {
    var scenario = createFlowScenario({ missing: "title" });
    var result = scenario.loaded.api.runOnce(scenario.imgs, { intervalHours: 1, lastCompletedAt: 0 }, function() { return false; }, function() {});
    assert.strictEqual(result.status, "failed");
    assert.strictEqual(scenario.state.page, "reward");
    assert.deepStrictEqual(scenario.clicks, [[60, 60], [150, 60]]);
    assert.deepStrictEqual(scenario.notifications, [["挂机奖励", "挂机奖励弹窗标题"]]);
}

/**
 * 验证任何关键中间状态缺失时都不会继续猜测点击，也不会报告领取完成。
 */
function testEveryMissingStateStopsSafely() {
    var cases = [
        { missing: "entry", page: "main", clicks: [] },
        { missing: "stageTv", page: "stage", clicks: [[60, 60]] },
        { missing: "stageBack", page: "stage", clicks: [[60, 60]] },
        { missing: "claim", page: "reward", clicks: [[60, 60], [150, 60]] },
        { missing: "congrats", page: "congrats", clicks: [[60, 60], [150, 60], [450, 60]] },
        { missing: "dismissHint", page: "congrats", clicks: [[60, 60], [150, 60], [450, 60]] },
        { missing: "postClaimBack", page: "stage", clicks: [[60, 60], [150, 60], [450, 60], [540, 1800]] },
        { missing: "finalMain", page: "main", clicks: [[60, 60], [150, 60], [450, 60], [540, 1800], [250, 60]] }
    ];
    cases.forEach(function(testCase) {
        var scenario = createFlowScenario({ missing: testCase.missing });
        var result = scenario.loaded.api.runOnce(scenario.imgs, { intervalHours: 1, lastCompletedAt: 0 }, function() { return false; }, function() {});
        assert.strictEqual(result.status, "failed", testCase.missing + " must fail safely");
        assert.strictEqual(scenario.state.page, testCase.page, testCase.missing + " must stop at its current page");
        assert.deepStrictEqual(scenario.clicks, testCase.clicks, testCase.missing + " must not add a speculative click");
        assert.strictEqual(scenario.notifications.length, 1, testCase.missing + " must report its missing required position");
    });
}

/**
 * 验证进入闯关页后收到停止请求时立即中止，不会继续打开奖励或回写完成状态。
 */
function testStopDuringFlowDoesNotComplete() {
    var stopped = false;
    var scenario = createFlowScenario({ sleep: function() { stopped = true; } });
    var result = scenario.loaded.api.runOnce(scenario.imgs, { intervalHours: 1, lastCompletedAt: 0 }, function() { return stopped; }, function() {});
    assert.strictEqual(result.status, "interrupted");
    assert.strictEqual(scenario.state.page, "stage");
    assert.deepStrictEqual(scenario.clicks, [[60, 60]]);
}

testCooldownSkipsAllIo();
testCompleteFlowReturnsToMainScene();
testClaimedStageCanReturnWhenTvChanges();
testDelayedCongratsStillCompletesSafely();
testDelayedDismissHintStillCompletesSafely();
testMissingRewardTitleStopsWithoutClaim();
testEveryMissingStateStopsSafely();
testStopDuringFlowDoesNotComplete();
console.log("hang-up reward tests passed");
