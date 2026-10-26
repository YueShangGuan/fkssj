// @ts-nocheck
"ui";

var theme = require("./modules/theme.js");
var gameHelper = require("./modules/gameHelper.js");
var uiHelpers = require("./modules/uiHelpers.js");
var floatingPanel = require("./modules/floatingPanel.js");
var scheduler = require("./modules/scheduler.js");
var navigate = require("./modules/navigate.js");

var C = theme.C;
var foodOptions = theme.foodOptions;

var loadedImages = null;
var schedulerRunning = false;
// 每次启动分配独立会话号；停止后立即重启时，旧线程必须自行退出，不能因全局运行标记重新变为 true 而复活。
var schedulerSessionId = 0;
var selectedFood = foodOptions[0];
var harvestStats = floatingPanel.stats;
// 悬浮球由异步 Canvas 绘制；保留 Image 源对象的生命周期，避免其 Bitmap 在首次绘制前被 AutoJs 回收。
var icoImage = images.read("./ico.png");
var icoBitmap = icoImage.getBitmap();

function dp(v) { return Math.round(v * context.getResources().getDisplayMetrics().density); }

// ── Layout ──
$ui.layout(
    <frame layout_width="match_parent" layout_height="match_parent" bg={C.bg}>
        <vertical layout_width="match_parent" layout_height="match_parent" bg={C.bg}>

            <frame layout_width="match_parent" layout_height="0dp" layout_weight="1">

                {/* ── Home ── */}
                <vertical id="page_home" layout_width="match_parent" layout_height="match_parent">
                    <ScrollView layout_width="match_parent" layout_height="match_parent" bg={C.bg}>
                        <vertical layout_width="match_parent" padding="0 0 0 12">

                            <horizontal bg={C.bg} padding="16 20 16 16" gravity="center_vertical">
                                <frame w="48" h="48" margin="0 0 12 0">
                                    <ImageView id="ico_view" scaleType="centerCrop" layout_width="match_parent" layout_height="match_parent"/>
                                </frame>
                                <vertical layout_weight="1">
                                    <text text="疯狂水世界" textColor={C.textPrimary} textSize="21sp" textStyle="bold"/>
                                    <text text="辅助工具 v1.0" textColor={C.textMuted} textSize="13sp" margin="0 2 0 0"/>
                                </vertical>
                                <card id="btn_about" cardCornerRadius="22dp" cardElevation="0dp"
                                      cardBackgroundColor={C.card} foreground="?selectableItemBackground" w="44" h="44" margin="0 0 8 0">
                                    <text text="&#9432;" textColor={C.textMuted} textSize="22sp" gravity="center"/>
                                </card>
                                <card id="btn_launch" cardCornerRadius="22dp" cardElevation="1dp"
                                      cardBackgroundColor="#C7C7CC" foreground="?selectableItemBackground" w="44" h="44">
                                    <text id="btn_launch_icon" text="&#9654;" textColor="#FFFFFF" textSize="18sp" gravity="center"/>
                                </card>
                            </horizontal>

                            <text text="累计统计" textColor={C.textMuted} textSize="13sp" textStyle="bold" padding="20 12 10 16"/>

                            <horizontal w="*" padding="16 0 16 0">
                                <card w="0" layout_weight="1" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="0 0 4 4">
                                    <vertical gravity="center" padding="8 10">
                                        <text text="&#127793;" textSize="22sp" gravity="center" margin="0 0 0 4"/>
                                        <text id="stat_food" text="0" textColor={C.accent} textSize="22sp" textStyle="bold" gravity="center"/>
                                        <text text="种植" textColor={C.textMuted} textSize="12sp" gravity="center" margin="0 1 0 0"/>
                                    </vertical>
                                </card>
                                <card w="0" layout_weight="1" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="4 0 4 4">
                                    <vertical gravity="center" padding="8 10">
                                        <text text="&#9876;" textSize="22sp" gravity="center" margin="0 0 0 4"/>
                                        <text id="stat_weapon" text="0" textColor={C.accent} textSize="22sp" textStyle="bold" gravity="center"/>
                                        <text text="锻造" textColor={C.textMuted} textSize="12sp" gravity="center" margin="0 1 0 0"/>
                                    </vertical>
                                </card>
                                <card w="0" layout_weight="1" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="4 0 4 4">
                                    <vertical gravity="center" padding="8 10">
                                        <text text="&#9973;" textSize="22sp" gravity="center" margin="0 0 0 4"/>
                                        <text id="stat_ship" text="0" textColor={C.accent} textSize="22sp" textStyle="bold" gravity="center"/>
                                        <text text="商船" textColor={C.textMuted} textSize="12sp" gravity="center" margin="0 1 0 0"/>
                                    </vertical>
                                </card>
                                <card w="0" layout_weight="1" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="4 0 0 4">
                                    <vertical gravity="center" padding="8 10">
                                        <text text="&#128293;" textSize="22sp" gravity="center" margin="0 0 0 4"/>
                                        <text id="stat_war" text="0" textColor={C.accent} textSize="22sp" textStyle="bold" gravity="center"/>
                                        <text text="盟战" textColor={C.textMuted} textSize="12sp" gravity="center" margin="0 1 0 0"/>
                                    </vertical>
                                </card>
                            </horizontal>

                            <text text="任务状态" textColor={C.textMuted} textSize="13sp" textStyle="bold" padding="20 12 10 16"/>
                            <card w="*" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="16 0 16 0">
                                <horizontal gravity="center_vertical" padding="12 10">
                                    <text text="居民需求" textColor={C.textSecondary} textSize="13sp" layout_weight="1"/>
                                    <text id="home_resident_demand_status" text={floatingPanel.getResidentDemandStatusText()} textColor={C.green} textSize="13sp" textStyle="bold"/>
                                </horizontal>
                            </card>

                            {/* Device info */}
                            <text text="设备信息" textColor={C.textMuted} textSize="13sp" textStyle="bold" padding="20 14 10 12"/>
                            <card w="*" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="16 0 16 0">
                                <vertical padding="12 10">
                                    <horizontal gravity="center_vertical" margin="0 0 0 6">
                                        <text text="品牌型号" textColor={C.textSecondary} textSize="13sp" w="70"/>
                                        <text id="txt_device_model" text="--" textColor={C.textPrimary} textSize="13sp" textStyle="bold"/>
                                    </horizontal>
                                    <horizontal gravity="center_vertical" margin="0 0 0 6">
                                        <text text="Android" textColor={C.textSecondary} textSize="13sp" w="70"/>
                                        <text id="txt_device_android" text="--" textColor={C.textPrimary} textSize="13sp" textStyle="bold"/>
                                        <text id="txt_android_status" text="" textColor={C.textMuted} textSize="12sp" margin="8 0 0 0"/>
                                    </horizontal>
                                    <horizontal gravity="center_vertical" margin="0 0 0 6">
                                        <text text="分辨率" textColor={C.textSecondary} textSize="13sp" w="70"/>
                                        <text id="txt_resolution" text="--" textColor={C.textPrimary} textSize="13sp" textStyle="bold"/>
                                        <text id="txt_resolution_status" text="" textColor={C.textMuted} textSize="12sp" margin="8 0 0 0"/>
                                    </horizontal>
                                    <horizontal gravity="center_vertical">
                                        <text text="电量" textColor={C.textSecondary} textSize="13sp" w="70"/>
                                        <text id="txt_device_battery" text="--" textColor={C.textPrimary} textSize="13sp" textStyle="bold"/>
                                    </horizontal>
                                </vertical>
                            </card>

                            {/* Permissions */}
                            <text text="权限状态" textColor={C.textMuted} textSize="13sp" textStyle="bold" padding="20 14 10 12"/>
                            <card w="*" cardCornerRadius="10dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="16 0 16 0">
                                <vertical padding="12 10">
                                    <horizontal id="perm_pkg_list_row" gravity="center_vertical" margin="0 0 0 8" clickable="true" foreground="?selectableItemBackground">
                                        <text text="应用列表" textColor={C.textSecondary} textSize="13sp" layout_weight="1"/>
                                        <text id="perm_pkg_list_label" text="未开启" textColor={C.error} textSize="12sp" margin="0 0 8 0"/>
                                        <Switch id="perm_pkg_list" checked="false" clickable="false" focusable="false" w="auto" h="auto"/>
                                    </horizontal>
                                    <horizontal id="perm_access_row" gravity="center_vertical" margin="0 0 0 8" clickable="true" foreground="?selectableItemBackground">
                                        <text text="无障碍" textColor={C.textSecondary} textSize="13sp" layout_weight="1"/>
                                        <text id="perm_access_label" text="未开启" textColor={C.error} textSize="12sp" margin="0 0 8 0"/>
                                        <Switch id="perm_access" checked="false" clickable="false" focusable="false" w="auto" h="auto"/>
                                    </horizontal>
                                    <horizontal id="perm_overlay_row" gravity="center_vertical" clickable="true" foreground="?selectableItemBackground">
                                        <text text="悬浮窗" textColor={C.textSecondary} textSize="13sp" layout_weight="1"/>
                                        <text id="perm_overlay_label" text="未开启" textColor={C.error} textSize="12sp" margin="0 0 8 0"/>
                                        <Switch id="perm_overlay" checked="false" clickable="false" focusable="false" w="auto" h="auto"/>
                                    </horizontal>
                                </vertical>
                            </card>

                            {/* Log */}
                            <text text="运行日志" textColor={C.textMuted} textSize="13sp" textStyle="bold" padding="20 14 10 16"/>
                            <card w="*" cardCornerRadius="12dp" cardElevation="0dp" cardBackgroundColor={C.card} margin="16 0 16 0">
                                <ScrollView id="log_scroll" h="160" padding="12 10">
                                    <text id="txt_log" text="等待操作..." textColor={C.textSecondary} textSize="13sp" typeface="monospace" lineSpacingExtra="-4dp"/>
                                </ScrollView>
                            </card>

                            <View h="20" bg={C.bg}/>
                        </vertical>
                    </ScrollView>
                </vertical>

            </frame>

        </vertical>
    </frame>
);

// ── About dialog ──
$ui.btn_about.on("click", function() {
    var aboutXml = '<vertical padding="20 16" bg="' + C.bg + '">' +
        '<text text="疯狂水世界" textColor="' + C.textPrimary + '" textSize="20sp" textStyle="bold" gravity="center"/>' +
        '<text text="辅助工具 v1.0" textColor="' + C.textSecondary + '" textSize="13sp" gravity="center" margin="0 2 0 16"/>' +
        '<card w="*" cardCornerRadius="12dp" cardElevation="0dp" cardBackgroundColor="' + C.card + '">' +
        '<vertical padding="16 14">' +
        '<text text="功能介绍" textColor="' + C.textPrimary + '" textSize="14sp" textStyle="bold" margin="0 0 10 0"/>' +
        '<text text="&#127793; 自动种植、收割作物" textColor="' + C.textSecondary + '" textSize="13sp" margin="0 0 6 0"/>' +
        '<text text="&#9876; 自动锻造武器" textColor="' + C.textSecondary + '" textSize="13sp" margin="0 0 6 0"/>' +
        '<text text="&#128293; 自动参与盟战" textColor="' + C.textSecondary + '" textSize="13sp" margin="0 0 6 0"/>' +
        '<text text="&#9973; 自动搁浅商船出征" textColor="' + C.textSecondary + '" textSize="13sp" margin="0 0 6 0"/>' +
        '<text text="&#9733; 悬浮球控制面板" textColor="' + C.textSecondary + '" textSize="13sp"/>' +
        '</vertical></card>' +
        '<text text="&#128279; github.com/ssssshql/fkssj" textColor="' + C.accent + '" textSize="12sp" gravity="center" margin="0 14 0 8"/>' +
        '<text text="本工具仅供学习交流使用" textColor="' + C.textMuted + '" textSize="11sp" gravity="center"/>' +
        '</vertical>';
    dialogs.build({
        customView: $ui.inflate(aboutXml),
        positive: "关闭",
        cancelable: true
    }).show();
});
$ui.btn_about_github = null; // placeholder

// ── Circle icon ──
uiHelpers.initCircleIcon($ui.ico_view, icoBitmap);
try { $ui.ico_view.setImageBitmap(icoBitmap); } catch(e) {}

// ── Status bar ──
$ui.statusBarColor(C.bg);
$ui.navigationBarColor && $ui.navigationBarColor("#FFFFFF");
try {
    var decor = context.getWindow().getDecorView();
    decor.setSystemUiVisibility(decor.getSystemUiVisibility() | 0x00002000 | 0x00000010);
    decor.setBackgroundColor(colors.parseColor(C.bg));
} catch(e) {}

// ── Init panel state（从持久化配置恢复）──
if (floatingPanel.selectedFood) selectedFood = floatingPanel.selectedFood;
else floatingPanel.selectedFood = selectedFood;

// ── Floating panel context ──
var panelCtx = {
    C: C, dp: dp, icoBitmap: icoBitmap, foodOptions: foodOptions,
    appendLog: function(msg) { uiHelpers.appendLog(msg); },
    onFoodChange: function(food) { selectedFood = food; floatingPanel.selectedFood = food; },
    // 仅在总调度器确实启动后折叠控制面板，校验失败时需保留当前配置供用户修正。
    onRun: function() { return startScheduler(); },
    onStop: function() { stopScheduler(); }
};

/**
 * 将本地持久化的居民需求每日状态同步到脚本主页与当前悬浮面板。
 * 任务结果可从调度线程回调，因此所有主页控件更新必须回到 UI 线程。
 */
function refreshResidentDemandHomeStatus() {
    var status = floatingPanel.getResidentDemandStatusText();
    $ui.run(function() {
        try { $ui.home_resident_demand_status.setText(status); } catch(e) {}
    });
    floatingPanel.refreshResidentDemandStatus();
}

/**
 * 依据当前设备本地日期刷新居民需求状态。
 * 完成日期保留在本地配置中作审计，跨零点只重算展示，不能把“昨日已完成”继续显示为今天完成。
 */
function refreshResidentDemandDateStatus() {
    refreshResidentDemandHomeStatus();
}

// ── Init stats display & resolution ──
uiHelpers.initStats(harvestStats);
refreshResidentDemandDateStatus();
try {
    var res = gameHelper.getRealResolution();
    var rw = res[0], rh = res[1];
    $ui.txt_resolution.setText(rw + " × " + rh);
    var supported = (rw === 1080 && rh === 2400);
    $ui.txt_resolution.setTextColor(colors.parseColor(supported ? C.textPrimary : C.error));
    $ui.txt_resolution_status.setText(supported ? "已适配" : "未适配");
    $ui.txt_resolution_status.setTextColor(colors.parseColor(supported ? C.green : C.error));
} catch(e) {
    // 初始化阶段也需要留存异常文本；尚无截图权限时 appendError 会安全地省略截图。
    uiHelpers.appendError("分辨率检测失败", e);
}
try {
    $ui.txt_device_model.setText(device.brand + " " + device.model);
    var sdkOk = device.sdkInt >= 24;
    $ui.txt_device_android.setText("Android " + device.release + " (API " + device.sdkInt + ")");
    $ui.txt_device_android.setTextColor(colors.parseColor(sdkOk ? C.textPrimary : C.error));
    $ui.txt_android_status.setText(sdkOk ? "已适配" : "版本过低");
    $ui.txt_android_status.setTextColor(colors.parseColor(sdkOk ? C.green : C.error));
} catch(e) {}
try {
    var bat = device.getBattery();
    var charging = device.isCharging();
    $ui.txt_device_battery.setText(Math.round(bat) + "%" + (charging ? " 充电中" : ""));
} catch(e) {}

// ── Permission checks ──
var _allPermsOk = false;

function checkPerms() {
    var ok1 = gameHelper.hasPackageListPerm();
    var ok2 = gameHelper.hasAccessibilityPerm();
    var ok3 = gameHelper.hasOverlayPerm();
    _allPermsOk = ok1 && ok2 && ok3;
    $ui.run(function() {
        try { $ui.perm_pkg_list.setChecked(ok1); $ui.perm_pkg_list_label.setText(ok1 ? "已开启" : "未开启"); $ui.perm_pkg_list_label.setTextColor(colors.parseColor(ok1 ? C.green : C.error)); } catch(e) {}
        try { $ui.perm_access.setChecked(ok2); $ui.perm_access_label.setText(ok2 ? "已开启" : "未开启"); $ui.perm_access_label.setTextColor(colors.parseColor(ok2 ? C.green : C.error)); } catch(e) {}
        try { $ui.perm_overlay.setChecked(ok3); $ui.perm_overlay_label.setText(ok3 ? "已开启" : "未开启"); $ui.perm_overlay_label.setTextColor(colors.parseColor(ok3 ? C.green : C.error)); } catch(e) {}
        // 启动按钮状态
        try {
            $ui.btn_launch.setCardBackgroundColor(colors.parseColor(_allPermsOk ? C.accent : "#C7C7CC"));
        } catch(e) {}
    });
    return _allPermsOk;
}
checkPerms();
setInterval(function() { checkPerms(); }, 3000);
// 不依赖总调度是否正在运行：跨零点后的首页和悬浮面板都应及时按完成日期重算为“今日未完成”。
setInterval(function() { refreshResidentDemandDateStatus(); }, 60000);

// 点击权限行跳转对应设置
$ui.perm_pkg_list_row.on("click", function() {
    try {
        app.startActivity(new android.content.Intent(
            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.parse("package:" + context.getPackageName())
        ));
    } catch(e) {}
});
$ui.perm_access_row.on("click", function() {
    try {
        app.startActivity(new android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS));
    } catch(e) {}
});
$ui.perm_overlay_row.on("click", function() {
    try {
        app.startActivity(new android.content.Intent(
            android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            android.net.Uri.parse("package:" + context.getPackageName())
        ));
    } catch(e) {}
});

// ── 总调度器 ──
/**
 * 只允许从总调度页启动，避免任务详情页绕过限时任务的抢占规则。
 * @returns {boolean} 调度器已接受本次启动请求时返回 true；前置校验未通过时返回 false。
 */
function startScheduler() {
    if (schedulerRunning) return false;
    if (!_allPermsOk) {
        toast("请先开启所需权限");
        return false;
    }
    if (!loadedImages) {
        toast("请先启动游戏并完成资源加载");
        return false;
    }
    if (floatingPanel.getEnabledTasks().length === 0) {
        toast("请至少开启一个调度任务");
        floatingPanel.setSchedulerStatus("请至少开启一个任务后再运行");
        return false;
    }

    // 启动前先按今天重算状态，避免调度刚开始时主页仍展示昨天的“今日已完成”。
    refreshResidentDemandDateStatus();

    var sessionId = ++schedulerSessionId;
    schedulerRunning = true;
    floatingPanel.running = true;
    floatingPanel.setRunningUI(true, C);
    floatingPanel.setSchedulerStatus("调度器启动中");
    uiHelpers.initStats(harvestStats);
    /**
     * 写入总调度的普通业务事件。
     * @param {string} message 用户可读的业务描述。
     */
    function appendSchedulerLog(message) {
        uiHelpers.appendLog(message);
    }

    /**
     * 写入需要保留现场截图的调度告警。
     * @param {string} message 用户可读的缺位或页面状态告警。
     */
    function appendSchedulerWarning(message) {
        uiHelpers.appendWarning(message);
    }

    // gameHelper 仅在必要位置缺失时调用该附加通道，其他调度消息仍按 info 写入。
    appendSchedulerLog.appendWarning = appendSchedulerWarning;
    threads.start(function() {
        try {
            scheduler.run({
                images: loadedImages,
                panel: floatingPanel,
                // 会话号不匹配说明用户已停止并重新运行；旧线程只能在自己的安全边界退出，不能继续操作当前游戏页面。
                shouldStop: function() { return !schedulerRunning || sessionId !== schedulerSessionId; },
                log: appendSchedulerLog,
                setStatus: function(status) { floatingPanel.setSchedulerStatus(status); },
                onAction: function(taskKey) {
                    harvestStats[taskKey] = (harvestStats[taskKey] || 0) + 1;
                    uiHelpers.updateStats(taskKey, harvestStats);
                    floatingPanel._saveConfig();
                },
                // 居民需求的“已完成”与巡检时间不属于累计统计，落库后只刷新两处状态标记。
                onResidentDemandStateChange: function() { refreshResidentDemandHomeStatus(); }
            });
        } catch(e) {
            // 顶层调度异常需要保留堆栈和现场截图，供宿主机拉回后与业务日志一起分析。
            uiHelpers.appendError("调度器异常", e);
        } finally {
            // 旧会话结束不能关闭已经启动的新会话。
            if (schedulerRunning && sessionId === schedulerSessionId) stopScheduler();
        }
    });
    return true;
}

/**
 * 请求总调度器在当前原子动作结束后停止，避免中途打断游戏拖拽或页面跳转。
 */
function stopScheduler() {
    if (!schedulerRunning) return;
    schedulerRunning = false;
    // 使正在 sleep 或等待页面状态的旧线程永久失效，即使随后立即创建了新会话。
    schedulerSessionId++;
    floatingPanel.running = false;
    floatingPanel.setRunningUI(false, C);
    floatingPanel.setSchedulerStatus("已停止");
    uiHelpers.appendLog("[停止] 总调度器");
}

/**
 * 确保当前 AutoJs 脚本会话拥有可用的录屏会话。
 *
 * `requestScreenCaptureAsync()` 会先释放已有会话再重新请求，直接调用会导致每次点击启动都弹出授权。
 * 已安装的 AutoJs6 6.7.0 可通过 `images.getScreenCaptureOptions()` 判断当前会话是否仍持有截图能力。
 *
 * @returns {boolean} 已有或新授予录屏权限时返回 true；用户拒绝时返回 false。
 */
function ensureScreenCapturePermission() {
    if (images.getScreenCaptureOptions()) {
        uiHelpers.appendLog("已检测到可用录屏权限，跳过申请");
        return true;
    }

    uiHelpers.appendLog("未检测到录屏权限，正在申请...");
    // 点击启动的工作线程可同步等待系统授权结果，避免授权未完成就进入依赖截图的流程。
    var granted;
    try {
        granted = requestScreenCapture(false);
    } catch (requestError) {
        // 申请 API 自身异常时也不能让顶层 appendError 尝试截图，避免引发第二次授权。
        var reason = requestError && requestError.message ? requestError.message : String(requestError);
        uiHelpers.appendWarning("录屏权限申请失败: " + reason, false);
        return false;
    }
    if (!granted) {
        // 拒绝场景只持久化 warn 文本；截图会触发 AutoJs 的隐式授权申请，造成二次弹窗。
        uiHelpers.appendWarning("未授予录屏权限，已取消启动", false);
        return false;
    }

    uiHelpers.appendLog("录屏权限已授予");
    return true;
}

// ── Launch ──
/**
 * 启动游戏并准备调度器依赖的图片资源。
 * 录屏会话会优先复用，只有当前脚本运行时未持有会话时才请求用户授权。
 */
$ui.btn_launch.on("click", function() {
    if (!_allPermsOk) {
        toast("请先开启所需权限");
        return;
    }
    uiHelpers.appendLog("正在启动游戏...");
    threads.start(function() {
        try {
            app.launchApp("疯狂水世界")
            uiHelpers.appendLog("游戏已启动，检查录屏权限...");
            sleep(1000);
            if (!ensureScreenCapturePermission()) return;
            // 保持原有的稳定等待窗口，避免刚授权后的首帧仍受系统授权动画影响。
            sleep(1000);
            loadedImages = gameHelper.loadImages();
            // 公共缺位入口先写告警和截图，再通过该处理器使用当前会话的模板安全恢复主页。
            gameHelper.setMainSceneRecovery(function(taskName, positionName, logFn) {
                return navigate.recoverToMainScene(loadedImages, function() { return !schedulerRunning; }, function(message) {
                    var contextualMessage = "[" + taskName + " / " + positionName + "] " + message;
                    if (typeof logFn === "function") logFn(contextualMessage);
                    else uiHelpers.appendLog(contextualMessage);
                });
            });
            uiHelpers.appendLog("资源加载完成");
            floatingPanel.showBall(panelCtx);
        } catch(e) {
            // 截图权限尚未授予时 appendError 会仅记录错误文本，不会掩盖原始启动异常。
            uiHelpers.appendError("启动失败", e);
        }
    });
});
