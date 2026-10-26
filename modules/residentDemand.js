// residentDemand.js — 居民需求：按当前奖励与物资状态提交、刷新或安全跳过

var residentDemand = {};

// 该任务只使用目标 MuMu 1080×2400 原图校准的区域；设备分辨率变化时按截图尺寸等比换算。
var REFERENCE_WIDTH = 1080;
var REFERENCE_HEIGHT = 2400;
var MAX_STATE_TRANSITIONS = 120;
var PANEL_WAIT_ATTEMPTS = 10;
var PANEL_WAIT_INTERVAL_MS = 400;
var RETURN_WAIT_ATTEMPTS = 8;
var RETURN_WAIT_INTERVAL_MS = 500;
var ACTION_WAIT_ATTEMPTS = 10;
var ACTION_WAIT_INTERVAL_MS = 400;
var TERMINAL_CONFIRM_ATTEMPTS = 2;
var TERMINAL_CONFIRM_INTERVAL_MS = 450;
// 居民头像会随当前第一位居民变化，不能作为稳定入口模板；贸易港口按钮始终位于其正上方。
// 该偏移量来自两张 1080×2400 实机截图：港口稳定上半部左上角 (18,1590)，居民可点击面中心 (58,1742)。
var RESIDENT_ENTRY_CLICK_OFFSET_FROM_TRADE_PORT = [40, 152];
// 贸易港口的绿色勾可能覆盖下半部，居民入口锚定只使用未受状态角标影响的上半部。
var TRADE_PORT_ENTRY_STABLE_HEIGHT_RATIO = 0.48;
// 居民标签固定在需求抽屉顶部的四个视觉槽位；槽位数是 UI 布局，不是每日任务数量上限。
var RESIDENT_TAB_CENTERS = [180, 420, 660, 900];
var RESIDENT_TAB_CLICK_Y = 1410;
var RESIDENT_TAB_SELECTED_Y = 1310;
var RESIDENT_TAB_SCAN_X_OFFSETS = [-75, -45, -15, 15, 45, 75];
var RESIDENT_TAB_SCAN_Y_OFFSETS = [1340, 1370, 1400, 1430, 1460, 1490];
var PANEL_BACKGROUND_RGB = [45, 50, 128];
var RESIDENT_TAB_MIN_VISUAL_PIXELS = 8;

// 实机截图确认 ML Kit 无法读取孤立的描边数字图，而内置 Rapid OCR 可在原图固定奖励行稳定读到数值。
// 区域同时包含数字的完整高度但排除 EXP/金币图标及顶部总金币，避免误把其他数字当作居民奖励。
var EXPERIENCE_REGION = [760, 1680, 110, 112];
var GOLD_REGION = [860, 1696, 132, 100];
var REWARD_FRAGMENT_MIN_VERTICAL_OVERLAP_RATIO = 0.55;
var REWARD_FRAGMENT_MAX_HORIZONTAL_GAP_RATIO = 0.85;
// 当前面板的三个物资数量分别位于左、中、右三个固定栏位；空栏位保持非红色，扫描三处可兼容剩余一至三项需求。
var MATERIAL_NUMBER_REGIONS = [
    [220, 1980, 130, 130],
    [460, 1980, 130, 130],
    [710, 1980, 130, 130]
];

/**
 * 返回当前设备本地日期键，用于跨零点隔离每天的完成状态与巡检冷却。
 * @param {number} timestamp 毫秒级时间戳。
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
 * 判断两个时间戳是否属于同一设备本地日期。
 * @param {number} left 第一个时间戳。
 * @param {number} right 第二个时间戳。
 * @returns {boolean} 两者均有效且本地日期相同时返回 true。
 */
function isSameLocalDate(left, right) {
    var leftKey = getLocalDateKey(left);
    var rightKey = getLocalDateKey(right);
    return leftKey !== null && leftKey === rightKey;
}

/**
 * 判断一个字符串是否是实际存在的本地日历日期键。
 * 完成状态必须保存业务日期而非布尔值或时间戳，格式错误时宁可视为未完成，不能错误跳过当天任务。
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
 * 判断居民需求的已完成日期是否就是本次调度所在的设备本地日期。
 * 昨天留下的完成日期只作审计记录，绝不能让今天的调度直接返回。
 * @param {*} completedDate 持久化的居民需求完成日期。
 * @param {number} now 本次调度开始时的设备毫秒时间戳。
 * @returns {boolean} 仅完成日期与今天完全一致时返回 true。
 */
function isCompletedOnCurrentDate(completedDate, now) {
    return isLocalDateKey(completedDate) && completedDate === getLocalDateKey(now);
}

/**
 * 判断本次巡检是否仍应受同一天的分钟级冷却约束。
 * 昨日的巡检时间不会阻塞今天首次检查，避免跨零点漏掉新一轮居民需求。
 * @param {number} lastCheckedAt 上次安全巡检完成时间。
 * @param {number} intervalMinutes 冷却分钟数。
 * @param {number} now 当前毫秒时间戳。
 * @returns {boolean} 仍在冷却期时返回 true。
 */
function isInCooldown(lastCheckedAt, intervalMinutes, now) {
    if (!isSameLocalDate(lastCheckedAt, now)) return false;
    return now - lastCheckedAt < intervalMinutes * 60 * 1000;
}

/**
 * 判断居民需求奖励阈值是否为可安全执行的正整数。
 * @param {*} value 待验证的配置值。
 * @returns {boolean} 仅数值型正整数返回 true。
 */
function isPositiveInteger(value) {
    return typeof value === "number" && isFinite(value) && value > 0 && Math.floor(value) === value;
}

/**
 * 依据设备本地星期选择本次居民需求的奖励判定标准。
 * 开启周四金币模式时仅周四读取需求面板中的金币；其余日期仍读取经验，避免周末误切换奖励类型。
 * @param {{experienceThreshold:number,thursdayGoldEnabled:boolean,goldThreshold:number}} options 居民需求奖励配置。
 * @param {number} now 本次巡检开始时的设备本地时间戳。
 * @returns {{label:string,region:number[],threshold:number}|null} 当前奖励区域和阈值；阈值无效时返回 null。
 */
function getRewardCriterion(options, now) {
    var useGold = options.thursdayGoldEnabled === true && new Date(now).getDay() === 4;
    var threshold = useGold ? options.goldThreshold : options.experienceThreshold;
    if (!isPositiveInteger(threshold)) return null;
    return useGold ? {
        label: "金币",
        region: GOLD_REGION,
        threshold: threshold
    } : {
        label: "经验",
        region: EXPERIENCE_REGION,
        threshold: threshold
    };
}

/**
 * 检查当前任务所需模板是否都已加载。缺图时绝不使用固定坐标代替按钮或页面确认。
 * @param {Object} imgs 已加载的模板集合。
 * @returns {boolean} 所有必需模板可用时返回 true。
 */
function hasRequiredImages(imgs) {
    var keys = [
        "baseIcon", "worldIcon", "tradePortEntry", "residentDemandPanel",
        "residentDemandSatisfy", "residentDemandRefresh", "residentDemandImmediateComplete", "residentDemandBack"
    ];
    for (var i = 0; i < keys.length; i++) {
        if (!imgs || !imgs[keys[i]]) return false;
    }
    return true;
}

/**
 * 写入任务日志，同时在有公共告警能力时保留必要位置缺失证据。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {string} positionName 未确认的位置或状态名称。
 * @param {Function} logFn 日志回调。
 */
function reportMissing(gameHelper, positionName, logFn) {
    if (gameHelper && typeof gameHelper.notifyRequiredPositionMissing === "function") {
        gameHelper.notifyRequiredPositionMissing("居民需求", positionName, logFn);
        return;
    }
    if (typeof logFn === "function") logFn("[居民需求] 未确认" + positionName + "，本轮安全退出");
}

/**
 * 点击已由模板确认的控件中心。该任务不对未识别按钮使用固定坐标点击。
 * @param {{x:number,y:number}} point 模板左上角坐标。
 * @param {Object} image 对应模板图片。
 */
function clickTemplateCenter(point, image) {
    click(
        Math.round(point.x + image.getWidth() / 2),
        Math.round(point.y + image.getHeight() / 2)
    );
}

/**
 * 读取截图的实际尺寸并将 1080×2400 标定点映射到当前设备。
 * @param {Object} screen 当前截图；不可用时回退到目标基准尺寸。
 * @returns {{x:number,y:number}} 横纵缩放比。
 */
function getScreenScale(screen) {
    var width = REFERENCE_WIDTH;
    var height = REFERENCE_HEIGHT;
    try {
        if (screen && typeof screen.getWidth === "function") width = screen.getWidth();
        if (screen && typeof screen.getHeight === "function") height = screen.getHeight();
    } catch (e) {}
    return {
        x: width > 0 ? width / REFERENCE_WIDTH : 1,
        y: height > 0 ? height / REFERENCE_HEIGHT : 1
    };
}

/**
 * 将原始截图区域按当前截图尺寸缩放。
 * @param {number[]} region 基准区域 [x, y, width, height]。
 * @param {{x:number,y:number}} scale 截图缩放比。
 * @returns {number[]} 当前截图对应区域。
 */
function scaleRegion(region, scale) {
    return [
        Math.round(region[0] * scale.x),
        Math.round(region[1] * scale.y),
        Math.max(1, Math.round(region[2] * scale.x)),
        Math.max(1, Math.round(region[3] * scale.y))
    ];
}

/**
 * 将 ARGB 数值拆分为 RGB 三通道，兼容 AutoJs 返回的有符号 32 位像素值。
 * @param {number} color AutoJs 图像像素值。
 * @returns {{r:number,g:number,b:number}} RGB 通道。
 */
function toRgb(color) {
    var value = Number(color);
    return {
        r: (value >>> 16) & 255,
        g: (value >>> 8) & 255,
        b: value & 255
    };
}

/**
 * 判断标签背景像素是否仍为未使用槽位的深蓝色。
 * @param {{r:number,g:number,b:number}} rgb 待判断的 RGB 像素。
 * @returns {boolean} 接近空槽背景时返回 true。
 */
function isPanelBackground(rgb) {
    return Math.abs(rgb.r - PANEL_BACKGROUND_RGB[0]) <= 18 &&
        Math.abs(rgb.g - PANEL_BACKGROUND_RGB[1]) <= 18 &&
        Math.abs(rgb.b - PANEL_BACKGROUND_RGB[2]) <= 24;
}

/**
 * 判断标签顶部的浅色选中底板。仅凭头像或姓名不能证明已选中，必须确认这一稳定状态色。
 * @param {Object} screen 当前截图。
 * @param {{x:number,y:number}} scale 截图缩放比。
 * @param {number} slotIndex 标签槽位序号。
 * @returns {boolean} 当前槽位的选中底板已确认时返回 true。
 */
function isResidentTabSelected(screen, scale, slotIndex) {
    if (typeof images === "undefined" || typeof images.pixel !== "function") return false;
    var centerX = RESIDENT_TAB_CENTERS[slotIndex] * scale.x;
    var selectedY = RESIDENT_TAB_SELECTED_Y * scale.y;
    var matches = 0;
    var xOffsets = [-50, 0, 50];
    var yOffsets = [0, 10];
    for (var y = 0; y < yOffsets.length; y++) {
        for (var x = 0; x < xOffsets.length; x++) {
            var rgb = toRgb(images.pixel(screen, Math.round(centerX + xOffsets[x] * scale.x), Math.round(selectedY + yOffsets[y] * scale.y)));
            if (rgb.r >= 210 && rgb.g >= 210 && rgb.b >= 220 && Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) <= 35) {
                matches++;
            }
        }
    }
    return matches >= 3;
}

/**
 * 扫描当前面板中真实存在的居民标签，并通过浅色选中底板确认当前选择。
 * 空槽只会保留深蓝面板底色，因此不能把四个固定视觉位置当作固定居民数量。
 * @returns {{valid:boolean,tabs:Array<{index:number,x:number,y:number}>,selectedIndex:number|null}} 标签扫描结果。
 */
function scanResidentTabs() {
    if (typeof captureScreen !== "function" || typeof images === "undefined" || typeof images.pixel !== "function") {
        return { valid: false, tabs: [], selectedIndex: null };
    }
    var screen = null;
    try {
        screen = captureScreen();
        if (!screen) return { valid: false, tabs: [], selectedIndex: null };
        var scale = getScreenScale(screen);
        var tabs = [];
        var selected = [];
        for (var slot = 0; slot < RESIDENT_TAB_CENTERS.length; slot++) {
            var visualPixels = 0;
            for (var y = 0; y < RESIDENT_TAB_SCAN_Y_OFFSETS.length; y++) {
                for (var x = 0; x < RESIDENT_TAB_SCAN_X_OFFSETS.length; x++) {
                    var px = Math.round((RESIDENT_TAB_CENTERS[slot] + RESIDENT_TAB_SCAN_X_OFFSETS[x]) * scale.x);
                    var py = Math.round(RESIDENT_TAB_SCAN_Y_OFFSETS[y] * scale.y);
                    if (!isPanelBackground(toRgb(images.pixel(screen, px, py)))) visualPixels++;
                }
            }
            if (visualPixels >= RESIDENT_TAB_MIN_VISUAL_PIXELS) {
                tabs.push({
                    index: slot,
                    x: Math.round(RESIDENT_TAB_CENTERS[slot] * scale.x),
                    y: Math.round(RESIDENT_TAB_CLICK_Y * scale.y)
                });
                if (isResidentTabSelected(screen, scale, slot)) selected.push(slot);
            }
        }
        // 选中态不唯一说明动画或画面异常，后续不得猜测当前居民。
        return { valid: true, tabs: tabs, selectedIndex: selected.length === 1 ? selected[0] : null };
    } catch (e) {
        return { valid: false, tabs: [], selectedIndex: null };
    } finally {
        try { if (screen && typeof screen.recycle === "function") screen.recycle(); } catch (ignore) {}
    }
}

/**
 * 取得当前选中居民之后的第一个真实标签。只向后移动，不循环回第一个，
 * 这样最后一位进入协商中时会安全结束巡检而非反复切换。
 * @param {Array<{index:number,x:number,y:number}>} tabs 已确认存在的标签。
 * @param {number} selectedIndex 当前选中标签序号。
 * @returns {{index:number,x:number,y:number}|null} 下一标签或 null。
 */
function getNextResidentTab(tabs, selectedIndex) {
    for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].index > selectedIndex) return tabs[i];
    }
    return null;
}

/**
 * 读取三个操作按钮的当前状态。每日终态只有三个按钮同时缺失时才可被判定。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {{satisfy:Object|null,refresh:Object|null,immediate:Object|null}} 已确认的按钮坐标。
 */
function findActionButtons(imgs, gameHelper) {
    return {
        // 三个按钮是互斥的正常业务状态；缺少其中任一按钮不能污染错误日志。
        satisfy: gameHelper.findFirst(imgs.residentDemandSatisfy, 0.8, "居民需求满足TA", true),
        refresh: gameHelper.findFirst(imgs.residentDemandRefresh, 0.8, "居民需求刷新", true),
        immediate: gameHelper.findFirst(imgs.residentDemandImmediateComplete, 0.8, "居民需求立即完成", true)
    };
}

/**
 * 判断当前是否为“物资不足、满足按钮改为获取物品”的正常需求状态。
 * 游戏在任一需求数量变红时会替换主按钮，因此不能把“满足TA”缺失误报为模板故障；
 * 仍要求刷新按钮存在，以免未知页面被错误当成居民需求。
 * @param {{satisfy:Object|null,refresh:Object|null,immediate:Object|null}} buttons 当前动作按钮。
 * @returns {boolean} 可按物资不足规则跳过当前居民时返回 true。
 */
function isInsufficientMaterialActionState(buttons) {
    return !!(buttons && !buttons.satisfy && buttons.refresh && !buttons.immediate);
}

/**
 * 有限轮询确认居民需求面板，避免入口点击动画尚未结束时直接依赖固定标签坐标。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Function} shouldStop 停止请求。
 * @returns {boolean} 面板标识已确认时返回 true。
 */
function waitForDemandPanel(imgs, gameHelper, shouldStop) {
    for (var attempt = 0; attempt < PANEL_WAIT_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (gameHelper.findFirst(imgs.residentDemandPanel, 0.8, "居民需求面板")) return true;
        if (attempt < PANEL_WAIT_ATTEMPTS - 1) sleep(PANEL_WAIT_INTERVAL_MS);
    }
    return false;
}

/**
 * 确保从已确认基地开始。入口只在基地界面出现，世界或未知页面不能直接寻找居民需求图标。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} navigate 导航模块。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认基地时返回 true。
 */
function ensureBaseScene(imgs, gameHelper, navigate, shouldStop, logFn) {
    if (shouldStop()) return false;
    var scene = navigate.detectScene(imgs);
    if (scene === "base") return true;
    if (scene !== "world") {
        reportMissing(gameHelper, "游戏基地界面", logFn);
        return false;
    }
    var basePoint = gameHelper.findFirst(imgs.baseIcon, 0.7, "居民需求基地入口");
    if (!basePoint) {
        reportMissing(gameHelper, "基地入口", logFn);
        return false;
    }
    clickTemplateCenter(basePoint, imgs.baseIcon);
    for (var attempt = 0; attempt < RETURN_WAIT_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (navigate.detectScene(imgs) === "base") return true;
        if (attempt < RETURN_WAIT_ATTEMPTS - 1) sleep(RETURN_WAIT_INTERVAL_MS);
    }
    reportMissing(gameHelper, "切换后的基地界面", logFn);
    return false;
}

/**
 * 通过贸易港口稳定上半部定位居民头像槽位。
 * 当前第一位居民的头像会变化，不能用单一头像模板定位；贸易港口在该槽位正上方，
 * 因此只在港口模板确认后使用已校准的相对点击点，并仍由后续面板模板验证是否真正进入。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {{x:number,y:number}|null} 可安全点击的居民入口点；锚点未确认时返回 null。
 */
function findResidentDemandEntryPoint(imgs, gameHelper) {
    var stableTradePortImage = null;
    try {
        if (typeof images === "undefined" || typeof images.clip !== "function") return null;
        var tradePortImage = imgs.tradePortEntry;
        var stableHeight = Math.max(1, Math.floor(tradePortImage.getHeight() * TRADE_PORT_ENTRY_STABLE_HEIGHT_RATIO));
        stableTradePortImage = images.clip(tradePortImage, 0, 0, tradePortImage.getWidth(), stableHeight);
        var tradePortPoint = gameHelper.findFirst(stableTradePortImage, 0.78, "居民需求贸易港口锚点", true);
        if (!tradePortPoint) return null;
        return {
            x: tradePortPoint.x + RESIDENT_ENTRY_CLICK_OFFSET_FROM_TRADE_PORT[0],
            y: tradePortPoint.y + RESIDENT_ENTRY_CLICK_OFFSET_FROM_TRADE_PORT[1]
        };
    } catch (e) {
        // 锚点裁剪或识图异常时不尝试头像模板或绝对坐标，避免误点地图建筑。
        return null;
    } finally {
        try { if (stableTradePortImage && typeof stableTradePortImage.recycle === "function") stableTradePortImage.recycle(); } catch (ignore) {}
    }
}

/**
 * 点击居民需求入口并确认目标面板出现。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已进入并确认需求面板时返回 true。
 */
function enterDemandPanel(imgs, gameHelper, shouldStop, logFn) {
    var entryPoint = findResidentDemandEntryPoint(imgs, gameHelper);
    if (!entryPoint) {
        reportMissing(gameHelper, "居民需求入口的贸易港口锚点", logFn);
        return false;
    }
    // 点击点只来自已识别港口的相对槽位；面板未确认前不进行居民需求的后续动作。
    click(entryPoint.x, entryPoint.y);
    if (waitForDemandPanel(imgs, gameHelper, shouldStop)) return true;
    if (!shouldStop()) reportMissing(gameHelper, "居民需求面板", logFn);
    return false;
}

/**
 * 读取 OCR 结果的有效 Android Rect 边界；缺少边界的数字只能独立使用，不能与其他片段猜测拼接。
 * @param {Object} result 单条奖励 OCR 结果。
 * @returns {{left:number,top:number,right:number,bottom:number,width:number,height:number}|null} 标准化后的边界或 null。
 */
function getRewardOcrBounds(result) {
    var bounds = result && result.bounds;
    if (!bounds) return null;
    var left = Number(bounds.left);
    var top = Number(bounds.top);
    var right = Number(bounds.right);
    var bottom = Number(bounds.bottom);
    if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom) || right <= left || bottom <= top) return null;
    return {
        left: left,
        top: top,
        right: right,
        bottom: bottom,
        width: right - left,
        height: bottom - top
    };
}

/**
 * 从奖励区域的 OCR 结果中提取纯数字片段。带字母、符号或不完整边界的结果不能被当成奖励值，
 * 以避免把装饰图标、物资数量或异常文本误用于提交判断。
 * @param {Array} results 奖励 OCR 结果数组。
 * @returns {Array<{digits:string,value:number,bounds:Object|null}>} 可用于严格解析的数字片段。
 */
function getRewardNumericTokens(results) {
    var tokens = [];
    for (var i = 0; i < results.length; i++) {
        var label = String(results[i] && results[i].label || "").replace(/\s/g, "");
        if (!/^\d+$/.test(label)) continue;
        var value = Number(label);
        if (!isFinite(value)) return [];
        tokens.push({
            digits: label,
            value: value,
            bounds: getRewardOcrBounds(results[i])
        });
    }
    return tokens;
}

/**
 * 判断相邻 OCR 数字片段是否可确认属于同一行奖励数值。只有垂直高度明显重叠、
 * 从左到右紧邻且没有重叠时才允许合并，避免将两个独立数值误拼成高价值奖励。
 * @param {{bounds:Object}} left 左侧数字片段。
 * @param {{bounds:Object}} right 右侧数字片段。
 * @returns {boolean} 两片段可安全合并时返回 true。
 */
function canMergeRewardFragments(left, right) {
    if (!left || !right || !left.bounds || !right.bounds) return false;
    var verticalOverlap = Math.min(left.bounds.bottom, right.bounds.bottom) - Math.max(left.bounds.top, right.bounds.top);
    var minimumHeight = Math.min(left.bounds.height, right.bounds.height);
    if (minimumHeight <= 0 || verticalOverlap <= 0 || verticalOverlap / minimumHeight < REWARD_FRAGMENT_MIN_VERTICAL_OVERLAP_RATIO) return false;

    var horizontalGap = right.bounds.left - left.bounds.right;
    // OCR 重复框会重叠原有数字；只允许极小的抗锯齿误差，不能把重叠文本当作连续数字。
    if (horizontalGap < -2) return false;
    return horizontalGap <= Math.max(8, Math.max(left.bounds.height, right.bounds.height) * REWARD_FRAGMENT_MAX_HORIZONTAL_GAP_RATIO);
}

/**
 * 将一个奖励区域的 OCR 结果严格解析成单一整数。Rapid OCR 也可能把描边字体的同一数值拆成多个片段，
 * 此处只在片段的空间关系可确认时合并；存在歧义时返回 null 并保持任务不点击。
 * @param {Array} results 奖励 OCR 结果数组。
 * @returns {number|null} 已确认的奖励整数；存在歧义时返回 null。
 */
function parseRewardValue(results) {
    var tokens = getRewardNumericTokens(results || []);
    if (tokens.length === 1) return tokens[0].value;
    if (!tokens.length) return null;

    tokens.sort(function(left, right) { return left.bounds && right.bounds ? left.bounds.left - right.bounds.left : 0; });
    var digits = tokens[0].digits;
    for (var i = 1; i < tokens.length; i++) {
        if (!canMergeRewardFragments(tokens[i - 1], tokens[i])) return null;
        digits += tokens[i].digits;
    }
    var value = Number(digits);
    return isFinite(value) ? value : null;
}

/**
 * 将少量原始 OCR 标签和位置格式化为失败日志，便于在不放宽安全判断的前提下定位识别异常。
 * @param {Array} results 奖励 OCR 结果数组。
 * @returns {string} 适合运行日志的简短诊断文本。
 */
function describeRewardOcrResults(results) {
    if (!results || !results.length) return "[]";
    var descriptions = [];
    for (var i = 0; i < results.length && i < 6; i++) {
        var label = String(results[i] && results[i].label || "").replace(/[\r\n]/g, " ");
        var bounds = getRewardOcrBounds(results[i]);
        descriptions.push(JSON.stringify(label) + (bounds ? "@(" + bounds.left + "," + bounds.top + "," + bounds.right + "," + bounds.bottom + ")" : "@未知位置"));
    }
    return "[" + descriptions.join(", ") + (results.length > descriptions.length ? ", ...]" : "]");
}

/**
 * 使用 Rapid OCR 读取指定奖励区域。现场实测 ML Kit 无法读取此游戏的孤立描边数字，
 * Rapid 需在原截图保留少量上下文；区域已排除顶部总金币和相邻奖励，解析仍只接受唯一纯整数。
 * @param {number[]} region 待读取的固定奖励数字区域，基于 1080×2400 参考坐标。
 * @param {Function} logFn 运行日志回调。
 * @returns {number|null} 奖励值；无法确认时返回 null。
 */
function readRewardValue(region, logFn) {
    if (typeof captureScreen !== "function" || typeof ocr === "undefined" || !ocr.rapid || typeof ocr.rapid.detect !== "function") {
        if (typeof logFn === "function") logFn("[居民需求] Rapid 奖励 OCR 不可用");
        return null;
    }
    var screen = null;
    try {
        screen = captureScreen();
        if (!screen) return null;
        var scale = getScreenScale(screen);
        var scaledRegion = scaleRegion(region, scale);
        // Rapid OCR 必须直接读原图加固定区域；裁成小图会丢失模型所需的文字上下文并稳定返回空数组。
        var results = ocr.rapid.detect(screen, scaledRegion) || [];
        var value = parseRewardValue(results);
        if (value === null && typeof logFn === "function") {
            // 仅记录本奖励小区域的结果；这是诊断证据，不会改变 OCR 不确定即停止的业务边界。
            logFn("[居民需求] Rapid 奖励 OCR 未确认：区域=" + JSON.stringify(scaledRegion) + "，原始结果=" + describeRewardOcrResults(results));
        }
        return value;
    } catch (e) {
        if (typeof logFn === "function") logFn("[居民需求] Rapid 奖励 OCR 异常：" + (e && e.message ? e.message : String(e)));
        return null;
    } finally {
        try { if (screen && typeof screen.recycle === "function") screen.recycle(); } catch (ignore) {}
    }
}

/**
 * 判断需求数量文字是否为不足时的红色。红色检测只覆盖三个物资数值栏，
 * 避免把物资图标、按钮或页面装饰的红色误判为库存不足。
 * @returns {boolean|null} true 表示至少一项缺料，false 表示所有物资栏均非红色，null 表示无法确认。
 */
function hasInsufficientMaterials() {
    if (typeof captureScreen !== "function" || typeof images === "undefined" || typeof images.pixel !== "function") return null;
    var screen = null;
    try {
        screen = captureScreen();
        if (!screen) return null;
        var scale = getScreenScale(screen);
        for (var regionIndex = 0; regionIndex < MATERIAL_NUMBER_REGIONS.length; regionIndex++) {
            var region = scaleRegion(MATERIAL_NUMBER_REGIONS[regionIndex], scale);
            var redPixels = 0;
            for (var row = 1; row <= 6; row++) {
                for (var column = 1; column <= 10; column++) {
                    var x = Math.round(region[0] + region[2] * column / 11);
                    var y = Math.round(region[1] + region[3] * row / 7);
                    var rgb = toRgb(images.pixel(screen, x, y));
                    // 数量字体抗锯齿会产生浅红，故用相对色差而不是单一固定色值。
                    if (rgb.r >= 145 && rgb.r - rgb.g >= 45 && rgb.r - rgb.b >= 45) {
                        redPixels++;
                        if (redPixels >= 2) return true;
                    }
                }
            }
        }
        return false;
    } catch (e) {
        return null;
    } finally {
        try { if (screen && typeof screen.recycle === "function") screen.recycle(); } catch (ignore) {}
    }
}

/**
 * 在点击标签后确认同一槽位已经显示唯一的浅色选中态。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {number} expectedIndex 期望选中的标签序号。
 * @param {Function} shouldStop 停止请求。
 * @returns {{valid:boolean,tabs:Array,selectedIndex:number|null}|null} 确认后的扫描结果。
 */
function waitForSelectedTab(imgs, gameHelper, expectedIndex, shouldStop) {
    for (var attempt = 0; attempt < ACTION_WAIT_ATTEMPTS; attempt++) {
        if (shouldStop()) return null;
        if (!gameHelper.findFirst(imgs.residentDemandPanel, 0.8, "居民需求面板")) return null;
        var scan = scanResidentTabs();
        if (scan.valid && scan.selectedIndex === expectedIndex) return scan;
        if (attempt < ACTION_WAIT_ATTEMPTS - 1) sleep(ACTION_WAIT_INTERVAL_MS);
    }
    return null;
}

/**
 * 切换到当前居民右侧的下一位，并确认选中态；没有下一位时不循环回首位。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{valid:boolean,tabs:Array,selectedIndex:number|null}} scan 当前标签扫描结果。
 * @param {Function} shouldStop 停止请求。
 * @returns {"switched"|"last"|"failed"|"interrupted"} 切换结果。
 */
function switchToNextResident(imgs, gameHelper, scan, shouldStop) {
    var nextTab = getNextResidentTab(scan.tabs, scan.selectedIndex);
    if (!nextTab) return "last";
    if (shouldStop()) return "interrupted";
    click(nextTab.x, nextTab.y);
    return waitForSelectedTab(imgs, gameHelper, nextTab.index, shouldStop) ? "switched" : (shouldStop() ? "interrupted" : "failed");
}

/**
 * 等待“满足TA”后的居民列表或选中态改变。无确认变化时不继续点击，
 * 防止按钮动画、卡顿或未知弹层导致同一份需求被重复提交。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{tabs:Array,selectedIndex:number|null}} previous 点击前标签状态。
 * @param {Function} shouldStop 停止请求。
 * @returns {boolean} 已确认居民状态发生变化时返回 true。
 */
function waitForSatisfiedResidentTransition(imgs, gameHelper, previous, shouldStop) {
    for (var attempt = 0; attempt < ACTION_WAIT_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (!gameHelper.findFirst(imgs.residentDemandPanel, 0.8, "居民需求面板")) return false;
        var scan = scanResidentTabs();
        if (scan.valid && (scan.tabs.length < previous.tabs.length || scan.selectedIndex !== previous.selectedIndex)) return true;
        if (attempt < ACTION_WAIT_ATTEMPTS - 1) sleep(ACTION_WAIT_INTERVAL_MS);
    }
    return false;
}

/**
 * 等待刷新后的协商状态。游戏会自动选择下一位居民；若当前已是最后一位，
 * 仍会停在当前标签并显示“立即完成”，此时只能结束本次巡检，绝不能点击该按钮。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{tabs:Array,selectedIndex:number}} previous 刷新前标签状态。
 * @param {Function} shouldStop 停止请求。
 * @returns {{kind:string,scan:Object|null}} 刷新后的确认结果。
 */
function waitForRefreshOutcome(imgs, gameHelper, previous, shouldStop) {
    for (var attempt = 0; attempt < ACTION_WAIT_ATTEMPTS; attempt++) {
        if (shouldStop()) return { kind: "interrupted", scan: null };
        if (!gameHelper.findFirst(imgs.residentDemandPanel, 0.8, "居民需求面板")) return { kind: "failed", scan: null };
        var buttons = findActionButtons(imgs, gameHelper);
        var scan = scanResidentTabs();
        if (buttons.immediate && scan.valid && scan.selectedIndex !== null) {
            var nextTab = getNextResidentTab(previous.tabs, previous.selectedIndex);
            if (nextTab && scan.selectedIndex === nextTab.index) return { kind: "autoSwitched", scan: scan };
            if (!nextTab && scan.selectedIndex === previous.selectedIndex) {
                return { kind: "lastNegotiating", scan: scan };
            }
            // 刷新必须自动选中紧邻的下一位；跳过标签同样属于未知状态，不能手工补点标签。
            return { kind: "failed", scan: scan };
        }
        if (attempt < ACTION_WAIT_ATTEMPTS - 1) sleep(ACTION_WAIT_INTERVAL_MS);
    }
    return { kind: shouldStop() ? "interrupted" : "failed", scan: null };
}

/**
 * 只有面板持续存在、所有标签消失且三个按钮都不存在时才确认当天完成。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Function} shouldStop 停止请求。
 * @returns {boolean} 当日终态持续确认时返回 true。
 */
function isDailyTerminalState(imgs, gameHelper, shouldStop) {
    for (var attempt = 0; attempt < TERMINAL_CONFIRM_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (!gameHelper.findFirst(imgs.residentDemandPanel, 0.8, "居民需求面板")) return false;
        var scan = scanResidentTabs();
        var buttons = findActionButtons(imgs, gameHelper);
        if (!scan.valid || scan.tabs.length !== 0 || buttons.satisfy || buttons.refresh || buttons.immediate) return false;
        if (attempt < TERMINAL_CONFIRM_ATTEMPTS - 1) sleep(TERMINAL_CONFIRM_INTERVAL_MS);
    }
    return true;
}

/**
 * 使用已确认的返回按钮退出居民需求，并且只在检测到基地后视为安全返回。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} navigate 导航模块。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认返回基地时返回 true。
 */
function returnToBaseScene(imgs, gameHelper, navigate, shouldStop, logFn) {
    if (shouldStop()) return false;
    if (navigate.detectScene(imgs) === "base") return true;
    var backClicked = false;
    for (var attempt = 0; attempt < RETURN_WAIT_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (navigate.detectScene(imgs) === "base") return true;
        // 必要位置告警会短暂覆盖左下角返回按钮；先有限轮询等待 Toast 消失，避免告警反过来阻断安全退回。
        var backPoint = gameHelper.findFirst(imgs.residentDemandBack, 0.8, "居民需求返回", true);
        if (backPoint && !backClicked) {
            clickTemplateCenter(backPoint, imgs.residentDemandBack);
            backClicked = true;
        }
        // 返回点击只允许一次；未知动画期间重复触碰左下角可能触发其他页面的控件。
        if (attempt < RETURN_WAIT_ATTEMPTS - 1) sleep(RETURN_WAIT_INTERVAL_MS);
    }
    // 只在所有有界重试均未发现返回按钮或基地时告警，防止 Toast 遮挡期制造重复告警。
    reportMissing(gameHelper, "居民需求返回按钮或基地界面", logFn);
    return false;
}

/**
 * 在确认返回基地后统一写回巡检时间和可选的每日完成时间。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} navigate 导航模块。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 日志回调。
 * @param {Function} onSafeCheck 安全回调。
 * @param {boolean} dailyCompleted 是否写入本次巡检所属日期的全部完成状态。
 * @param {string|null} completedDate 本次巡检开始时所属的业务日期；仅终态时写入。
 * @param {number} runStartedAt 本次巡检开始时的设备时间。
 * @returns {{status:string}} 本次任务结果。
 */
function finishSafeCheck(imgs, gameHelper, navigate, shouldStop, logFn, onSafeCheck, dailyCompleted, completedDate, runStartedAt) {
    if (shouldStop()) return { status: "interrupted" };
    if (!returnToBaseScene(imgs, gameHelper, navigate, shouldStop, logFn)) {
        return { status: shouldStop() ? "interrupted" : "failed" };
    }
    if (shouldStop()) return { status: "interrupted" };
    var returnedAt = Date.now();
    // 巡检跨零点时保留开始日作为冷却归属，避免刚完成昨天尾声的返回动作阻塞今天首次检查。
    var checkedAt = isSameLocalDate(runStartedAt, returnedAt) ? returnedAt : runStartedAt;
    var state = { lastCheckedAt: checkedAt };
    // 终态归属巡检开始日：23:59 开始、00:00 才安全返回的旧日任务不得写成新日完成。
    if (dailyCompleted && isLocalDateKey(completedDate)) state.completedDate = completedDate;
    // 时间戳只在返回基地这一安全边界后回调，停止或未知页面均不会污染本地状态。
    if (typeof onSafeCheck === "function") onSafeCheck(state);
    return {
        status: dailyCompleted ? "dailyCompleted" : "checked",
        lastCheckedAt: checkedAt,
        completedDate: dailyCompleted && isLocalDateKey(completedDate) ? completedDate : ""
    };
}

/**
 * 页面或 OCR 无法确认时尽量通过已识别返回按钮离开，但不写巡检或每日完成状态。
 * @param {Object} imgs 已加载图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} navigate 导航模块。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 日志回调。
 * @returns {{status:"failed"|"interrupted"}} 失败或停止状态。
 */
function failAndReturn(imgs, gameHelper, navigate, shouldStop, logFn) {
    if (shouldStop()) return { status: "interrupted" };
    returnToBaseScene(imgs, gameHelper, navigate, shouldStop, logFn);
    return { status: shouldStop() ? "interrupted" : "failed" };
}

/**
 * 执行一次居民需求安全巡检。
 * @param {Object} imgs 已加载图片资源。
 * @param {{intervalMinutes:number,lastCheckedAt:number,completedDate:string,experienceThreshold:number,thursdayGoldEnabled:boolean,goldThreshold:number}} options 任务持久化状态、间隔与奖励配置。
 * @param {Function} shouldStop 停止请求。
 * @param {Function} logFn 日志回调。
 * @param {Function} onSafeCheck 仅在确认返回基地后回调保存 `{ lastCheckedAt, completedDate? }`。
 * @returns {{status:"cooldown"|"checked"|"dailyCompleted"|"interrupted"|"failed"}} 任务结果。
 */
residentDemand.runOnce = function(imgs, options, shouldStop, logFn, onSafeCheck) {
    options = options || {};
    var isStopRequested = typeof shouldStop === "function" ? shouldStop : function() { return false; };
    var logger = typeof logFn === "function" ? logFn : function() {};
    var intervalMinutes = Number(options.intervalMinutes);
    var now = Date.now();
    var runDate = getLocalDateKey(now);

    /**
     * 在本次状态机的安全出口统一提交巡检和可选完成日期。
     * @param {boolean} dailyCompleted 是否确认了本次巡检所属日期的全部完成。
     * @returns {{status:string}} 本次安全出口结果。
     */
    function finishCurrentCheck(dailyCompleted) {
        return finishSafeCheck(
            imgs,
            gameHelper,
            navigate,
            isStopRequested,
            logger,
            onSafeCheck,
            dailyCompleted,
            runDate,
            now
        );
    }

    if (!isFinite(intervalMinutes) || intervalMinutes <= 0) {
        logger("[居民需求] 巡检间隔无效，本轮跳过");
        return { status: "failed" };
    }
    // 仅完成日期就是今天时才不加载模块、不截图也不触屏；昨天的日期必须立刻进入今日巡检。
    if (isCompletedOnCurrentDate(options.completedDate, now)) return { status: "dailyCompleted" };
    // 冷却只在同一天生效；昨天的剩余时间不能阻塞今天的新需求。
    if (isInCooldown(options.lastCheckedAt, intervalMinutes, now)) return { status: "cooldown" };
    if (isStopRequested()) return { status: "interrupted" };
    var rewardCriterion = getRewardCriterion(options, now);
    if (!rewardCriterion) {
        // 阈值损坏时不读取画面或点击按钮，避免将未知奖励按默认值误提交或刷新。
        logger("[居民需求] 当前奖励阈值无效，本轮安全退出");
        return { status: "failed" };
    }

    if (!hasRequiredImages(imgs)) {
        logger("[居民需求] 模板资源未加载，本轮跳过");
        return { status: "failed" };
    }

    var gameHelper = require("./gameHelper.js");
    var navigate = require("./navigate.js");
    try {
        if (!ensureBaseScene(imgs, gameHelper, navigate, isStopRequested, logger)) {
            return isStopRequested() ? { status: "interrupted" } : { status: "failed" };
        }
        if (!enterDemandPanel(imgs, gameHelper, isStopRequested, logger)) {
            return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
        }

        for (var transition = 0; transition < MAX_STATE_TRANSITIONS; transition++) {
            if (isStopRequested()) return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            if (!gameHelper.findFirst(imgs.residentDemandPanel, 0.8, "居民需求面板")) {
                reportMissing(gameHelper, "持续显示的居民需求面板", logger);
                return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }
            if (isDailyTerminalState(imgs, gameHelper, isStopRequested)) {
                logger("[居民需求] 已确认本次巡检所属日期的所有居民需求均已消失");
                return finishCurrentCheck(true);
            }

            var scan = scanResidentTabs();
            if (!scan.valid || scan.tabs.length === 0 || scan.selectedIndex === null) {
                reportMissing(gameHelper, "可选居民标签或选中态", logger);
                return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }
            var buttons = findActionButtons(imgs, gameHelper);
            if (buttons.immediate) {
                // “立即完成”代表游戏正在协商；这是状态标识，任何情况下都不能点击它。
                var negotiatedMove = switchToNextResident(imgs, gameHelper, scan, isStopRequested);
                if (negotiatedMove === "switched") continue;
                if (negotiatedMove === "last") {
                    logger("[居民需求] 最后一位居民仍在协商，结束本次巡检且不点击立即完成");
                    return finishCurrentCheck(false);
                }
                if (negotiatedMove !== "interrupted") reportMissing(gameHelper, "协商中下一位居民的选中态", logger);
                return negotiatedMove === "interrupted" ? { status: "interrupted" } : failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }
            // 物资不足时游戏会把“满足TA”替换为“获取物品”；先确认红色库存再按原规则切换，不将正常按钮替换误判为缺图。
            var insufficientActionState = isInsufficientMaterialActionState(buttons);
            if (!buttons.refresh || (!buttons.satisfy && !insufficientActionState)) {
                reportMissing(gameHelper, "满足TA或刷新按钮", logger);
                return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }

            var rewardValue = readRewardValue(rewardCriterion.region, logger);
            if (rewardValue === null) {
                // OCR 不能确认当前奖励时不做满足或刷新，防止把顶部总金币或相邻数字误用于业务判断。
                reportMissing(gameHelper, "奖励" + rewardCriterion.label + "OCR结果", logger);
                return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }
            if (rewardValue <= rewardCriterion.threshold) {
                // 奖励必须严格大于当前阈值；恰好等于阈值也刷新，金币和经验沿用同一业务规则。
                clickTemplateCenter(buttons.refresh, imgs.residentDemandRefresh);
                var refreshOutcome = waitForRefreshOutcome(imgs, gameHelper, scan, isStopRequested);
                if (refreshOutcome.kind === "autoSwitched") continue;
                if (refreshOutcome.kind === "lastNegotiating") {
                    logger("[居民需求] 刷新最后一位后进入协商中，结束本次巡检且不点击立即完成");
                    return finishCurrentCheck(false);
                }
                if (refreshOutcome.kind !== "interrupted") reportMissing(gameHelper, "刷新后的协商状态或自动切换", logger);
                return refreshOutcome.kind === "interrupted" ? { status: "interrupted" } : failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }

            var insufficient = hasInsufficientMaterials();
            if (insufficient === null) {
                reportMissing(gameHelper, "居民物资数量颜色", logger);
                return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }
            if (insufficient || insufficientActionState) {
                // “获取物品”必须同时有红色库存才是已确认的缺料状态；两者矛盾时停止而不猜测主按钮语义。
                if (insufficientActionState && !insufficient) {
                    reportMissing(gameHelper, "获取物品按钮对应的红色物资数量", logger);
                    return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
                }
                // 高价值奖励但任一物资数量变红时只切换下一位，既不提交也不刷新该需求。
                var materialMove = switchToNextResident(imgs, gameHelper, scan, isStopRequested);
                if (materialMove === "switched") continue;
                if (materialMove === "last") {
                    return finishCurrentCheck(false);
                }
                if (materialMove !== "interrupted") reportMissing(gameHelper, "物资不足后的下一位居民选中态", logger);
                return materialMove === "interrupted" ? { status: "interrupted" } : failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }

            clickTemplateCenter(buttons.satisfy, imgs.residentDemandSatisfy);
            if (!waitForSatisfiedResidentTransition(imgs, gameHelper, scan, isStopRequested)) {
                if (!isStopRequested()) reportMissing(gameHelper, "满足TA后的居民切换", logger);
                return isStopRequested() ? { status: "interrupted" } : failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
            }
        }
        // 120 次是纯安全上限；正常流程由真实标签消失或无下一标签结束，不依赖每日固定数量。
        logger("[居民需求] 状态转换超过安全上限，本轮安全退出");
        return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
    } catch (e) {
        logger("[居民需求] 执行异常：" + (e && e.message ? e.message : e));
        return failAndReturn(imgs, gameHelper, navigate, isStopRequested, logger);
    }
};

module.exports = residentDemand;
