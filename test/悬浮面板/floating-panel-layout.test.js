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
 * 校验资源收集任务组的默认开关、三项表单及各自单位，
 * 防止面板重构时恢复旧顶层挂机奖励任务或误把分钟参数按小时保存。
 * @param {string} source 浮窗模块源码。
 */
function assertResourceCollectionContract(source) {
    assert.ok(source.indexOf("hangUpReward: 1") >= 0, "挂机奖励间隔默认必须为 1 小时");
    assert.ok(source.indexOf("resourceExperience: 10") >= 0, "收集资源间隔默认必须为 10 分钟");
    assert.ok(source.indexOf("resourceFactory: 10") >= 0, "工厂生产收集间隔默认必须为 10 分钟");
    assert.ok(source.indexOf("resourceCollection: false") >= 0, "资源收集总开关默认必须关闭");
    assert.ok(source.indexOf("panel.resourceCollection = { hangUpReward: true, experience: true, factory: true }") >= 0, "三个资源收集子功能默认必须全部勾选");
    assert.ok(
        source.indexOf('{ key: "resourceCollection", title: "资源收集" }') > source.indexOf('{ key: "exhibition", title: "展区" }'),
        "资源收集详情必须排在展区之后"
    );
    assert.ok(source.indexOf('id="resource_collection_hang_up"') >= 0, "资源收集详情必须提供挂机奖励子开关");
    assert.ok(source.indexOf('id="resource_collection_experience"') >= 0, "资源收集详情必须提供收集资源子开关");
    assert.ok(source.indexOf('id="resource_collection_factory"') >= 0, "资源收集详情必须提供工厂生产收集子开关");
    assert.ok(source.indexOf('id="freq_resourceExperience_btn"') >= 0, "收集资源必须提供分钟间隔编辑器");
    assert.ok(source.indexOf('id="freq_resourceFactory_btn"') >= 0, "工厂生产收集必须提供分钟间隔编辑器");
    assert.ok(source.indexOf("!/^[1-9][0-9]*$/.test(text)") >= 0, "挂机奖励频率必须拒绝非正整数");
    assert.ok(source.indexOf('toast("请输入正整数小时")') >= 0, "非法挂机奖励频率必须反馈给用户");
    assert.ok(source.indexOf('typeof cfg.freq.hangUpReward === "number" && isFinite(cfg.freq.hangUpReward)') >= 0, "恢复的挂机奖励频率必须经过有限数值校验");
    assert.ok(source.indexOf('typeof cfg.freq.resourceExperience === "number" && isFinite(cfg.freq.resourceExperience)') >= 0, "恢复的收集资源频率必须经过有限数值校验");
    assert.ok(source.indexOf('typeof cfg.freq.resourceFactory === "number" && isFinite(cfg.freq.resourceFactory)') >= 0, "恢复的工厂生产频率必须经过有限数值校验");
    assert.ok(source.indexOf("resourceCollection: panel.resourceCollection") >= 0, "资源收集子开关必须持久化");
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

/**
 * 校验居民需求的默认关闭、分钟级巡检、每日状态展示和运行期冻结契约。
 * @param {string} source 浮窗模块源码。
 */
function assertResidentDemandContract(source) {
    assert.ok(/panel\.freq\s*=\s*\{[^\n]*residentDemand:\s*10/.test(source), "居民需求默认巡检间隔必须为 10 分钟");
    assert.ok(source.indexOf("residentDemand: false") >= 0, "居民需求默认必须关闭");
    assert.ok(source.indexOf("panel.residentDemandLastCheckedAt = 0;") >= 0, "居民需求巡检时间必须初始化");
    assert.ok(source.indexOf('panel.residentDemandCompletedDate = "";') >= 0, "居民需求完成日期必须初始化");
    assert.ok(source.indexOf("cfg.residentDemandLastCheckedAt") >= 0, "居民需求巡检时间必须从本地配置恢复");
    assert.ok(source.indexOf("cfg.residentDemandCompletedDate") >= 0, "居民需求完成日期必须从本地配置恢复");
    assert.ok(source.indexOf("residentDemandLastCheckedAt: panel.residentDemandLastCheckedAt") >= 0, "居民需求巡检时间必须持久化");
    assert.ok(source.indexOf("residentDemandCompletedDate: panel.residentDemandCompletedDate") >= 0, "居民需求完成日期必须持久化");
    assert.ok(source.indexOf('{ key: "residentDemand", title: "居民需求" }') > source.indexOf('{ key: "tradePort", title: "贸易港口" }'), "居民需求详情必须排在贸易港口后");
    assert.ok(source.indexOf('{ key: "residentDemand", title: "居民需求" }') < source.indexOf('{ key: "exhibition", title: "展区" }'), "居民需求详情必须排在展区前");
    assert.ok(source.indexOf('id="scheduler_resident_demand_state"') >= 0, "总调度行必须显示居民需求状态");
    assert.ok(source.indexOf('id="resident_demand_status_detail"') >= 0, "任务详情必须显示居民需求状态");
    assert.ok(source.indexOf('id="freq_residentDemand_btn"') >= 0, "居民需求详情必须提供分钟间隔编辑器");
    assert.ok(source.indexOf("巡检间隔（分钟）") >= 0, "居民需求频率输入必须明确使用分钟单位");
    assert.ok(source.indexOf("panel.residentDemandExperienceThreshold = 500;") >= 0, "经验阈值默认必须为 500");
    assert.ok(source.indexOf("panel.residentDemandThursdayGoldEnabled = false;") >= 0, "周四金币模式默认必须关闭");
    assert.ok(source.indexOf("panel.residentDemandGoldThreshold = 2000;") >= 0, "金币阈值默认必须为 2000");
    assert.ok(source.indexOf("cfg.residentDemandExperienceThreshold") >= 0, "经验阈值必须从本地配置恢复");
    assert.ok(source.indexOf("cfg.residentDemandThursdayGoldEnabled") >= 0, "周四金币模式开关必须从本地配置恢复");
    assert.ok(source.indexOf("cfg.residentDemandGoldThreshold") >= 0, "金币阈值必须从本地配置恢复");
    assert.ok(source.indexOf("residentDemandExperienceThreshold: panel.residentDemandExperienceThreshold") >= 0, "经验阈值必须持久化");
    assert.ok(source.indexOf("residentDemandThursdayGoldEnabled: panel.residentDemandThursdayGoldEnabled") >= 0, "周四金币模式开关必须持久化");
    assert.ok(source.indexOf("residentDemandGoldThreshold: panel.residentDemandGoldThreshold") >= 0, "金币阈值必须持久化");
    assert.ok(source.indexOf('id="resident_demand_experience_threshold_btn"') >= 0, "居民需求详情必须提供经验阈值编辑器");
    assert.ok(source.indexOf('id="resident_demand_thursday_gold_enabled"') >= 0, "居民需求详情必须提供周四金币模式开关");
    assert.ok(source.indexOf('id="resident_demand_gold_threshold_btn"') >= 0, "居民需求详情必须提供金币阈值编辑器");
    assert.ok(source.indexOf("仅设备本地周四读取金币") >= 0, "说明必须明确周四金币模式的设备本地日期语义");
    assert.ok(source.indexOf("金币阈值始终可预设") >= 0, "说明必须明确金币阈值可以预设");
    assert.ok(source.indexOf('"resident_demand_experience_threshold_btn", "resident_demand_thursday_gold_enabled", "resident_demand_gold_threshold_btn"') >= 0, "运行中必须冻结三项居民奖励配置");
    assert.ok(source.indexOf("function editResidentDemandExperienceThreshold()") >= 0, "经验阈值必须提供独立编辑处理");
    assert.ok(source.indexOf("function editResidentDemandGoldThreshold()") >= 0, "金币阈值必须提供独立编辑处理");
    assert.ok(source.indexOf("function saveResidentDemandThursdayGoldEnabled()") >= 0, "周四金币模式必须提供独立保存处理");
    assert.ok(source.indexOf("isPositiveInteger(cfg.residentDemandExperienceThreshold)") >= 0, "恢复的经验阈值必须拒绝损坏配置");
    assert.ok(source.indexOf("isPositiveInteger(cfg.residentDemandGoldThreshold)") >= 0, "恢复的金币阈值必须拒绝损坏配置");
    assert.ok(source.indexOf("panel.applyResidentDemandSafeCheck = function(state)") >= 0, "安全返回后的居民时间戳必须通过统一方法保存");
    assert.ok(source.indexOf("panel.isResidentDemandCompletedToday = function(now)") >= 0, "跨日必须按完成日期实时判断每日状态");
    assert.ok(source.indexOf("panel.residentDemandDailyCompletedAt") < 0, "完成状态不得继续使用跨日易失的时间戳字段");
    assert.ok(source.indexOf('"freq_residentDemand_btn"') >= 0, "运行中必须冻结居民需求频率编辑");
    assert.ok(source.indexOf('"scheduler_cb_residentDemand"') >= 0, "运行中必须冻结居民需求开关");
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
assert.ok(panelSource.indexOf("panel.shipPrepareMinutes = 1;") >= 0, "商船提前准备默认必须为 1 分钟");
assert.ok(panelSource.indexOf("cfg.shipPrepareMinutes") >= 0, "商船提前准备分钟数必须从本地配置恢复");
assert.ok(panelSource.indexOf("shipPrepareMinutes: panel.shipPrepareMinutes") >= 0, "商船提前准备分钟数必须持久化");
assert.ok(panelSource.indexOf('id="ship_prepare_minutes_btn"') >= 0, "商船详情必须提供提前进入分钟编辑器");
assert.ok(panelSource.indexOf("提前进入时间（分钟）") >= 0, "商船提前时间输入必须明确使用分钟单位");
assert.ok(panelSource.indexOf("panel.shipRetryMinutes = 1;") >= 0, "商船夺回重试默认必须为 1 分钟");
assert.ok(panelSource.indexOf("cfg.shipRetryMinutes") >= 0, "商船夺回重试分钟数必须从本地配置恢复");
assert.ok(panelSource.indexOf("shipRetryMinutes: panel.shipRetryMinutes") >= 0, "商船夺回重试分钟数必须持久化");
assert.ok(panelSource.indexOf('id="ship_retry_minutes_btn"') >= 0, "商船详情必须提供夺回重试分钟编辑器");
assert.ok(panelSource.indexOf("夺回重试间隔（分钟）") >= 0, "商船重试时间输入必须明确使用分钟单位");
assert.ok(sourceHasRetryValidation(panelSource), "商船重试间隔恢复必须拒绝小数、非正值和非有限数");
assert.ok(panelSource.indexOf("8:00-19:00；20:00-21:00 盟战优先") >= 0, "商船说明必须明确盟战窗口优先级");

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
assertResourceCollectionContract(panelSource);
assertWarFleetPlanContract(panelSource);
assertResidentDemandContract(panelSource);

console.log("floating panel layout contract test passed");

/**
 * 验证商船重试配置沿用分钟级正整数约束，避免损坏持久化值导致每轮都触发重试。
 * @param {string} source 浮窗模块源码。
 * @returns {boolean} 存在完整的正整数校验时返回 true。
 */
function sourceHasRetryValidation(source) {
    return source.indexOf('typeof cfg.shipRetryMinutes === "number" && isFinite(cfg.shipRetryMinutes) && cfg.shipRetryMinutes > 0 && Math.floor(cfg.shipRetryMinutes) === cfg.shipRetryMinutes') >= 0;
}
