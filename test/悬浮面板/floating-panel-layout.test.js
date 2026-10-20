// floating-panel-layout.test.js — 验证总调度到任务详情的静态布局契约

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var panelPath = path.resolve(__dirname, "../../modules/floatingPanel.js");
var panelSource = fs.readFileSync(panelPath, "utf8");

/**
 * 读取任务详情登记表。AutoJs6 的 XML 内嵌语法不能由 Node 直接执行，
 * 因而只分析登记表区域，避免把其他配置数组误识别为详情页。
 * @param {string} source 浮窗模块源码。
 * @returns {Array<string>} 已登记的任务详情键。
 */
function getDetailPageKeys(source) {
    var registryMatch = source.match(/var TASK_DETAIL_PAGES = \[([\s\S]*?)\];/);
    assert.ok(registryMatch, "task detail registry must exist");
    var keys = [];
    var pagePattern = /\{\s*key:\s*"([^"]+)",\s*title:\s*"([^"]+)"\s*\}/g;
    var match;
    while ((match = pagePattern.exec(registryMatch[1]))) {
        keys.push(match[1]);
    }
    return keys;
}

/**
 * 校验每个详情任务都有设置容器和总调度箭头入口，防止新增任务只登记一半。
 * @param {string} source 浮窗模块源码。
 * @param {Array<string>} detailKeys 已登记的任务详情键。
 */
function assertDetailNavigationIsComplete(source, detailKeys) {
    assert.ok(detailKeys.length > 0, "task detail registry must contain at least one task");
    detailKeys.forEach(function(key) {
        assert.ok(source.indexOf('id="set_' + key + '"') >= 0, "detail task must provide set_" + key + " settings container");
        assert.ok(source.indexOf('id="scheduler_detail_' + key + '"') >= 0, "detail task must provide a scheduler arrow entry");
    });
}

/**
 * 校验挂机奖励的小时级配置、正整数校验及会话级完成时间边界，
 * 防止面板重构时把任务改成默认开启、接受小数，或意外持久化完成时间。
 * @param {string} source 浮窗模块源码。
 */
function assertHangUpRewardContract(source) {
    assert.ok(source.indexOf("hangUpReward: 1") >= 0, "挂机奖励间隔默认必须为 1 小时");
    assert.ok(source.indexOf("hangUpReward: false") >= 0, "挂机奖励默认必须关闭");
    assert.ok(
        source.indexOf('{ key: "hangUpReward", title: "挂机奖励" }') > source.indexOf('{ key: "exhibition", title: "展区" }'),
        "挂机奖励详情必须排在展区之后"
    );
    assert.ok(source.indexOf("完成后间隔（小时）") >= 0, "挂机奖励详情必须展示小时级间隔");
    assert.ok(source.indexOf("!/^[1-9][0-9]*$/.test(text)") >= 0, "挂机奖励频率必须拒绝非正整数");
    assert.ok(source.indexOf('toast("请输入正整数小时")') >= 0, "非法挂机奖励频率必须反馈给用户");
    assert.ok(source.indexOf('typeof cfg.freq.hangUpReward === "number" && isFinite(cfg.freq.hangUpReward)') >= 0, "恢复的挂机奖励频率必须经过有限数值校验");
    assert.strictEqual(source.indexOf("hangUpRewardLastCompletedAt"), -1, "浮窗配置不能持久化挂机奖励完成时间");
}

/**
 * 校验城战配置使用三支舰队独立计划；集结必须是舰队选项，不能重新引入全局模式。
 * @param {string} source 浮窗模块源码。
 */
function assertWarFleetPlanContract(source) {
    assert.ok(source.indexOf("createDefaultWarFleetPlans") >= 0, "城战必须创建三支舰队默认计划");
    assert.ok(source.indexOf("normalizeWarFleetPlans(cfg.warFleetPlans)") >= 0, "城战计划必须从本地配置恢复");
    assert.ok(source.indexOf("warFleetPlans: panel.warFleetPlans") >= 0, "城战计划必须持久化");
    assert.strictEqual(source.indexOf("selectedWarMode"), -1, "旧全局城战模式不得保留");
    assert.strictEqual(source.indexOf("war_rally"), -1, "旧集结控件不得保留");
    assert.ok(source.indexOf('["rally", "attack", "defend"]') >= 0, "集结必须作为舰队独立模式绑定");
    assert.ok(source.indexOf('item.mode !== "rally"') >= 0, "持久化计划必须接受集结模式");
    for (var index = 1; index <= 3; index++) {
        assert.ok(source.indexOf('id="war_fleet_' + index + '_rally"') >= 0, "舰队必须提供集结模式");
        assert.ok(source.indexOf('id="war_fleet_' + index + '_attack"') >= 0, "舰队必须提供进攻模式");
        assert.ok(source.indexOf('id="war_fleet_' + index + '_defend"') >= 0, "舰队必须提供防守模式");
        assert.ok(source.indexOf('id="war_fleet_' + index + '_target_btn"') >= 0, "舰队必须提供目标城镇输入");
        assert.ok(source.indexOf('id="war_fleet_' + index + '_repair"') >= 0, "舰队必须提供维修加速开关");
        assert.ok(source.indexOf('id="war_fleet_' + index + '_march"') >= 0, "舰队必须提供行军加速开关");
    }
    assert.ok(source.indexOf('if (panel.running || panel.warFleetPlans[index].mode === mode) return;') >= 0, "运行中不得修改舰队模式");
    assert.ok(source.indexOf('if (!panel.running) editWarFleetTarget(index);') >= 0, "运行中不得修改优先城镇");
    assert.ok(/war_fleet_" \+ number \+ "_repair"\]\.on\("click", function\(\) \{\s*if \(panel\.running\) return;\s*panel\.warFleetPlans\[index\]\.repairAccelerate/.test(source), "运行中不得修改维修加速");
    assert.ok(/war_fleet_" \+ number \+ "_march"\]\.on\("click", function\(\) \{\s*if \(panel\.running\) return;\s*panel\.warFleetPlans\[index\]\.marchAccelerate/.test(source), "运行中不得修改行军加速");
    assert.ok(source.indexOf('"war_fleet_1_target_btn", "war_fleet_1_repair", "war_fleet_1_march"') >= 0, "运行界面必须禁用舰队一配置控件");
}

var detailKeys = getDetailPageKeys(panelSource);

assert.ok(panelSource.indexOf('id="task_selector"') < 0, "task selector must be removed");
assert.ok(panelSource.indexOf("function showTaskPicker()") < 0, "task picker dialog must be removed");
assert.ok(panelSource.indexOf("panel.currentTask") < 0, "legacy selected-task state must be removed");
assert.ok(panelSource.indexOf('id="tab_bar"') < 0, "legacy horizontal tab bar must not return");
assert.ok(panelSource.indexOf('<ScrollView id="task_settings_scroll"') >= 0, "settings content must remain scrollable");
assert.ok(panelSource.indexOf('id="detail_page_header"') >= 0, "detail page must identify the active task");
assert.ok(detailKeys.indexOf("scheduler") < 0, "scheduler is the root page, not a task detail");
assert.ok(detailKeys.indexOf("intelligence") >= 0, "intelligence must register a task detail page");
assertDetailNavigationIsComplete(panelSource, detailKeys);

assert.ok(/panel\.freq\s*=\s*\{[^\n]*intelligence:\s*4/.test(panelSource), "intelligence default interval must be 4 hours");
assert.ok(panelSource.indexOf("panel.intelligenceLastCompletedAt = 0;") >= 0, "intelligence completion timestamp must initialize to zero");
assert.ok(panelSource.indexOf("cfg.intelligenceLastCompletedAt") >= 0, "intelligence completion timestamp must load from config");
assert.ok(panelSource.indexOf("intelligenceLastCompletedAt: panel.intelligenceLastCompletedAt") >= 0, "intelligence completion timestamp must persist to config");
assert.ok(panelSource.indexOf('id="freq_intelligence_btn"') >= 0, "intelligence detail must provide hour interval editor");

var borderedTaskRows = panelSource.match(/cardBackgroundColor="#D7DAE0"/g) || [];
assert.ok(borderedTaskRows.length >= detailKeys.length, "scheduler tasks must remain visually separated by borders");
assert.ok(
    panelSource.indexOf("</ScrollView>") < panelSource.indexOf('id="btn_run"'),
    "run and log actions must stay outside the scrollable settings area"
);

var runHandlerStart = panelSource.indexOf('floatWin.btn_run.on("click", function() {');
var runHandlerEnd = panelSource.indexOf('floatWin.btn_log.on("click"', runHandlerStart);
var runHandler = panelSource.slice(runHandlerStart, runHandlerEnd);
assert.ok(runHandlerStart >= 0 && runHandlerEnd > runHandlerStart, "primary action handler must exist");
assert.ok(runHandler.indexOf("if (panel.activeTaskDetail !== null)") >= 0, "detail page must intercept the primary action");
assert.ok(runHandler.indexOf("panel.showSchedulerSettings();") >= 0, "detail primary action must return to scheduler");
assert.ok(runHandler.indexOf("ctx.onRun();") > runHandler.indexOf("panel.showSchedulerSettings();"), "return branch must run before scheduler start logic");
assert.ok(runHandler.indexOf("var started = ctx.onRun();") > runHandler.indexOf("panel.showSchedulerSettings();"), "scheduler start must expose whether the request was accepted");
assert.ok(runHandler.indexOf("if (started)") > runHandler.indexOf("var started = ctx.onRun();"), "only an accepted start may collapse the panel");
assert.ok(runHandler.indexOf("panel.showBall(ctx);") > runHandler.indexOf("if (started)"), "accepted starts must collapse back to the floating ball");
assert.ok(panelSource.indexOf('isTaskDetail ? "‹ 返回"') >= 0, "detail page must render the primary action as return");
assertHangUpRewardContract(panelSource);
assertWarFleetPlanContract(panelSource);

console.log("floating panel layout contract test passed");
