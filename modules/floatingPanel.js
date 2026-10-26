// floatingPanel.js — 悬浮球 + 控制面板

var panel = {};
var floatWin = null;
var _sto = storages.create("fkssj_config");
var panelColors = null;

// 地点数组同时定义复选框显示顺序与寻宝尝试顺序，保存配置时始终按此顺序重建。
var EXHIBITION_SITE_OPTIONS = [
    { key: "old_lighthouse", label: "旧灯塔瞭望台" },
    { key: "library_ruins", label: "图书馆残址" },
    { key: "feathered_serpent", label: "羽蛇神祭坛" },
    { key: "winter_palace", label: "冬宫残影" },
    { key: "pharaoh_tomb", label: "法老之墓" },
    { key: "crusader_anchorage", label: "十字军锚地" },
    { key: "moon_pyramid", label: "月亮金字塔" },
    { key: "desert_oasis", label: "沙漠绿洲" },
    { key: "amber_remains", label: "琥珀石残迹" },
    { key: "sunken_church", label: "沉没教堂" }
];
var EXHIBITION_DURATION_HOURS = [4, 8, 12];
var WAR_FLEET_COUNT = 3;

/**
 * 创建三支舰队的默认城战计划。目标留空仍参与城战，并由城战模块选择首个可用同类城镇。
 * @returns {Array<{mode: "attack"|"defend"|"rally", target: string, repairAccelerate: boolean, marchAccelerate: boolean}>} 默认计划。
 */
function createDefaultWarFleetPlans() {
    var plans = [];
    for (var i = 0; i < WAR_FLEET_COUNT; i++) {
        plans.push({ mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false });
    }
    return plans;
}

/**
 * 仅恢复逐舰队城战结构中的有效字段；集结也是舰队独立模式，旧全局模式不参与恢复。
 * @param {Array<Object>} source 本地存储中的计划。
 * @returns {Array<Object>|null} 三支有效计划；结构不完整时返回 null 并保留默认值。
 */
function normalizeWarFleetPlans(source) {
    if (!Array.isArray(source) || source.length !== WAR_FLEET_COUNT) return null;
    var plans = [];
    for (var i = 0; i < WAR_FLEET_COUNT; i++) {
        var item = source[i] || {};
        var rawTarget = String(item.target || "").replace(/\s/g, "");
        var target = rawTarget.toUpperCase();
        if ((item.mode !== "attack" && item.mode !== "defend" && item.mode !== "rally") || (target && !/^[A-Z][0-9]+$/.test(target))) return null;
        plans.push({
            mode: item.mode,
            target: target,
            repairAccelerate: item.repairAccelerate === true,
            marchAccelerate: item.marchAccelerate === true
        });
    }
    return plans;
}

/**
 * 将毫秒时间戳转换为设备本地日期键，居民需求的每日状态不能依赖宿主机日期。
 * @param {number} timestamp 毫秒时间戳。
 * @returns {string|null} 本地日期键；无效时间戳返回 null。
 */
function getLocalDateKey(timestamp) {
    if (typeof timestamp !== "number" || !isFinite(timestamp) || timestamp <= 0) return null;
    var date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return date.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
}

/**
 * 判断持久化字符串是否为真实存在的本地日历日期键。
 * 居民需求的每日完成状态以业务日期存储；损坏的值必须按未完成处理，不能跨日误跳过任务。
 * @param {*} value 待校验的日期键。
 * @returns {boolean} 仅 `YYYY-MM-DD` 且对应真实日历日期时返回 true。
 */
function isLocalDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * 判断持久化的居民需求数值配置是否为正整数。
 * @param {*} value 待校验的本地配置值。
 * @returns {boolean} 仅有效正整数返回 true。
 */
function isPositiveInteger(value) {
    return typeof value === "number" && isFinite(value) && value > 0 && Math.floor(value) === value;
}

// 状态存储在模块上，避免跨上下文丢失
panel.selectedFood = "";
panel.warFleetPlans = createDefaultWarFleetPlans();
panel.warClaimReward = true;
panel.weaponType = "枪械";
panel.weaponLevel = "蓝级";
panel.weaponFridayOnly = false;
panel.running = false;
panel.runCount = 0;
// null 表示总调度页；详情页状态只在当前打开的面板实例内保留。
panel.activeTaskDetail = null;
panel._ballPos = null;
panel.freq = { food: 30, weapon: 30, war: 20, tradePort: 10, residentDemand: 10, exhibition: 10, intelligence: 4, hangUpReward: 1, resourceExperience: 10, resourceFactory: 10 };
// 商船在整点前进入活动弹窗，默认预留 1 分钟；该值不属于普通任务完成后的轮询间隔。
panel.shipPrepareMinutes = 1;
// 货轮仍在列表时默认每分钟重走一轮商船流程；该值仅在下一次启动总调度器时生效。
panel.shipRetryMinutes = 1;
panel.stats = { food: 0, weapon: 0, ship: 0, war: 0 };
panel.taskEnabled = { food: false, weapon: false, ship: false, war: false, tradePort: false, gather: false, residentDemand: false, exhibition: false, intelligence: false, resourceCollection: false };
// 资源收集组默认勾选全部子功能；外层总开关仍默认关闭，避免脚本升级后直接触发游戏操作。
panel.resourceCollection = { hangUpReward: true, experience: true, factory: true };
panel.tradePortLastCompletedAt = 0;
// 居民需求只在确认返回基地后写入；巡检时间和 YYYY-MM-DD 完成日期分别保存，跨零点时以完成日期重新判断今日状态。
panel.residentDemandLastCheckedAt = 0;
panel.residentDemandCompletedDate = "";
// 奖励阈值独立持久化；周四金币模式默认关闭，避免升级后改变既有经验判断。
panel.residentDemandExperienceThreshold = 500;
panel.residentDemandThursdayGoldEnabled = false;
panel.residentDemandGoldThreshold = 2000;
panel.gatherIntervalMinutes = 60;
panel.gatherThresholdPercent = 90;
panel.gatherDurationMinutes = 5;
panel.exhibitionLastCompletedAt = 0;
panel.exhibitionDurationHours = 4;
panel.exhibitionSites = EXHIBITION_SITE_OPTIONS.map(function(option) { return option.label; });
// 情报仅在奖励关闭、气泡处理完且安全回到基地后才更新，重启脚本仍会遵守完成后间隔。
panel.intelligenceLastCompletedAt = 0;
panel.schedulerStatus = "请选择要调度的任务";

/**
 * 判断居民需求是否已在当前设备本地日期完成。
 * 已完成日期保留用于审计；每次展示和调度都直接与今天比较，不依赖跨零点定时器清除内存状态。
 * @param {number} [now] 当前设备毫秒时间戳；未传入时使用当前时间。
 * @returns {boolean} 完成日期就是今天时返回 true。
 */
panel.isResidentDemandCompletedToday = function(now) {
    var current = typeof now === "number" ? now : Date.now();
    return isLocalDateKey(panel.residentDemandCompletedDate) && panel.residentDemandCompletedDate === getLocalDateKey(current);
};

/**
 * 返回居民需求今日状态的只读文案，供主页和悬浮面板使用。
 * @param {number} [now] 当前设备毫秒时间戳；未传入时使用当前时间。
 * @returns {string} “今日已完成”或“今日未完成”。
 */
panel.getResidentDemandStatusText = function(now) {
    return panel.isResidentDemandCompletedToday(now) ? "今日已完成" : "今日未完成";
};

/**
 * 刷新悬浮面板中居民需求的状态标记。页面可能已经折叠，因此保留状态字段并仅更新当前存在的控件。
 * @param {number} [now] 当前设备毫秒时间戳；测试或跨日刷新时可显式指定。
 * @returns {string} 刷新后的今日状态文案。
 */
panel.refreshResidentDemandStatus = function(now) {
    var text = panel.getResidentDemandStatusText(now);
    if (typeof $ui === "undefined" || typeof $ui.run !== "function") return text;
    $ui.run(function() {
        try { if (floatWin && floatWin.scheduler_resident_demand_state) floatWin.scheduler_resident_demand_state.setText(text); } catch(e) {}
        try { if (floatWin && floatWin.resident_demand_status_detail) floatWin.resident_demand_status_detail.setText(text); } catch(e) {}
    });
    return text;
};

/**
 * 记录居民需求模块在安全返回基地后的巡检结果并一次性持久化。
 * @param {{lastCheckedAt:number,completedDate?:string}} state 模块回调的已确认状态。
 * @returns {boolean} 状态有效并已保存时返回 true。
 */
panel.applyResidentDemandSafeCheck = function(state) {
    if (!state || typeof state.lastCheckedAt !== "number" || !isFinite(state.lastCheckedAt) || state.lastCheckedAt <= 0) return false;
    panel.residentDemandLastCheckedAt = state.lastCheckedAt;
    // 完成日期由居民模块按巡检开始日期计算；仅终态并安全返回基地后才允许覆盖本地记录。
    if (isLocalDateKey(state.completedDate)) panel.residentDemandCompletedDate = state.completedDate;
    // 回调只来自居民模块已确认返回基地的边界，避免停止、协商中或未知页面提前持久化。
    panel._saveConfig();
    panel.refreshResidentDemandStatus();
    return true;
};

// 从本地存储恢复配置
/**
 * 从 Auto.js 本地存储恢复调度开关、任务参数和累计统计。
 */
panel._loadConfig = function() {
    try {
        var cfg = _sto.get("config");
        if (cfg) {
            if (cfg.selectedFood) panel.selectedFood = cfg.selectedFood;
            var savedWarFleetPlans = normalizeWarFleetPlans(cfg.warFleetPlans);
            if (savedWarFleetPlans) panel.warFleetPlans = savedWarFleetPlans;
            if (typeof cfg.warClaimReward === "boolean") panel.warClaimReward = cfg.warClaimReward;
            if (cfg.weaponType) panel.weaponType = cfg.weaponType;
            if (cfg.weaponLevel) panel.weaponLevel = cfg.weaponLevel;
            if (typeof cfg.weaponFridayOnly === "boolean") panel.weaponFridayOnly = cfg.weaponFridayOnly;
            if (cfg.freq) {
                if (cfg.freq.food) panel.freq.food = cfg.freq.food;
                if (cfg.freq.weapon) panel.freq.weapon = cfg.freq.weapon;
                if (cfg.freq.war) panel.freq.war = cfg.freq.war;
                if (cfg.freq.tradePort) panel.freq.tradePort = cfg.freq.tradePort;
                // 居民需求巡检按分钟计且只接受正整数，损坏配置不能突破默认 10 分钟冷却。
                if (typeof cfg.freq.residentDemand === "number" && isFinite(cfg.freq.residentDemand) && cfg.freq.residentDemand > 0 && Math.floor(cfg.freq.residentDemand) === cfg.freq.residentDemand) {
                    panel.freq.residentDemand = cfg.freq.residentDemand;
                }
                if (cfg.freq.exhibition) panel.freq.exhibition = cfg.freq.exhibition;
                if (typeof cfg.freq.intelligence === "number" && isFinite(cfg.freq.intelligence) && cfg.freq.intelligence > 0 && Math.floor(cfg.freq.intelligence) === cfg.freq.intelligence) {
                    panel.freq.intelligence = cfg.freq.intelligence;
                }
                // 挂机奖励以小时计且只允许正整数，损坏的本地值不能让调度器进入无效冷却。
                if (typeof cfg.freq.hangUpReward === "number" && isFinite(cfg.freq.hangUpReward) && cfg.freq.hangUpReward > 0 && Math.floor(cfg.freq.hangUpReward) === cfg.freq.hangUpReward) {
                    panel.freq.hangUpReward = cfg.freq.hangUpReward;
                }
                // 两类地图气泡均以分钟冷却，损坏配置不能覆盖默认 10 分钟。
                if (typeof cfg.freq.resourceExperience === "number" && isFinite(cfg.freq.resourceExperience) && cfg.freq.resourceExperience > 0 && Math.floor(cfg.freq.resourceExperience) === cfg.freq.resourceExperience) {
                    panel.freq.resourceExperience = cfg.freq.resourceExperience;
                }
                if (typeof cfg.freq.resourceFactory === "number" && isFinite(cfg.freq.resourceFactory) && cfg.freq.resourceFactory > 0 && Math.floor(cfg.freq.resourceFactory) === cfg.freq.resourceFactory) {
                    panel.freq.resourceFactory = cfg.freq.resourceFactory;
                }
            }
            // 提前进入时间直接影响整点抢占边界，损坏、小数或非正值不能覆盖默认 1 分钟。
            if (typeof cfg.shipPrepareMinutes === "number" && isFinite(cfg.shipPrepareMinutes) && cfg.shipPrepareMinutes > 0 && Math.floor(cfg.shipPrepareMinutes) === cfg.shipPrepareMinutes) {
                panel.shipPrepareMinutes = cfg.shipPrepareMinutes;
            }
            // 夺回重试与提前进入都影响限时边界，损坏、小数或非正值不能覆盖默认 1 分钟。
            if (typeof cfg.shipRetryMinutes === "number" && isFinite(cfg.shipRetryMinutes) && cfg.shipRetryMinutes > 0 && Math.floor(cfg.shipRetryMinutes) === cfg.shipRetryMinutes) {
                panel.shipRetryMinutes = cfg.shipRetryMinutes;
            }
            if (typeof cfg.tradePortLastCompletedAt === "number") panel.tradePortLastCompletedAt = cfg.tradePortLastCompletedAt;
            if (typeof cfg.residentDemandLastCheckedAt === "number") panel.residentDemandLastCheckedAt = cfg.residentDemandLastCheckedAt;
            // 只读取新日期字段，不把旧时间戳当作本日完成，升级后会在下一次真实安全巡检写入标准日期。
            if (isLocalDateKey(cfg.residentDemandCompletedDate)) panel.residentDemandCompletedDate = cfg.residentDemandCompletedDate;
            // 缺失或损坏的新增阈值保持初始化默认值，不能从其他任务配置推断或复用。
            if (isPositiveInteger(cfg.residentDemandExperienceThreshold)) panel.residentDemandExperienceThreshold = cfg.residentDemandExperienceThreshold;
            if (typeof cfg.residentDemandThursdayGoldEnabled === "boolean") panel.residentDemandThursdayGoldEnabled = cfg.residentDemandThursdayGoldEnabled;
            if (isPositiveInteger(cfg.residentDemandGoldThreshold)) panel.residentDemandGoldThreshold = cfg.residentDemandGoldThreshold;
            if (typeof cfg.gatherIntervalMinutes === "number" && cfg.gatherIntervalMinutes > 0) panel.gatherIntervalMinutes = cfg.gatherIntervalMinutes;
            if (typeof cfg.gatherThresholdPercent === "number" && cfg.gatherThresholdPercent >= 1 && cfg.gatherThresholdPercent <= 100) panel.gatherThresholdPercent = cfg.gatherThresholdPercent;
            // null 明确表示不限时；旧配置缺少字段时继续使用默认 5 分钟。
            if (cfg.gatherDurationMinutes === null || (typeof cfg.gatherDurationMinutes === "number" && cfg.gatherDurationMinutes > 0)) panel.gatherDurationMinutes = cfg.gatherDurationMinutes;
            if (typeof cfg.exhibitionLastCompletedAt === "number") panel.exhibitionLastCompletedAt = cfg.exhibitionLastCompletedAt;
            if (typeof cfg.intelligenceLastCompletedAt === "number") panel.intelligenceLastCompletedAt = cfg.intelligenceLastCompletedAt;
            if (EXHIBITION_DURATION_HOURS.indexOf(cfg.exhibitionDurationHours) >= 0) panel.exhibitionDurationHours = cfg.exhibitionDurationHours;
            if (Array.isArray(cfg.exhibitionSites)) {
                // 以固定地点表重建，防止旧存储的点击顺序改变寻宝优先级。
                panel.exhibitionSites = EXHIBITION_SITE_OPTIONS.filter(function(option) {
                    return cfg.exhibitionSites.indexOf(option.label) >= 0;
                }).map(function(option) {
                    return option.label;
                });
            }
            if (cfg.ballPos) panel._ballPos = cfg.ballPos;
            if (cfg.stats) panel.stats = cfg.stats;
            if (cfg.resourceCollection) {
                ["hangUpReward", "experience", "factory"].forEach(function(key) {
                    if (typeof cfg.resourceCollection[key] === "boolean") panel.resourceCollection[key] = cfg.resourceCollection[key];
                });
            }
            if (cfg.taskEnabled) {
                ["food", "weapon", "ship", "war", "tradePort", "gather", "residentDemand", "exhibition", "intelligence", "resourceCollection"].forEach(function(key) {
                    if (typeof cfg.taskEnabled[key] === "boolean") panel.taskEnabled[key] = cfg.taskEnabled[key];
                });
            }
        }
    } catch(e) {}
};

/**
 * 保存总调度器与任务页共享的配置，确保重新打开悬浮球后状态一致。
 */
panel._saveConfig = function() {
    try {
        _sto.put("config", {
            selectedFood: panel.selectedFood,
            warFleetPlans: panel.warFleetPlans,
            warClaimReward: panel.warClaimReward,
            weaponType: panel.weaponType,
            weaponLevel: panel.weaponLevel,
            weaponFridayOnly: panel.weaponFridayOnly,
            freq: panel.freq,
            // 商船需要在整点前打开活动弹窗，此配置以分钟保存且不与普通任务秒级间隔混用。
            shipPrepareMinutes: panel.shipPrepareMinutes,
            // 货轮仍在列表时按此分钟值重新进入活动夺回；运行中使用启动快照避免改变当前时段计划。
            shipRetryMinutes: panel.shipRetryMinutes,
            // 仅在贸易港口已确认关闭后更新，确保重启后仍遵守完成后间隔。
            tradePortLastCompletedAt: panel.tradePortLastCompletedAt,
            // 居民需求的巡检和完成日期只由安全回到基地后的回调写入；展示与调度实时比较完成日期和今天。
            residentDemandLastCheckedAt: panel.residentDemandLastCheckedAt,
            residentDemandCompletedDate: panel.residentDemandCompletedDate,
            // 奖励判断由居民模块按设备本地星期使用，三个字段必须成组保存，避免下次启动退回隐式固定阈值。
            residentDemandExperienceThreshold: panel.residentDemandExperienceThreshold,
            residentDemandThursdayGoldEnabled: panel.residentDemandThursdayGoldEnabled,
            residentDemandGoldThreshold: panel.residentDemandGoldThreshold,
            gatherIntervalMinutes: panel.gatherIntervalMinutes,
            gatherThresholdPercent: panel.gatherThresholdPercent,
            // null 代表不限时，不能将其与旧配置缺失合并处理。
            gatherDurationMinutes: panel.gatherDurationMinutes,
            // 展区仅在安全回到主界面后更新该时间，脚本重启后仍可遵守冷却。
            exhibitionLastCompletedAt: panel.exhibitionLastCompletedAt,
            exhibitionDurationHours: panel.exhibitionDurationHours,
            exhibitionSites: panel.exhibitionSites,
            // 情报只由 intelligence.runOnce 的安全完成回调更新，不能在中断时提前写入。
            intelligenceLastCompletedAt: panel.intelligenceLastCompletedAt,
            // 三个子功能开关与频率会跨重启保留；完成时间只由 scheduler 在本次会话内维护。
            resourceCollection: panel.resourceCollection,
            ballPos: panel._ballPos,
            stats: panel.stats,
            taskEnabled: panel.taskEnabled
        });
    } catch(e) {}
};

// 启动时加载配置
panel._loadConfig();

/**
 * 关闭当前浮窗，并清空仅属于该窗口实例的主题引用。
 */
function closeFloat() {
    if (floatWin) {
        try { floatWin.close(); } catch(e) {}
        floatWin = null;
    }
    panelColors = null;
}
panel.closeFloat = closeFloat;

/**
 * 任务详情页唯一登记表。新增任务时登记 key、标题并补充同名的 set_<key> 布局，
 * 总调度页的箭头入口和详情显隐会共用这份清单。
 */
var TASK_DETAIL_PAGES = [
    { key: "weapon", title: "锻造" },
    { key: "food", title: "种植" },
    { key: "gather", title: "打捞资源" },
    { key: "tradePort", title: "贸易港口" },
    { key: "residentDemand", title: "居民需求" },
    { key: "exhibition", title: "展区" },
    { key: "intelligence", title: "情报" },
    { key: "resourceCollection", title: "资源收集" },
    { key: "ship", title: "商船" },
    { key: "war", title: "盟战" }
];

/**
 * 按任务键取得详情页描述，确保箭头入口与设置区使用同一份任务登记信息。
 * @param {string|null} key 任务键；null 表示总调度页。
 * @returns {Object|null} 已登记的配置页描述；未登记时返回 null。
 */
function getTaskDetailPage(key) {
    for (var i = 0; i < TASK_DETAIL_PAGES.length; i++) {
        if (TASK_DETAIL_PAGES[i].key === key) return TASK_DETAIL_PAGES[i];
    }
    return null;
}

/**
 * 根据当前导航状态切换总调度页、任务详情与详情标题的可见性。
 */
function updateTaskSettingsVisibility() {
    if (!floatWin) return;
    var taskDetail = getTaskDetailPage(panel.activeTaskDetail);
    var isTaskDetail = taskDetail !== null;
    try { floatWin.set_scheduler.setVisibility(isTaskDetail ? android.view.View.GONE : android.view.View.VISIBLE); } catch(e) {}
    for (var i = 0; i < TASK_DETAIL_PAGES.length; i++) {
        var task = TASK_DETAIL_PAGES[i];
        try {
            floatWin["set_" + task.key].setVisibility(taskDetail && task.key === taskDetail.key ? android.view.View.VISIBLE : android.view.View.GONE);
        } catch(e) {}
    }
    try { floatWin.detail_page_header.setVisibility(isTaskDetail ? android.view.View.VISIBLE : android.view.View.GONE); } catch(e) {}
    if (taskDetail) {
        try { floatWin.detail_page_title.setText(taskDetail.title + "配置"); } catch(e) {}
    }
}

/**
 * 根据页面位置和运行状态更新底部主按钮，避免任务详情页误触发总调度器启停。
 */
function refreshPrimaryAction() {
    if (!floatWin || !panelColors) return;
    var isTaskDetail = getTaskDetailPage(panel.activeTaskDetail) !== null;
    try {
        floatWin.btn_run.setCardBackgroundColor(colors.parseColor(isTaskDetail ? "#F5F5F5" : (panel.running ? panelColors.error : panelColors.accent)));
        floatWin.btn_run_t.setText(isTaskDetail ? "‹ 返回" : (panel.running ? "■ 停止" : "▶ 运行"));
        floatWin.btn_run_t.setTextColor(colors.parseColor(isTaskDetail ? "#636366" : "#FFFFFF"));
    } catch(e) {}
}

/**
 * 显示可拖动的悬浮球入口。
 */
panel.showBall = function(ctx) {
    closeFloat();
    var dp = ctx.dp;
    var sz = dp(44), pad = dp(8), total = sz + pad * 2, half = total / 2, r = sz / 2;
    floatWin = floaty.rawWindow(
        <frame id="root" bg="#00000000">
            <canvas id="cv" w={total} h={total}/>
        </frame>
    );
    floatWin.setSize(total, total);
    floatWin.cv.on("draw", function(canvas) {
        var p = new Paint();
        p.setAntiAlias(true);
        var glowColor = panel.running ? "#334CAF50" : "#33A04468";
        var glowColor2 = panel.running ? "#1A4CAF50" : "#1AA04468";
        var ringColor = panel.running ? "#664CAF50" : "#66A04468";
        p.setStyle(Paint.Style.FILL);
        p.setColor(colors.parseColor(glowColor));
        canvas.drawCircle(half, half, half, p);
        p.setColor(colors.parseColor(glowColor2));
        canvas.drawCircle(half, half, half, p);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(dp(1.5));
        p.setColor(colors.parseColor(ringColor));
        canvas.drawCircle(half, half, r, p);
        p.setStyle(Paint.Style.FILL);
        canvas.saveLayer(0, 0, total, total, null, android.graphics.Canvas.ALL_SAVE_FLAG);
        p.setColor(colors.parseColor("#FFFFFFFF"));
        canvas.drawCircle(half, half, r, p);
        p.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN));
        var src = new android.graphics.Rect(0, 0, ctx.icoBitmap.getWidth(), ctx.icoBitmap.getHeight());
        var dst = new android.graphics.Rect(pad, pad, pad + sz, pad + sz);
        canvas.drawBitmap(ctx.icoBitmap, src, dst, p);
        p.setXfermode(null);
        canvas.restore();
    });
    floatWin.cv.invalidate();
    var dm = context.getResources().getDisplayMetrics();
    var resId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
    var statusBarH = context.getResources().getDimensionPixelSize(resId);
    var initX, initY;
    if (panel._ballPos) {
        initX = panel._ballPos.x;
        initY = panel._ballPos.y;
    } else {
        initX = dm.widthPixels - total - dp(6);
        initY = -statusBarH;
    }
    floatWin.setPosition(initX, initY);
    var tx, ty, wx, wy, moved;
    floatWin.root.setOnTouchListener(function(v, e) {
        switch(e.getAction()) {
            case 0: tx = e.getRawX(); ty = e.getRawY(); wx = floatWin.getX(); wy = floatWin.getY(); moved = false; break;
            case 2:
                if (Math.abs(e.getRawX()-tx) > 8 || Math.abs(e.getRawY()-ty) > 8) moved = true;
                var nx = Math.max(0, Math.min(dm.widthPixels - total, wx + (e.getRawX()-tx)));
                var ny = Math.max(-statusBarH, Math.min(dm.heightPixels - statusBarH - total - dp(10), wy + (e.getRawY()-ty)));
                floatWin.setPosition(nx, ny);
                break;
            case 1:
                panel._ballPos = { x: floatWin.getX(), y: floatWin.getY() };
                panel._saveConfig();
                if (!moved) panel.expandPanel(ctx);
                break;
        }
        return true;
    });
    ctx.appendLog("悬浮球已就绪");
};

/**
 * 展开总调度和各任务参数面板。
 */
panel.expandPanel = function(ctx) {
    closeFloat();
    var dp = ctx.dp;
    var C = ctx.C;
    panelColors = C;
    var dm = context.getResources().getDisplayMetrics();
    var resId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
    var statusBarH = context.getResources().getDimensionPixelSize(resId);
    var pw = Math.round(dm.widthPixels * 0.78);
    // 固定可用工作区并让详情内容独立滚动，新增任务或说明不会把底部运行按钮挤出屏幕。
    var ph = Math.min(dp(520), dm.heightPixels - statusBarH - dp(24));
    var cropNames = ["水稻", "玉米", "土豆", "西红柿", "胡萝卜", "卷心菜", "大豆", "南瓜"];
    floatWin = floaty.rawWindow(
        <frame id="panel_root" w="*" h="*" bg="#00000000">
            <card cardCornerRadius="12dp" cardElevation="2dp" cardBackgroundColor="#FFFFFF" w="*" h="*">
                <vertical w="*" h="*" padding="0">
                <horizontal gravity="center_vertical" padding="14 12 10 10">
                    <frame id="title_dot" w="8" h="8" bg="#C7C7CC" margin="0 0 8 0" layout_gravity="center_vertical"/>
                    <text text="水世界辅助" textColor="#1C1C1E" textSize="14sp" textStyle="bold" layout_weight="1"/>
                    <text id="btn_close" text="&#10005;" textColor="#C7C7CC" textSize="14sp" padding="8 2 6 2"/>
                </horizontal>
                <ScrollView id="task_settings_scroll" w="*" h="0" layout_weight="1">
                    <vertical padding="14 2 14 6">
                    <vertical id="detail_page_header" w="*" visibility="gone" margin="0 0 0 10">
                        <text id="detail_page_title" textColor="#1C1C1E" textSize="16sp" textStyle="bold" margin="0 4 0 2"/>
                        <text text="修改完成后，点击下方“返回”回到总调度。" textColor="#8E8E93" textSize="11sp" margin="0 0 0 4"/>
                    </vertical>
                    <vertical id="set_scheduler" w="*" margin="0 0 0 0">
                        <text text="总调度" textColor="#1C1C1E" textSize="16sp" textStyle="bold" margin="0 4 0 4"/>
                        <text id="scheduler_status" text={panel.schedulerStatus} textColor="#8E8E93" textSize="11sp" margin="0 2 0 10"/>
                        <vertical>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_weapon" text="锻造" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_weapon" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_weapon_t" text={panel.freq.weapon + "s"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_weapon" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_food" text="种植" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_food" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_food_t" text={panel.freq.food + "s"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_food" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_gather" text="打捞资源" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_gather" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_gather_t" text={panel.gatherIntervalMinutes + "分"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_gather" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_tradePort" text="贸易港口" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_tradePort" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_tradePort_t" text={panel.freq.tradePort + "分"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_tradePort" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_residentDemand" text="居民需求" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <text id="scheduler_resident_demand_state" text={panel.getResidentDemandStatusText()} textColor="#5D7A5B" textSize="10sp" margin="0 0 6 0"/>
                                    <card id="scheduler_freq_residentDemand" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_residentDemand_t" text={panel.freq.residentDemand + "分"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_residentDemand" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_exhibition" text="展区" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_exhibition" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_exhibition_t" text={panel.freq.exhibition + "分"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_exhibition" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_intelligence" text="情报" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_intelligence" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_intelligence_t" text={panel.freq.intelligence + "小时"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_intelligence" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_resourceCollection" text="资源收集" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_resourceCollection" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_resourceCollection_t" text="3 项" textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_resourceCollection" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1" margin="0 0 0 6">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_ship" text="商船 · 提前准备" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_ship" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_ship_t" text={"备" + panel.shipPrepareMinutes + " / 重" + panel.shipRetryMinutes + "分"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_ship" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                            <card w="*" h="auto" cardCornerRadius="9dp" cardElevation="0dp" cardBackgroundColor="#D7DAE0" padding="1">
                                <horizontal gravity="center_vertical" bg="#FFFFFF" padding="4 2">
                                    <checkbox id="scheduler_cb_war" text="盟战 · 20:00-21:00" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                    <card id="scheduler_freq_war" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" padding="10 6"><text id="scheduler_freq_war_t" text={panel.freq.war + "s"} textColor="#A04468" textSize="13sp" gravity="center"/></card>
                                    <card id="scheduler_detail_war" w="34dp" h="34dp" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFF3F7" foreground="?selectableItemBackground" margin="6 0 0 0"><text text=">" textColor="#A04468" textSize="18sp" gravity="center" textStyle="bold"/></card>
                                </horizontal>
                            </card>
                        </vertical>
                        <text text="普通任务固定按“锻造 → 种植 → 打捞资源 → 贸易港口 → 居民需求 → 展区 → 情报 → 资源收集”执行；冷却只跳过自身。" textColor="#8E8E93" textSize="10sp" margin="2 8 0 0"/>
                    </vertical>
                    <vertical id="set_food" w="*" margin="0 0 0 0">
                        <text text="作物" textColor="#8E8E93" textSize="11sp" margin="0 0 6 0"/>
                        <card id="food_selector" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                              cardBackgroundColor="#F5F5F5" padding="12 10"
                              foreground="?selectableItemBackground">
                            <horizontal gravity="center_vertical">
                                <ImageView id="food_icon" w="24" h="24" scaleType="centerCrop" circle="true" margin="0 0 10 0"/>
                                <text id="food_label" text={panel.selectedFood} textColor="#1C1C1E" textSize="14sp" layout_weight="1"/>
                            </horizontal>
                        </card>
                        <text text="库存已满时自动切换作物" textColor="#C7C7CC" textSize="10sp" margin="4 2 0 6"/>
                        <horizontal gravity="center_vertical" margin="0 4 0 0">
                            <text text="频率" textColor="#8E8E93" textSize="12sp"/>
                            <card id="freq_food_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#FFFFFF" padding="14 12" margin="12 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="freq_food_t" text={panel.freq.food + "s"} textColor="#1C1C1E" textSize="18sp"/>
                            </card>
                        </horizontal>
                    </vertical>
                    <vertical id="set_weapon" w="*" visibility="gone" margin="0 0 0 0">
                        <horizontal gravity="center_vertical" margin="0 0 6 0">
                            <text text="种类" textColor="#8E8E93" textSize="11sp"/>
                        </horizontal>
                        <horizontal gravity="center_vertical" margin="0 0 0 6">
                            <card id="wtype_gun" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#F5F5F5" padding="16 10" margin="0 0 8 0"
                                  foreground="?selectableItemBackground">
                                <text id="wtype_gun_t" text="枪械" textSize="16sp" textColor="#8E8E93"/>
                            </card>
                            <card id="wtype_armor" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#F5F5F5" padding="16 10" margin="0 0 8 0"
                                  foreground="?selectableItemBackground">
                                <text id="wtype_armor_t" text="防具" textSize="16sp" textColor="#8E8E93"/>
                            </card>
                            <card id="wtype_blade" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#F5F5F5" padding="16 10" margin="0 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="wtype_blade_t" text="兵刃" textSize="16sp" textColor="#8E8E93"/>
                            </card>
                        </horizontal>
                        <horizontal gravity="center_vertical" margin="0 6 0 6">
                            <text text="级别" textColor="#8E8E93" textSize="11sp"/>
                        </horizontal>
                        <horizontal gravity="center_vertical" margin="0 0 0 8">
                            <card id="wlevel_blue" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#F5F5F5" padding="16 10" margin="0 0 8 0"
                                  foreground="?selectableItemBackground">
                                <text id="wlevel_blue_t" text="蓝级" textSize="16sp" textColor="#8E8E93"/>
                            </card>
                            <card id="wlevel_purple" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#F5F5F5" padding="16 10" margin="0 0 8 0"
                                  foreground="?selectableItemBackground">
                                <text id="wlevel_purple_t" text="紫级" textSize="16sp" textColor="#8E8E93"/>
                            </card>
                            <card id="wlevel_orange" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#F5F5F5" padding="16 10" margin="0 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="wlevel_orange_t" text="橙级" textSize="16sp" textColor="#8E8E93"/>
                            </card>
                        </horizontal>
                        <checkbox id="weapon_friday_only" text="只在周五锻造" textSize="13sp" textColor="#1C1C1E" margin="0 0 0 8"/>
                        <horizontal gravity="center_vertical">
                            <text text="频率" textColor="#8E8E93" textSize="12sp"/>
                            <card id="freq_weapon_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#FFFFFF" padding="14 12" margin="12 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="freq_weapon_t" text={panel.freq.weapon + "s"} textColor="#1C1C1E" textSize="18sp"/>
                            </card>
                        </horizontal>
                    </vertical>
                    <vertical id="set_tradePort" w="*" visibility="gone" margin="0 0 0 0">
                        <text text="自动进入贸易港口，领取到货后尝试全部交货并关闭弹窗。材料不足界面暂不判断。" textColor="#8E8E93" textSize="12sp" margin="0 0 0 10"/>
                        <horizontal gravity="center_vertical">
                            <text text="完成后间隔" textColor="#8E8E93" textSize="12sp"/>
                            <card id="freq_tradePort_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#FFFFFF" padding="14 12" margin="12 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="freq_tradePort_t" text={panel.freq.tradePort + " 分钟"} textColor="#1C1C1E" textSize="18sp"/>
                            </card>
                        </horizontal>
                    </vertical>
                    <vertical id="set_residentDemand" w="*" visibility="gone" margin="0 0 0 0">
                        <text text="居民每天会提出物资需求。当前奖励严格高于对应阈值且物资足够时自动满足；等于或低于阈值会刷新，物资不足则跳过等待后续补齐。" textColor="#8E8E93" textSize="12sp" margin="0 0 0 8"/>
                        <text text="默认按经验判断；开启周四按金币判断后，仅设备本地周四读取金币，其余日期仍按经验。" textColor="#C7C7CC" textSize="10sp" margin="0 0 0 8"/>
                        <text text="刷新后游戏会自动切换下一位居民；最后一位进入协商中时只退出巡检，绝不点击“立即完成”。" textColor="#C7C7CC" textSize="10sp" margin="0 0 0 10"/>
                        <horizontal gravity="center_vertical" margin="0 0 0 8">
                            <text text="状态" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <text id="resident_demand_status_detail" text={panel.getResidentDemandStatusText()} textColor="#5D7A5B" textSize="15sp" textStyle="bold"/>
                        </horizontal>
                        <horizontal gravity="center_vertical">
                            <text text="巡检间隔" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="freq_residentDemand_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="freq_residentDemand_t" text={panel.freq.residentDemand + " 分钟"} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                        <horizontal gravity="center_vertical" margin="0 8 0 0">
                            <text text="经验阈值" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="resident_demand_experience_threshold_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="resident_demand_experience_threshold_t" text={panel.residentDemandExperienceThreshold + ""} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                        <checkbox id="resident_demand_thursday_gold_enabled" text="周四按金币判断" textSize="13sp" textColor="#1C1C1E" margin="0 8 0 0"/>
                        <horizontal gravity="center_vertical">
                            <text text="金币阈值" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="resident_demand_gold_threshold_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="resident_demand_gold_threshold_t" text={panel.residentDemandGoldThreshold + ""} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                        <text text="金币阈值始终可预设，仅在开启上方开关且设备本地周四生效。" textColor="#C7C7CC" textSize="10sp" margin="0 5 0 0"/>
                    </vertical>
                    <vertical id="set_gather" w="*" visibility="gone" margin="0 0 0 0">
                        <text text="游戏生产需要使用一些资源，从固定入口获取，一般是钓鱼、拾荒、打捞。" textColor="#8E8E93" textSize="12sp" margin="0 0 0 10"/>
                        <text text="库存低于阈值时按钓鱼、拾荒、打捞各执行一次；不限时仅自动执行钓鱼。" textColor="#C7C7CC" textSize="10sp" margin="0 0 0 10"/>
                        <horizontal gravity="center_vertical" margin="0 0 0 8">
                            <text text="完成后间隔" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="gather_interval_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="gather_interval_t" text={panel.gatherIntervalMinutes + " 分钟"} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                        <horizontal gravity="center_vertical" margin="0 0 0 8">
                            <text text="打捞阈值" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="gather_threshold_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="gather_threshold_t" text={panel.gatherThresholdPercent + "%"} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                        <horizontal gravity="center_vertical">
                            <text text="打捞时间" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="gather_duration_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="gather_duration_t" text={panel.gatherDurationMinutes === null ? "不限时" : panel.gatherDurationMinutes + " 分钟"} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                    </vertical>
                    <vertical id="set_exhibition" w="*" visibility="gone" margin="0 0 0 0">
                        <text text="游戏内博物馆展品会定期产生参观值；展区右下角可派遣小队外出寻宝。" textColor="#8E8E93" textSize="12sp" margin="0 0 0 8"/>
                        <text text="任务会先收集展品和已完成奖励，再按勾选地点顺序尝试填满空闲小队。" textColor="#C7C7CC" textSize="10sp" margin="0 0 0 10"/>
                        <horizontal gravity="center_vertical" margin="0 0 0 8">
                            <text text="完成后间隔" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="freq_exhibition_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="freq_exhibition_t" text={panel.freq.exhibition + " 分钟"} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                        <text text="寻宝时间" textColor="#8E8E93" textSize="12sp" margin="0 0 0 4"/>
                        <radiogroup id="exhibition_duration_group" orientation="horizontal" margin="0 0 0 10">
                            <radio id="exhibition_duration_4" text="4小时" textSize="13sp" margin="0 0 14 0" checked="false"/>
                            <radio id="exhibition_duration_8" text="8小时" textSize="13sp" margin="0 0 14 0" checked="false"/>
                            <radio id="exhibition_duration_12" text="12小时" textSize="13sp" checked="false"/>
                        </radiogroup>
                        <text text="寻宝地点" textColor="#8E8E93" textSize="12sp" margin="0 0 0 4"/>
                        <checkbox id="exhibition_site_old_lighthouse" text="旧灯塔瞭望台" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_library_ruins" text="图书馆残址" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_feathered_serpent" text="羽蛇神祭坛" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_winter_palace" text="冬宫残影" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_pharaoh_tomb" text="法老之墓" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_crusader_anchorage" text="十字军锚地" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_moon_pyramid" text="月亮金字塔" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_desert_oasis" text="沙漠绿洲" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_amber_remains" text="琥珀石残迹" textSize="13sp" textColor="#1C1C1E"/>
                        <checkbox id="exhibition_site_sunken_church" text="沉没教堂" textSize="13sp" textColor="#1C1C1E"/>
                    </vertical>
                    <vertical id="set_intelligence" w="*" visibility="gone" margin="0 0 0 0">
                        <text text="游戏内每隔 8 小时会从 0 点开始出现联盟情报。任务会先领取绿色勾的已完成奖励，再派遣所有正常亮色气泡。" textColor="#8E8E93" textSize="12sp" margin="0 0 0 8"/>
                        <text text="浅色气泡代表进行中，会跳过；没有空闲舰队时会停留在选择页，每 30 秒等待游戏自动勾选后才出征。" textColor="#C7C7CC" textSize="10sp" margin="0 0 0 10"/>
                        <horizontal gravity="center_vertical">
                            <text text="完成后间隔" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                            <card id="freq_intelligence_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="12 9" foreground="?selectableItemBackground"><text id="freq_intelligence_t" text={panel.freq.intelligence + " 小时"} textColor="#1C1C1E" textSize="15sp"/></card>
                        </horizontal>
                    </vertical>
                    <vertical id="set_resourceCollection" w="*" visibility="gone" margin="0 0 0 0">
                        <text text="按勾选的功能定时领取挂机奖励、经验气泡和工厂物资。未发现资源时会经锻造坊返回并缩小地图后再检查。" textColor="#8E8E93" textSize="12sp" margin="0 0 0 8"/>
                        <text text="三个功能的完成时间只在本次总调度运行中生效；停止并重启脚本后会重新检查。" textColor="#C7C7CC" textSize="10sp" margin="0 0 0 10"/>
                        <card w="*" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#F5F5F5" padding="10 7" margin="0 0 0 7">
                            <horizontal gravity="center_vertical">
                                <checkbox id="resource_collection_hang_up" text="挂机奖励" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                <text text="间隔时间" textColor="#8E8E93" textSize="11sp" margin="0 0 7 0"/>
                                <card id="freq_hangUpReward_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="10 7" foreground="?selectableItemBackground"><text id="freq_hangUpReward_t" text={panel.freq.hangUpReward + " 小时"} textColor="#1C1C1E" textSize="14sp"/></card>
                            </horizontal>
                        </card>
                        <card w="*" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#F5F5F5" padding="10 7" margin="0 0 0 7">
                            <horizontal gravity="center_vertical">
                                <checkbox id="resource_collection_experience" text="收集资源" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                <text text="间隔时间" textColor="#8E8E93" textSize="11sp" margin="0 0 7 0"/>
                                <card id="freq_resourceExperience_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="10 7" foreground="?selectableItemBackground"><text id="freq_resourceExperience_t" text={panel.freq.resourceExperience + " 分钟"} textColor="#1C1C1E" textSize="14sp"/></card>
                            </horizontal>
                        </card>
                        <card w="*" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#F5F5F5" padding="10 7">
                            <horizontal gravity="center_vertical">
                                <checkbox id="resource_collection_factory" text="工厂生产收集" textSize="13sp" textColor="#1C1C1E" layout_weight="1"/>
                                <text text="间隔时间" textColor="#8E8E93" textSize="11sp" margin="0 0 7 0"/>
                                <card id="freq_resourceFactory_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="10 7" foreground="?selectableItemBackground"><text id="freq_resourceFactory_t" text={panel.freq.resourceFactory + " 分钟"} textColor="#1C1C1E" textSize="14sp"/></card>
                            </horizontal>
                        </card>
                    </vertical>
                    <vertical id="set_ship" w="*" visibility="gone" margin="0 0 0 0">
                        <horizontal gravity="center_vertical" margin="0 0 6 0">
                            <text text="8:00-19:00；20:00-21:00 盟战优先" textColor="#C7C7CC" textSize="10sp"/>
                        </horizontal>
                        <text text="提前进入“搁浅的货轮”活动弹窗；整点立即出征。货轮仍在列表时按重试间隔重新夺回，货轮消失则等待下一整点。准备期会暂停其他任务。" textColor="#8E8E93" textSize="12sp" margin="0 0 0 8"/>
                        <horizontal gravity="center_vertical">
                            <text text="提前进入" textColor="#8E8E93" textSize="12sp"/>
                            <card id="ship_prepare_minutes_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#FFFFFF" padding="14 12" margin="12 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="ship_prepare_minutes_t" text={panel.shipPrepareMinutes + " 分钟"} textColor="#1C1C1E" textSize="18sp"/>
                            </card>
                        </horizontal>
                        <horizontal gravity="center_vertical" margin="0 10 0 0">
                            <text text="夺回重试间隔" textColor="#8E8E93" textSize="12sp"/>
                            <card id="ship_retry_minutes_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#FFFFFF" padding="14 12" margin="12 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="ship_retry_minutes_t" text={panel.shipRetryMinutes + " 分钟"} textColor="#1C1C1E" textSize="18sp"/>
                            </card>
                        </horizontal>
                    </vertical>
                    <vertical id="set_war" w="*" visibility="gone" margin="0 0 0 0">
                        <text text="20:00-21:00 城战；每段维修或行军倒计时最多加速一次。" textColor="#8E8E93" textSize="11sp" margin="0 0 0 10"/>
                        <vertical id="war_fleet_1_card" padding="10 8" margin="0 0 0 8" background="#F2F3F5">
                            <text text="舰队一" textColor="#1C1C1E" textSize="14sp" textStyle="bold"/>
                            <radiogroup id="war_fleet_1_mode" orientation="horizontal" margin="0 4 0 4">
                                <radio id="war_fleet_1_rally" text="集结" textSize="13sp" margin="0 0 14 0" checked="false"/>
                                <radio id="war_fleet_1_attack" text="进攻" textSize="13sp" margin="0 0 14 0" checked="false"/>
                                <radio id="war_fleet_1_defend" text="防守" textSize="13sp" checked="false"/>
                            </radiogroup>
                            <horizontal gravity="center_vertical">
                                <text text="优先城镇" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                                <card id="war_fleet_1_target_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="10 7"><text id="war_fleet_1_target_t" text="自动选择" textColor="#1C1C1E" textSize="13sp"/></card>
                            </horizontal>
                            <checkbox id="war_fleet_1_repair" text="维修加速" textColor="#1C1C1E" textSize="13sp" checked="false"/>
                            <checkbox id="war_fleet_1_march" text="行军加速" textColor="#1C1C1E" textSize="13sp" checked="false"/>
                        </vertical>
                        <vertical id="war_fleet_2_card" padding="10 8" margin="0 0 0 8" background="#F2F3F5">
                            <text text="舰队二" textColor="#1C1C1E" textSize="14sp" textStyle="bold"/>
                            <radiogroup id="war_fleet_2_mode" orientation="horizontal" margin="0 4 0 4">
                                <radio id="war_fleet_2_rally" text="集结" textSize="13sp" margin="0 0 14 0" checked="false"/>
                                <radio id="war_fleet_2_attack" text="进攻" textSize="13sp" margin="0 0 14 0" checked="false"/>
                                <radio id="war_fleet_2_defend" text="防守" textSize="13sp" checked="false"/>
                            </radiogroup>
                            <horizontal gravity="center_vertical">
                                <text text="优先城镇" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                                <card id="war_fleet_2_target_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="10 7"><text id="war_fleet_2_target_t" text="自动选择" textColor="#1C1C1E" textSize="13sp"/></card>
                            </horizontal>
                            <checkbox id="war_fleet_2_repair" text="维修加速" textColor="#1C1C1E" textSize="13sp" checked="false"/>
                            <checkbox id="war_fleet_2_march" text="行军加速" textColor="#1C1C1E" textSize="13sp" checked="false"/>
                        </vertical>
                        <vertical id="war_fleet_3_card" padding="10 8" margin="0 0 0 8" background="#F2F3F5">
                            <text text="舰队三" textColor="#1C1C1E" textSize="14sp" textStyle="bold"/>
                            <radiogroup id="war_fleet_3_mode" orientation="horizontal" margin="0 4 0 4">
                                <radio id="war_fleet_3_rally" text="集结" textSize="13sp" margin="0 0 14 0" checked="false"/>
                                <radio id="war_fleet_3_attack" text="进攻" textSize="13sp" margin="0 0 14 0" checked="false"/>
                                <radio id="war_fleet_3_defend" text="防守" textSize="13sp" checked="false"/>
                            </radiogroup>
                            <horizontal gravity="center_vertical">
                                <text text="优先城镇" textColor="#8E8E93" textSize="12sp" layout_weight="1"/>
                                <card id="war_fleet_3_target_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp" cardBackgroundColor="#FFFFFF" padding="10 7"><text id="war_fleet_3_target_t" text="自动选择" textColor="#1C1C1E" textSize="13sp"/></card>
                            </horizontal>
                            <checkbox id="war_fleet_3_repair" text="维修加速" textColor="#1C1C1E" textSize="13sp" checked="false"/>
                            <checkbox id="war_fleet_3_march" text="行军加速" textColor="#1C1C1E" textSize="13sp" checked="false"/>
                        </vertical>
                        <checkbox id="war_reward_cb" text="自动领取奖励" textSize="13sp" textColor="#1C1C1E"
                                  checked="true" margin="0 0 0 8"/>
                        <horizontal gravity="center_vertical">
                            <text text="频率" textColor="#8E8E93" textSize="12sp"/>
                            <card id="freq_war_btn" w="auto" h="auto" cardCornerRadius="8dp" cardElevation="0dp"
                                  cardBackgroundColor="#FFFFFF" padding="14 12" margin="12 0 0 0"
                                  foreground="?selectableItemBackground">
                                <text id="freq_war_t" text={panel.freq.war + "s"} textColor="#1C1C1E" textSize="18sp"/>
                            </card>
                        </horizontal>
                    </vertical>
                    </vertical>
                </ScrollView>
                <horizontal padding="14 10 14 6">
                    <card id="btn_run" w="0" layout_weight="1" h="auto" cardCornerRadius="10dp" cardElevation="0dp"
                          cardBackgroundColor={C.accent} margin="0 0 4 0"
                          foreground="?selectableItemBackground">
                        <text id="btn_run_t" text="&#9654; 运行" textColor="#FFFFFF" textSize="13sp"
                              gravity="center" textStyle="bold" padding="11 9"/>
                    </card>
                    <card id="btn_log" w="0" layout_weight="1" h="auto" cardCornerRadius="10dp" cardElevation="0dp"
                          cardBackgroundColor="#F5F5F5" margin="4 0 0 0"
                          foreground="?selectableItemBackground">
                        <text text="日志" textColor="#636366" textSize="13sp"
                              gravity="center" padding="11 9"/>
                    </card>
                </horizontal>
                </vertical>
            </card>
        </frame>
    );
    floatWin.setSize(pw, ph);
    floatWin.setPosition(
        Math.round((dm.widthPixels - pw) / 2),
        Math.max(-statusBarH, Math.round((dm.heightPixels - statusBarH - ph) / 2))
    );

    // 加载作物图标
    var cropIconBitmaps = {};
    for (var ci = 0; ci < cropNames.length; ci++) {
        try {
            var iconImg = images.read("./img/种子图标/" + cropNames[ci] + ".png");
            if (iconImg) cropIconBitmaps[cropNames[ci]] = iconImg.getBitmap();
        } catch(e) {}
    }
    panel._cropIconBitmaps = cropIconBitmaps;
    function updateFoodIcon(name) {
        try {
            if (cropIconBitmaps[name]) floatWin.food_icon.setImageBitmap(cropIconBitmaps[name]);
        } catch(e) {}
    }
    updateFoodIcon(panel.selectedFood);

    // 每次重新展开都从总调度页开始，详情页不会成为难以退出的持久状态。
    panel.showSchedulerSettings();

    // 恢复 radio 选中状态 & 设置颜色
    try { floatWin["exhibition_duration_" + panel.exhibitionDurationHours].setChecked(true); } catch(e) {}

    // 设置 radio 按钮颜色（选中 accent，未选中灰色）
    var accentColor = colors.parseColor("#A04468");
    var grayColor = colors.parseColor("#C7C7CC");
    var csl = new android.content.res.ColorStateList(
        [[android.R.attr.state_checked], []],
        [accentColor, grayColor]
    );
    var radioIds = ["war_fleet_1_rally", "war_fleet_1_attack", "war_fleet_1_defend", "war_fleet_2_rally", "war_fleet_2_attack", "war_fleet_2_defend", "war_fleet_3_rally", "war_fleet_3_attack", "war_fleet_3_defend", "exhibition_duration_4", "exhibition_duration_8", "exhibition_duration_12"];
    for (var si = 0; si < radioIds.length; si++) {
        try { floatWin[radioIds[si]].setButtonTintList(csl); } catch(e) {}
    }

    // checkbox 颜色
    try { floatWin.war_reward_cb.setButtonTintList(csl); } catch(e) {}
    try { floatWin.weapon_friday_only.setButtonTintList(csl); } catch(e) {}
    try { floatWin.resident_demand_thursday_gold_enabled.setButtonTintList(csl); } catch(e) {}
    var warFleetCheckboxIds = ["war_fleet_1_repair", "war_fleet_1_march", "war_fleet_2_repair", "war_fleet_2_march", "war_fleet_3_repair", "war_fleet_3_march"];
    for (var wc = 0; wc < warFleetCheckboxIds.length; wc++) {
        try { floatWin[warFleetCheckboxIds[wc]].setButtonTintList(csl); } catch(e) {}
    }
    var schedulerCbIds = ["scheduler_cb_weapon", "scheduler_cb_food", "scheduler_cb_gather", "scheduler_cb_tradePort", "scheduler_cb_residentDemand", "scheduler_cb_exhibition", "scheduler_cb_intelligence", "scheduler_cb_resourceCollection", "scheduler_cb_ship", "scheduler_cb_war"];
    for (var sc = 0; sc < schedulerCbIds.length; sc++) {
        try { floatWin[schedulerCbIds[sc]].setButtonTintList(csl); } catch(e) {}
    }
    ["resource_collection_hang_up", "resource_collection_experience", "resource_collection_factory"].forEach(function(id) {
        try { floatWin[id].setButtonTintList(csl); } catch(e) {}
    });
    for (var es = 0; es < EXHIBITION_SITE_OPTIONS.length; es++) {
        try { floatWin["exhibition_site_" + EXHIBITION_SITE_OPTIONS[es].key].setButtonTintList(csl); } catch(e) {}
    }

    // 恢复 checkbox 状态（在绑定 click 之前）
    try { floatWin.war_reward_cb.setChecked(panel.warClaimReward); } catch(e) {}
    try { floatWin.weapon_friday_only.setChecked(panel.weaponFridayOnly); } catch(e) {}
    try { floatWin.resident_demand_thursday_gold_enabled.setChecked(panel.residentDemandThursdayGoldEnabled); } catch(e) {}
    ["weapon", "food", "gather", "tradePort", "residentDemand", "exhibition", "intelligence", "resourceCollection", "ship", "war"].forEach(function(key) {
        try { floatWin["scheduler_cb_" + key].setChecked(panel.taskEnabled[key]); } catch(e) {}
    });
    try { floatWin.resource_collection_hang_up.setChecked(panel.resourceCollection.hangUpReward); } catch(e) {}
    try { floatWin.resource_collection_experience.setChecked(panel.resourceCollection.experience); } catch(e) {}
    try { floatWin.resource_collection_factory.setChecked(panel.resourceCollection.factory); } catch(e) {}
    EXHIBITION_SITE_OPTIONS.forEach(function(option) {
        try { floatWin["exhibition_site_" + option.key].setChecked(panel.exhibitionSites.indexOf(option.label) >= 0); } catch(e) {}
    });
    refreshWarFleetSettings();

    // checkbox click 恢复状态（on("check") 在 rawWindow 中不可靠）
    floatWin.war_reward_cb.on("click", function() {
        try { panel.warClaimReward = floatWin.war_reward_cb.isChecked(); panel._saveConfig(); } catch(e) {}
    });
    floatWin.weapon_friday_only.on("click", function() {
        try { panel.weaponFridayOnly = floatWin.weapon_friday_only.isChecked(); panel._saveConfig(); } catch(e) {}
    });
    /**
     * 保存周四金币模式开关。该开关只改变后续居民巡检的奖励类型，运行中的调度快照不得修改。
     */
    function saveResidentDemandThursdayGoldEnabled() {
        if (panel.running) return;
        try { panel.residentDemandThursdayGoldEnabled = floatWin.resident_demand_thursday_gold_enabled.isChecked(); panel._saveConfig(); } catch(e) {}
    }
    floatWin.resident_demand_thursday_gold_enabled.on("click", saveResidentDemandThursdayGoldEnabled);

    /**
     * 同步展区详情页和总调度页的间隔、时长及地点勾选状态，确保持久化配置的展示一致。
     */
    function refreshExhibitionSettings() {
        try { floatWin.freq_exhibition_t.setText(panel.freq.exhibition + " 分钟"); } catch(e) {}
        try { floatWin["exhibition_duration_" + panel.exhibitionDurationHours].setChecked(true); } catch(e) {}
        EXHIBITION_SITE_OPTIONS.forEach(function(option) {
            try { floatWin["exhibition_site_" + option.key].setChecked(panel.exhibitionSites.indexOf(option.label) >= 0); } catch(e) {}
        });
        refreshSchedulerSettings();
    }

    /**
     * 将总调度页的开关与间隔摘要同步到当前悬浮面板实例。
     */
    function refreshSchedulerSettings() {
        ["weapon", "food", "gather", "tradePort", "residentDemand", "exhibition", "intelligence", "resourceCollection", "ship", "war"].forEach(function(key) {
            try { floatWin["scheduler_cb_" + key].setChecked(panel.taskEnabled[key]); } catch(e) {}
            try { floatWin["scheduler_freq_" + key + "_t"].setText(getSchedulerIntervalText(key)); } catch(e) {}
        });
        try { floatWin.resource_collection_hang_up.setChecked(panel.resourceCollection.hangUpReward); } catch(e) {}
        try { floatWin.resource_collection_experience.setChecked(panel.resourceCollection.experience); } catch(e) {}
        try { floatWin.resource_collection_factory.setChecked(panel.resourceCollection.factory); } catch(e) {}
        try { floatWin.freq_hangUpReward_t.setText(panel.freq.hangUpReward + " 小时"); } catch(e) {}
        try { floatWin.freq_resourceExperience_t.setText(panel.freq.resourceExperience + " 分钟"); } catch(e) {}
        try { floatWin.freq_resourceFactory_t.setText(panel.freq.resourceFactory + " 分钟"); } catch(e) {}
        try { floatWin.scheduler_resident_demand_state.setText(panel.getResidentDemandStatusText()); } catch(e) {}
        try { floatWin.resident_demand_status_detail.setText(panel.getResidentDemandStatusText()); } catch(e) {}
        try { floatWin.scheduler_status.setText(panel.schedulerStatus); } catch(e) {}
    }

    ["weapon", "food", "gather", "tradePort", "residentDemand", "exhibition", "intelligence", "resourceCollection", "ship", "war"].forEach(function(key) {
        floatWin["scheduler_cb_" + key].on("click", function() {
            if (panel.running) return;
            panel.taskEnabled[key] = floatWin["scheduler_cb_" + key].isChecked();
            panel._saveConfig();
        });
        floatWin["scheduler_freq_" + key].on("click", function() {
            if (panel.running) return;
            if (key === "tradePort") editTradePortFrequency();
            else if (key === "residentDemand") editResidentDemandFrequency();
            else if (key === "gather") editGatherInterval();
            else if (key === "exhibition") editExhibitionFrequency();
            else if (key === "intelligence") editIntelligenceFrequency();
            else if (key === "resourceCollection") panel.openTaskDetail("resourceCollection");
            else if (key === "ship") editShipPrepareMinutes();
            else editFrequency(key);
        });
    });

    /**
     * 保存资源收集子功能开关。子开关默认全部选中，但只有外层资源收集总开关开启后才会进入调度。
     * @param {string} key 子功能配置键。
     * @param {string} controlId 当前浮窗复选框 ID。
     */
    function bindResourceCollectionToggle(key, controlId) {
        floatWin[controlId].on("click", function() {
            if (panel.running) return;
            panel.resourceCollection[key] = floatWin[controlId].isChecked();
            panel._saveConfig();
        });
    }
    bindResourceCollectionToggle("hangUpReward", "resource_collection_hang_up");
    bindResourceCollectionToggle("experience", "resource_collection_experience");
    bindResourceCollectionToggle("factory", "resource_collection_factory");

    /**
     * 绑定每个调度任务右侧的详情箭头。任务开关和频率卡片仍留在总调度页，
     * 箭头只承担进入该任务参数页的导航职责。
     */
    TASK_DETAIL_PAGES.forEach(function(page) {
        floatWin["scheduler_detail_" + page.key].on("click", function() {
            panel.openTaskDetail(page.key);
        });
    });

    /**
     * 将三支舰队计划回显到当前浮窗实例。集结入口缺失会按进攻、再防守回退；城镇为空仍须显示“自动选择”。
     */
    function refreshWarFleetSettings() {
        for (var i = 0; i < WAR_FLEET_COUNT; i++) {
            var plan = panel.warFleetPlans[i];
            var number = i + 1;
            try { floatWin["war_fleet_" + number + "_" + plan.mode].setChecked(true); } catch(e) {}
            try { floatWin["war_fleet_" + number + "_target_t"].setText(plan.target || "自动选择"); } catch(e) {}
            try { floatWin["war_fleet_" + number + "_repair"].setChecked(plan.repairAccelerate); } catch(e) {}
            try { floatWin["war_fleet_" + number + "_march"].setChecked(plan.marchAccelerate); } catch(e) {}
        }
    }

    /**
     * 保存某支舰队的优先城镇。留空代表让城战模块扫描并选择当前首个可用同类城镇。
     * @param {number} index 从 0 开始的舰队索引。
     */
    function editWarFleetTarget(index) {
        var fleetNumber = index + 1;
        dialogs.rawInput("舰队" + fleetNumber + "优先城镇（如 F6，留空自动选择）", panel.warFleetPlans[index].target, function(value) {
            if (value === null || panel.running) return;
            var target = String(value || "").replace(/\s/g, "").toUpperCase();
            if (target && !/^[A-Z][0-9]+$/.test(target)) {
                toast("请输入如 F6 的城镇坐标，或留空自动选择");
                return;
            }
            panel.warFleetPlans[index].target = target;
            panel._saveConfig();
            refreshWarFleetSettings();
        });
    }

    /**
     * 绑定每支舰队的模式、目标和钻石开关。运行中拒绝写入，保证调度器使用的计划不会中途改变。
     * @param {number} index 从 0 开始的舰队索引。
     */
    function bindWarFleetControls(index) {
        var number = index + 1;
        ["rally", "attack", "defend"].forEach(function(mode) {
            floatWin["war_fleet_" + number + "_" + mode].on("click", function() {
                if (panel.running || panel.warFleetPlans[index].mode === mode) return;
                panel.warFleetPlans[index].mode = mode;
                panel._saveConfig();
                refreshWarFleetSettings();
            });
        });
        floatWin["war_fleet_" + number + "_target_btn"].on("click", function() {
            if (!panel.running) editWarFleetTarget(index);
        });
        floatWin["war_fleet_" + number + "_repair"].on("click", function() {
            if (panel.running) return;
            panel.warFleetPlans[index].repairAccelerate = floatWin["war_fleet_" + number + "_repair"].isChecked();
            panel._saveConfig();
        });
        floatWin["war_fleet_" + number + "_march"].on("click", function() {
            if (panel.running) return;
            panel.warFleetPlans[index].marchAccelerate = floatWin["war_fleet_" + number + "_march"].isChecked();
            panel._saveConfig();
        });
    }
    for (var wf = 0; wf < WAR_FLEET_COUNT; wf++) bindWarFleetControls(wf);

    /**
     * 切换展区寻宝时长。运行期间冻结该选择，避免已进入组队页后面板配置与执行快照不一致。
     * @param {number} hours 用户选择的寻宝时长，单位小时。
     */
    function selectExhibitionDuration(hours) {
        if (panel.running || EXHIBITION_DURATION_HOURS.indexOf(hours) < 0 || panel.exhibitionDurationHours === hours) return;
        panel.exhibitionDurationHours = hours;
        panel._saveConfig();
        refreshExhibitionSettings();
    }
    EXHIBITION_DURATION_HOURS.forEach(function(hours) {
        floatWin["exhibition_duration_" + hours].on("click", function() {
            selectExhibitionDuration(hours);
        });
    });

    /**
     * 重建按固定业务顺序排列的已选寻宝地点，避免用户点击复选框的先后顺序影响派遣优先级。
     */
    function saveExhibitionSites() {
        panel.exhibitionSites = EXHIBITION_SITE_OPTIONS.filter(function(option) {
            try { return floatWin["exhibition_site_" + option.key].isChecked(); } catch(e) { return false; }
        }).map(function(option) {
            return option.label;
        });
        panel._saveConfig();
    }
    EXHIBITION_SITE_OPTIONS.forEach(function(option) {
        floatWin["exhibition_site_" + option.key].on("click", function() {
            if (!panel.running) saveExhibitionSites();
        });
    });

    // 锻造种类选择
    var weaponTypes = [
        { id: "wtype_gun", val: "枪械" },
        { id: "wtype_armor", val: "防具" },
        { id: "wtype_blade", val: "兵刃" }
    ];
    var weaponLevels = [
        { id: "wlevel_blue", val: "蓝级" },
        { id: "wlevel_purple", val: "紫级" },
        { id: "wlevel_orange", val: "橙级" }
    ];
    function updateWeaponHighlight() {
        for (var i = 0; i < weaponTypes.length; i++) {
            try {
                var sel = weaponTypes[i].val === panel.weaponType;
                floatWin[weaponTypes[i].id].setCardBackgroundColor(colors.parseColor(sel ? "#E8D5E0" : "#F5F5F5"));
                floatWin[weaponTypes[i].id + "_t"].setTextColor(colors.parseColor(sel ? "#A04468" : "#8E8E93"));
            } catch(e) {}
        }
        for (var j = 0; j < weaponLevels.length; j++) {
            try {
                var sel2 = weaponLevels[j].val === panel.weaponLevel;
                floatWin[weaponLevels[j].id].setCardBackgroundColor(colors.parseColor(sel2 ? "#E8D5E0" : "#F5F5F5"));
                floatWin[weaponLevels[j].id + "_t"].setTextColor(colors.parseColor(sel2 ? "#A04468" : "#8E8E93"));
            } catch(e) {}
        }
    }
    updateWeaponHighlight();
    for (var wi = 0; wi < weaponTypes.length; wi++) {
        (function(item) {
            floatWin[item.id].on("click", function() {
                if (panel.running) return;
                if (panel.weaponType !== item.val) {
                    panel.weaponType = item.val;
                    panel._saveConfig();
                    updateWeaponHighlight();
                }
            });
        })(weaponTypes[wi]);
    }
    for (var wj = 0; wj < weaponLevels.length; wj++) {
        (function(item) {
            floatWin[item.id].on("click", function() {
                if (panel.running) return;
                if (panel.weaponLevel !== item.val) {
                    panel.weaponLevel = item.val;
                    panel._saveConfig();
                    updateWeaponHighlight();
                }
            });
        })(weaponLevels[wj]);
    }

    // 运行中只保留只读查看，防止调度器持有的配置快照与页面显示不一致。
    if (panel.running) {
        var modeRadios = ["war_fleet_1_rally", "war_fleet_1_attack", "war_fleet_1_defend", "war_fleet_2_rally", "war_fleet_2_attack", "war_fleet_2_defend", "war_fleet_3_rally", "war_fleet_3_attack", "war_fleet_3_defend", "exhibition_duration_4", "exhibition_duration_8", "exhibition_duration_12"];
        for (var ri = 0; ri < modeRadios.length; ri++) {
            try { floatWin[modeRadios[ri]].setEnabled(false); } catch(e) {}
        }
    }

    // 作物选择（弹窗单选）
    floatWin.food_selector.on("click", function() {
        dialogs.select("选择作物", cropNames, function(idx) {
            if (idx >= 0) {
                panel.selectedFood = cropNames[idx];
                panel._saveConfig();
                ctx.onFoodChange(cropNames[idx]);
                try { floatWin.food_label.setText(cropNames[idx]); } catch(e) {}
                updateFoodIcon(cropNames[idx]);
            }
        });
    });

    /**
     * 编辑任务完成后的等待时间；总调度页与任务详情页共用同一份持久化配置。
     */
    function editFrequency(key) {
        var current = panel.freq[key];
        dialogs.rawInput("完成后间隔（秒）", current + "", function(val) {
            if (!val) return;
            var num = parseInt(val.replace(/[^0-9]/g, ""));
            if (num > 0 && num < 3600) {
                panel.freq[key] = num;
                panel._saveConfig();
                try { floatWin["freq_" + key + "_t"].setText(num + "s"); } catch(e) {}
                refreshSchedulerSettings();
            }
        });
    }
    ["food", "weapon", "war"].forEach(function(key) {
        floatWin["freq_" + key + "_btn"].on("click", function() {
            if (!panel.running) editFrequency(key);
        });
    });

    /**
     * 刷新商船准备、夺回重试时间及总调度摘要，确保保存后的分钟值同步展示。
     */
    function refreshShipTiming() {
        try { floatWin.ship_prepare_minutes_t.setText(panel.shipPrepareMinutes + " 分钟"); } catch(e) {}
        try { floatWin.ship_retry_minutes_t.setText(panel.shipRetryMinutes + " 分钟"); } catch(e) {}
        refreshSchedulerSettings();
    }

    /**
     * 编辑商船进入活动弹窗的提前时间。只接受正整数分钟，避免小数或文本导致整点边界计算不确定。
     */
    function editShipPrepareMinutes() {
        dialogs.rawInput("提前进入时间（分钟）", panel.shipPrepareMinutes + "", function(val) {
            if (val === null || panel.running) return;
            var text = String(val).trim();
            if (!/^[1-9][0-9]*$/.test(text)) {
                toast("请输入正整数分钟");
                return;
            }
            panel.shipPrepareMinutes = Number(text);
            panel._saveConfig();
            refreshShipTiming();
        });
    }
    floatWin.ship_prepare_minutes_btn.on("click", function() {
        if (!panel.running) editShipPrepareMinutes();
    });

    /**
     * 编辑货轮仍在列表时的夺回重试间隔。只接受正整数分钟，避免无效值让限时任务持续触发。
     */
    function editShipRetryMinutes() {
        dialogs.rawInput("夺回重试间隔（分钟）", panel.shipRetryMinutes + "", function(val) {
            if (val === null || panel.running) return;
            var text = String(val).trim();
            if (!/^[1-9][0-9]*$/.test(text)) {
                toast("请输入正整数分钟");
                return;
            }
            panel.shipRetryMinutes = Number(text);
            panel._saveConfig();
            refreshShipTiming();
        });
    }
    floatWin.ship_retry_minutes_btn.on("click", function() {
        if (!panel.running) editShipRetryMinutes();
    });

    /**
     * 编辑贸易港口任务的完成后间隔。该任务的单位为分钟，不能复用其他任务的秒级输入框。
     */
    function editTradePortFrequency() {
        dialogs.rawInput("完成后间隔（分钟）", panel.freq.tradePort + "", function(val) {
            if (!val) return;
            var minutes = parseInt(val.replace(/[^0-9]/g, ""));
            if (minutes > 0) {
                panel.freq.tradePort = minutes;
                panel._saveConfig();
                try { floatWin.freq_tradePort_t.setText(minutes + " 分钟"); } catch(e) {}
                refreshSchedulerSettings();
            }
        });
    }
    floatWin.freq_tradePort_btn.on("click", function() {
        if (!panel.running) editTradePortFrequency();
    });

    /**
     * 编辑居民需求的安全巡检间隔。该值以分钟保存，冷却起点由模块确认返回基地后写入的巡检时间决定。
     */
    function editResidentDemandFrequency() {
        dialogs.rawInput("巡检间隔（分钟）", panel.freq.residentDemand + "", function(val) {
            if (val === null || panel.running) return;
            var text = String(val).trim();
            if (!/^[1-9][0-9]*$/.test(text)) {
                toast("请输入正整数分钟");
                return;
            }
            panel.freq.residentDemand = Number(text);
            panel._saveConfig();
            try { floatWin.freq_residentDemand_t.setText(panel.freq.residentDemand + " 分钟"); } catch(e) {}
            refreshSchedulerSettings();
        });
    }
    floatWin.freq_residentDemand_btn.on("click", function() {
        if (!panel.running) editResidentDemandFrequency();
    });

    /**
     * 编辑居民需求默认使用的经验阈值。奖励必须严格大于该值才会提交，等于该值仍刷新。
     */
    function editResidentDemandExperienceThreshold() {
        dialogs.rawInput("经验阈值（正整数）", panel.residentDemandExperienceThreshold + "", function(val) {
            if (val === null || panel.running) return;
            var text = String(val).trim();
            if (!/^[1-9][0-9]*$/.test(text)) {
                toast("请输入正整数经验阈值");
                return;
            }
            panel.residentDemandExperienceThreshold = Number(text);
            panel._saveConfig();
            try { floatWin.resident_demand_experience_threshold_t.setText(panel.residentDemandExperienceThreshold + ""); } catch(e) {}
        });
    }
    floatWin.resident_demand_experience_threshold_btn.on("click", function() {
        if (!panel.running) editResidentDemandExperienceThreshold();
    });

    /**
     * 编辑周四金币模式的金币阈值。该值始终可预设，但仅在开关开启的设备本地周四生效。
     */
    function editResidentDemandGoldThreshold() {
        dialogs.rawInput("金币阈值（正整数）", panel.residentDemandGoldThreshold + "", function(val) {
            if (val === null || panel.running) return;
            var text = String(val).trim();
            if (!/^[1-9][0-9]*$/.test(text)) {
                toast("请输入正整数金币阈值");
                return;
            }
            panel.residentDemandGoldThreshold = Number(text);
            panel._saveConfig();
            try { floatWin.resident_demand_gold_threshold_t.setText(panel.residentDemandGoldThreshold + ""); } catch(e) {}
        });
    }
    floatWin.resident_demand_gold_threshold_btn.on("click", function() {
        if (!panel.running) editResidentDemandGoldThreshold();
    });

    /**
     * 编辑展区任务的完成后间隔。该值以分钟保存，且由安全回到主界面后的持久化时间戳共同决定冷却。
     */
    function editExhibitionFrequency() {
        dialogs.rawInput("完成后间隔（分钟）", panel.freq.exhibition + "", function(val) {
            if (val === null) return;
            var minutes = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
            if (minutes > 0) {
                panel.freq.exhibition = minutes;
                panel._saveConfig();
                refreshExhibitionSettings();
            }
        });
    }
    floatWin.freq_exhibition_btn.on("click", function() {
        if (!panel.running) editExhibitionFrequency();
    });

    /**
     * 编辑情报任务的完成后间隔。该值按小时持久化，且只从安全回到基地后的完成时间开始计时。
     */
    function editIntelligenceFrequency() {
        dialogs.rawInput("完成后间隔（小时）", panel.freq.intelligence + "", function(val) {
            if (val === null) return;
            var hours = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
            if (hours > 0) {
                panel.freq.intelligence = hours;
                panel._saveConfig();
                try { floatWin.freq_intelligence_t.setText(hours + " 小时"); } catch(e) {}
                refreshSchedulerSettings();
            }
        });
    }
    floatWin.freq_intelligence_btn.on("click", function() {
        if (!panel.running) editIntelligenceFrequency();
    });

    /**
     * 编辑挂机奖励任务的完成后间隔。该值按小时保存，完成时间只由当前总调度会话持有。
     */
    function editHangUpRewardFrequency() {
        dialogs.rawInput("完成后间隔（小时）", panel.freq.hangUpReward + "", function(val) {
            if (val === null) return;
            var text = String(val).trim();
            // 不能把小数、负号或夹杂文字的输入拼接为其他小时数，避免用户设置与实际冷却不一致。
            if (!/^[1-9][0-9]*$/.test(text)) {
                toast("请输入正整数小时");
                return;
            }
            var hours = Number(text);
            if (!isFinite(hours)) {
                toast("请输入正整数小时");
                return;
            }
            panel.freq.hangUpReward = hours;
            panel._saveConfig();
            try { floatWin.freq_hangUpReward_t.setText(hours + " 小时"); } catch(e) {}
            refreshSchedulerSettings();
        });
    }
    floatWin.freq_hangUpReward_btn.on("click", function() {
        if (!panel.running) editHangUpRewardFrequency();
    });

    /**
     * 编辑资源收集子功能的分钟间隔。与挂机奖励分开校验，防止小时级配置被误写为分钟。
     * @param {string} key 频率配置键。
     * @param {string} label 输入框业务名称。
     */
    function editResourceCollectionFrequency(key, label) {
        dialogs.rawInput(label + "间隔时间（分钟）", panel.freq[key] + "", function(val) {
            if (val === null || panel.running) return;
            var text = String(val).trim();
            if (!/^[1-9][0-9]*$/.test(text)) {
                toast("请输入正整数分钟");
                return;
            }
            panel.freq[key] = Number(text);
            panel._saveConfig();
            refreshSchedulerSettings();
        });
    }
    floatWin.freq_resourceExperience_btn.on("click", function() {
        if (!panel.running) editResourceCollectionFrequency("resourceExperience", "收集资源");
    });
    floatWin.freq_resourceFactory_btn.on("click", function() {
        if (!panel.running) editResourceCollectionFrequency("resourceFactory", "工厂生产收集");
    });

    /**
     * 返回总调度页显示的间隔摘要；资源收集为任务组，因此只显示固定的三项功能数量。
     * @param {string} key 任务键。
     * @returns {string} 可展示的间隔文本。
     */
    function getSchedulerIntervalText(key) {
        if (key === "ship") return "备" + panel.shipPrepareMinutes + " / 重" + panel.shipRetryMinutes + "分";
        if (key === "tradePort") return panel.freq.tradePort + "分";
        if (key === "residentDemand") return panel.freq.residentDemand + "分";
        if (key === "gather") return panel.gatherIntervalMinutes + "分";
        if (key === "exhibition") return panel.freq.exhibition + "分";
        if (key === "intelligence") return panel.freq.intelligence + "小时";
        if (key === "resourceCollection") return "3 项";
        return panel.freq[key] + "s";
    }

    /**
     * 同步打捞资源详情页的三个配置值，避免总调度摘要和详情页显示不一致。
     */
    function refreshGatherSettings() {
        try { floatWin.gather_interval_t.setText(panel.gatherIntervalMinutes + " 分钟"); } catch(e) {}
        try { floatWin.gather_threshold_t.setText(panel.gatherThresholdPercent + "%"); } catch(e) {}
        try { floatWin.gather_duration_t.setText(panel.gatherDurationMinutes === null ? "不限时" : panel.gatherDurationMinutes + " 分钟"); } catch(e) {}
        refreshSchedulerSettings();
    }

    /**
     * 编辑打捞资源任务的完成后间隔；该间隔只约束资源任务自身的本次调度会话。
     */
    function editGatherInterval() {
        dialogs.rawInput("完成后间隔（分钟）", panel.gatherIntervalMinutes + "", function(val) {
            if (val === null) return;
            var minutes = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
            if (minutes > 0) {
                panel.gatherIntervalMinutes = minutes;
                panel._saveConfig();
                refreshGatherSettings();
            }
        });
    }

    /**
     * 编辑库存百分比阈值。只有严格低于该值的资源才会进入对应采集类别。
     */
    function editGatherThreshold() {
        dialogs.rawInput("打捞阈值（1-100%）", panel.gatherThresholdPercent + "", function(val) {
            if (val === null) return;
            var threshold = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
            if (threshold >= 1 && threshold <= 100) {
                panel.gatherThresholdPercent = threshold;
                panel._saveConfig();
                refreshGatherSettings();
            }
        });
    }

    /**
     * 编辑每个采集类别的固定时长；留空表示不限时，仅钓鱼可使用该模式。
     */
    function editGatherDuration() {
        var current = panel.gatherDurationMinutes === null ? "" : panel.gatherDurationMinutes + "";
        dialogs.rawInput("打捞时间（分钟，留空不限时）", current, function(val) {
            if (val === null) return;
            var text = String(val).replace(/\s/g, "");
            if (!text) {
                panel.gatherDurationMinutes = null;
                panel._saveConfig();
                refreshGatherSettings();
                return;
            }
            var minutes = parseInt(text.replace(/[^0-9]/g, ""), 10);
            if (minutes > 0) {
                panel.gatherDurationMinutes = minutes;
                panel._saveConfig();
                refreshGatherSettings();
            }
        });
    }

    floatWin.gather_interval_btn.on("click", function() {
        if (!panel.running) editGatherInterval();
    });
    floatWin.gather_threshold_btn.on("click", function() {
        if (!panel.running) editGatherThreshold();
    });
    floatWin.gather_duration_btn.on("click", function() {
        if (!panel.running) editGatherDuration();
    });

    floatWin.btn_close.on("click", function() { panel.showBall(ctx); });
    /**
     * 处理固定底部主操作。总调度页用于运行或停止，任务详情页只负责返回，
     * 防止用户在编辑参数时误触发调度器。
     */
    floatWin.btn_run.on("click", function() {
        if (panel.activeTaskDetail !== null) {
            // 详情页的主按钮固定返回总调度，不改变调度器运行状态。
            panel.showSchedulerSettings();
            return;
        }
        if (panel.running) {
            ctx.onStop();
        } else {
            var started = ctx.onRun();
            if (started) {
                // 只在启动已被入口接受后退回悬浮球；校验失败时保留面板，便于调整任务和权限。
                panel.showBall(ctx);
            }
        }
    });
    floatWin.btn_log.on("click", function() {
        console.show();
        panel.showBall(ctx);
    });
    // 面板改为固定高度后，拖动边界必须按完整高度计算，避免底部操作区滑出屏幕。
    var maxPanelY = Math.max(-statusBarH, dm.heightPixels - statusBarH - ph);
    var tx, ty, wx, wy;
    floatWin.panel_root.setOnTouchListener(function(v, e) {
        switch(e.getAction()) {
            case 0: tx = e.getRawX(); ty = e.getRawY(); wx = floatWin.getX(); wy = floatWin.getY(); break;
            case 2:
                var nx = Math.max(0, Math.min(dm.widthPixels - pw, wx + (e.getRawX()-tx)));
                var ny = Math.max(-statusBarH, Math.min(maxPanelY, wy + (e.getRawY()-ty)));
                floatWin.setPosition(nx, ny);
                break;
        }
        return false;
    });
    if (panel.running) {
        panel.setRunningUI(true, C);
    }
    refreshSchedulerSettings();
};

/**
 * 进入指定任务的详情配置页。运行中锁定配置，避免调度快照与界面参数不一致。
 * @param {string} taskKey 任务键。
 * @returns {boolean} 是否已成功切换到任务详情页。
 */
panel.openTaskDetail = function(taskKey) {
    if (!floatWin || panel.running || !getTaskDetailPage(taskKey)) return false;
    panel.activeTaskDetail = taskKey;
    updateTaskSettingsVisibility();
    // 每次进入详情都从顶部开始，确保先展示任务名称和首项设置。
    try { floatWin.task_settings_scroll.scrollTo(0, 0); } catch(e) {}
    refreshPrimaryAction();
    return true;
};

/**
 * 回到总调度页，并恢复底部主按钮的运行或停止语义。
 */
panel.showSchedulerSettings = function() {
    panel.activeTaskDetail = null;
    updateTaskSettingsVisibility();
    try { if (floatWin) floatWin.task_settings_scroll.scrollTo(0, 0); } catch(e) {}
    refreshPrimaryAction();
};

/**
 * 将控制面板切换为运行或配置状态，运行期间冻结配置以保持调度快照稳定。
 */
panel.setRunningUI = function(running, C) {
    panel.running = running;
    if (C) panelColors = C;
    if (!floatWin) return;
    $ui.run(function() {
        try {
            refreshPrimaryAction();
            floatWin.title_dot.setBackgroundColor(colors.parseColor(running ? panelColors.green : "#C7C7CC"));
            // 禁用/启用模式 radio
            var radioIds = ["war_fleet_1_rally", "war_fleet_1_attack", "war_fleet_1_defend", "war_fleet_2_rally", "war_fleet_2_attack", "war_fleet_2_defend", "war_fleet_3_rally", "war_fleet_3_attack", "war_fleet_3_defend", "exhibition_duration_4", "exhibition_duration_8", "exhibition_duration_12"];
            for (var r = 0; r < radioIds.length; r++) {
                try { floatWin[radioIds[r]].setEnabled(!running); } catch(e) {}
            }
            var clickIds = ["food_selector", "freq_food_btn", "freq_weapon_btn", "freq_tradePort_btn", "freq_residentDemand_btn", "resident_demand_experience_threshold_btn", "resident_demand_thursday_gold_enabled", "resident_demand_gold_threshold_btn", "freq_exhibition_btn", "freq_intelligence_btn", "freq_hangUpReward_btn", "freq_resourceExperience_btn", "freq_resourceFactory_btn", "resource_collection_hang_up", "resource_collection_experience", "resource_collection_factory", "gather_interval_btn", "gather_threshold_btn", "gather_duration_btn", "ship_prepare_minutes_btn", "ship_retry_minutes_btn", "freq_war_btn", "war_reward_cb", "war_fleet_1_target_btn", "war_fleet_1_repair", "war_fleet_1_march", "war_fleet_2_target_btn", "war_fleet_2_repair", "war_fleet_2_march", "war_fleet_3_target_btn", "war_fleet_3_repair", "war_fleet_3_march", "weapon_friday_only", "scheduler_cb_weapon", "scheduler_cb_tradePort", "scheduler_cb_residentDemand", "scheduler_cb_exhibition", "scheduler_cb_intelligence", "scheduler_cb_resourceCollection", "scheduler_cb_gather", "scheduler_cb_food", "scheduler_cb_ship", "scheduler_cb_war", "scheduler_freq_weapon", "scheduler_freq_tradePort", "scheduler_freq_residentDemand", "scheduler_freq_exhibition", "scheduler_freq_intelligence", "scheduler_freq_resourceCollection", "scheduler_freq_gather", "scheduler_freq_food", "scheduler_freq_ship", "scheduler_freq_war", "wtype_gun", "wtype_armor", "wtype_blade", "wlevel_blue", "wlevel_purple", "wlevel_orange"];
            // 详情箭头与配置字段同属运行快照，运行期间必须禁止进入详情页。
            TASK_DETAIL_PAGES.forEach(function(page) {
                clickIds.push("scheduler_detail_" + page.key);
            });
            // 展区复选框与时长一样属于调度快照，运行中只读，避免中途改变后续地点顺序。
            for (var es = 0; es < EXHIBITION_SITE_OPTIONS.length; es++) {
                try { floatWin["exhibition_site_" + EXHIBITION_SITE_OPTIONS[es].key].setClickable(!running); } catch(e) {}
            }
            for (var j = 0; j < clickIds.length; j++) {
                try { floatWin[clickIds[j]].setClickable(!running); } catch(e) {}
            }
        } catch(e) {}
    });
};

panel.getCountText = function() { return null; };

/**
 * 返回当前已开启的任务键，用于启动前校验。
 */
panel.getEnabledTasks = function() {
    return ["weapon", "food", "gather", "tradePort", "residentDemand", "exhibition", "intelligence", "resourceCollection", "ship", "war"].filter(function(key) { return panel.taskEnabled[key]; });
};

/**
 * 更新总调度页的运行说明；悬浮球折叠时也会保留到下次展开。
 */
panel.setSchedulerStatus = function(status) {
    panel.schedulerStatus = status;
    $ui.run(function() {
        try { if (floatWin && floatWin.scheduler_status) floatWin.scheduler_status.setText(status); } catch(e) {}
    });
};

/**
 * 将自动切换后的作物名同步到总配置和当前任务页。
 */
panel.updateFoodLabel = function(food) {
    $ui.run(function() {
        try {
            if (floatWin && floatWin.food_label) floatWin.food_label.setText(food);
            var cropIconBitmaps = panel._cropIconBitmaps;
            if (cropIconBitmaps && cropIconBitmaps[food] && floatWin.food_icon) {
                floatWin.food_icon.setImageBitmap(cropIconBitmaps[food]);
            }
        } catch(e) {}
    });
};

module.exports = panel;
