// exhibition.js — 展区展品收集与探险寻宝

var exhibition = {};

var BASE_WIDTH = 1080;
var BASE_HEIGHT = 2400;
var MAX_COMPLETED_TEAMS = 3;
var MAX_BUBBLE_CLICKS = 20;
// 展品气泡的展柜背景各不相同，不能继续用整张截图模板匹配。
// 以下颜色均取自气泡内“参观券”图标，且四个位置的相对关系不随展柜背景变化。
var EXHIBITION_BUBBLE_SCAN_REGION = [120, 650, 840, 1200];
var EXHIBITION_BUBBLE_SCAN_CELL_WIDTH = 180;
var EXHIBITION_BUBBLE_SCAN_CELL_HEIGHT = 180;
var EXHIBITION_BUBBLE_ANCHOR_COLOR = "#B5E19C";
var EXHIBITION_BUBBLE_PATTERN = [
    [-2, 15, "#7FB08D"], [-17, 21, "#51856B"], [15, 19, "#FFFCFC"], [2, 5, "#7CAE8E"]
];
var EXHIBITION_BUBBLE_COLOR_THRESHOLD = 16;
// 锚点位于参观券内部；此偏移仍落在原模板中心，点击不会落到底下的展柜。
var EXHIBITION_BUBBLE_CLICK_OFFSET = [21, -32];
var EXHIBITION_BUBBLE_DISMISS_ATTEMPTS = 4;
var EXHIBITION_BUBBLE_DISMISS_RETRY_DELAY_MS = 400;
// “探险完成”横幅和等级结算动画结束后才会显示领奖按钮；有限轮询避免把动画帧误判为页面失败。
var COMPLETION_CLAIM_ATTEMPTS = 10;
var COMPLETION_CLAIM_RETRY_DELAY_MS = 500;

// 地点顺序与面板复选框保持一致；同一轮会按该顺序而非模板匹配返回顺序尝试。
var SITE_NAMES = [
    "旧灯塔瞭望台", "图书馆残址", "羽蛇神祭坛", "冬宫残影", "法老之墓",
    "十字军锚地", "月亮金字塔", "沙漠绿洲", "琥珀石残迹", "沉没教堂"
];

// 所有固定区域均以用户提供的 1080×2400 MuMu 原始截图标定，运行时统一缩放。
var FIXED_POINTS = {
    // “恭喜获得”层只能在底部关闭提示出现后点击物品下方空白区关闭；标题不是关闭控件。
    rewardDismiss: [540, 1800],
    durationHours: {
        // 原始 1080×2400 组队截图中三个单选圆点的中心都在 y≈1650；
        // 不能点到下方空白区，否则会沿用游戏原有时长却按配置时长发队。
        4: [210, 1650],
        8: [460, 1650],
        12: [710, 1650]
    }
};

var FIXED_REGIONS = {
    detailTitle: [140, 470, 800, 110],
    // 仅覆盖三项物资数量所在的文字行，排除上方图标，避免橙色图标被误判成库存不足红字。
    materialCounts: [150, 1440, 790, 125]
};

/**
 * 将 1080×2400 基准坐标适配到当前真实屏幕，避免状态栏或同纵横比设备造成触点偏移。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {{x: number, y: number}|null} 当前横纵缩放比例；无法获取分辨率时返回 null。
 */
function getScreenScale(gameHelper) {
    var resolution = gameHelper.getRealResolution();
    if (!resolution || resolution.length < 2 || resolution[0] <= 0 || resolution[1] <= 0) return null;
    return { x: resolution[0] / BASE_WIDTH, y: resolution[1] / BASE_HEIGHT };
}

/**
 * 将基准触点转换为当前设备坐标。
 * @param {number[]} point 1080×2400 基准点 [x, y]。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @returns {{x: number, y: number}} 当前设备上的触点。
 */
function scalePoint(point, scale) {
    return { x: Math.round(point[0] * scale.x), y: Math.round(point[1] * scale.y) };
}

/**
 * 将基准 OCR/找色区域转换为当前截图坐标。
 * @param {number[]} region 1080×2400 基准区域 [x, y, width, height]。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @returns {number[]} 当前截图上的区域。
 */
function scaleRegion(region, scale) {
    return [
        Math.round(region[0] * scale.x),
        Math.round(region[1] * scale.y),
        Math.round(region[2] * scale.x),
        Math.round(region[3] * scale.y)
    ];
}

/**
 * 点击已识别模板中心，避免依赖模板裁剪时的左上角坐标。
 * @param {{x: number, y: number}} point 模板左上角坐标。
 * @param {Object} image 已加载的模板图片。
 */
function clickTemplateCenter(point, image) {
    click(Math.round(point.x + image.getWidth() / 2), Math.round(point.y + image.getHeight() / 2));
}

/**
 * 点击已确认页面上的固定位置；固定点只用于时长单选等没有独立文字模板的控件。
 * @param {number[]} point 1080×2400 基准点 [x, y]。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 */
function clickFixedPoint(point, scale) {
    var currentPoint = scalePoint(point, scale);
    click(currentPoint.x, currentPoint.y);
}

/**
 * 规范化 OCR 标题与配置地点名称，去除序号、空白和常见标点后再比对。
 * @param {string} value 原始文字。
 * @returns {string} 可用于地点精确比对的中文文字。
 */
function normalizeSiteName(value) {
    return String(value || "")
        .replace(/[0-9０-９]/g, "")
        .replace(/[\s\.．、,:：]/g, "")
        .replace(/[^\u4e00-\u9fa5]/g, "");
}

/**
 * 将用户勾选的地点投影为固定的业务顺序，避免复选框点击顺序改变寻宝优先级。
 * @param {Array<string>} sites 面板保存的已勾选地点。
 * @returns {Array<string>|null} 固定顺序的地点列表；配置不是数组时返回 null。
 */
function normalizeConfiguredSites(sites) {
    if (!Array.isArray(sites)) return null;
    return SITE_NAMES.filter(function(site) {
        return sites.indexOf(site) >= 0;
    });
}

/**
 * 在已知地点集合中确认 OCR 标题对应的地点，未知文字不得继续点击“组建小队”。
 * @param {string} title OCR 拼接出的详情标题。
 * @returns {string|null} 已确认的地点名称；无法确认时返回 null。
 */
function findKnownSite(title) {
    var normalizedTitle = normalizeSiteName(title);
    for (var i = 0; i < SITE_NAMES.length; i++) {
        var normalizedSite = normalizeSiteName(SITE_NAMES[i]);
        if (normalizedTitle === normalizedSite || normalizedTitle.indexOf(normalizedSite) >= 0) return SITE_NAMES[i];
    }
    return null;
}

/**
 * 按纵向优先、横向次要的稳定顺序排列模板点，避免设备偶发改变 matchTemplate 返回顺序。
 * @param {Array<Object>} points 模板左上角坐标集合。
 * @returns {Array<Object>} 排序后的新数组。
 */
function sortTopToBottom(points) {
    return (points || []).slice().sort(function(a, b) {
        return a.y === b.y ? a.x - b.x : a.y - b.y;
    });
}

/**
 * 将展品气泡内参观券的多点颜色特征适配到当前截图分辨率。
 * 气泡所在展柜会改变背景，只有图标内部的颜色关系可作为稳定识别依据。
 * @param {{x: number, y: number}} scale 当前横纵缩放比例。
 * @returns {Array} 可传给 images.findMultiColors 的相对颜色特征。
 */
function scaleExhibitionBubblePattern(scale) {
    var pattern = [];
    for (var i = 0; i < EXHIBITION_BUBBLE_PATTERN.length; i++) {
        var item = EXHIBITION_BUBBLE_PATTERN[i];
        pattern.push([
            Math.round(item[0] * scale.x),
            Math.round(item[1] * scale.y),
            item[2]
        ]);
    }
    return pattern;
}

/**
 * 在展区可摆放展柜的区域内扫描全部展品气泡。
 * 每个网格仅保留一个候选，可避免同一气泡的相邻抗锯齿像素重复成为点击目标。
 * @param {{x: number, y: number}} scale 当前横纵缩放比例。
 * @param {Function} logFn 日志回调。
 * @returns {Array<{x: number, y: number, anchor: {x: number, y: number}}>|null} 稳定排序后的点击候选；截图或找色不可用时返回 null。
 */
function findExhibitionBubbleCandidates(scale, logFn) {
    if (typeof images === "undefined" || typeof images.findMultiColors !== "function" || typeof captureScreen !== "function") {
        logFn("[展区] 多点找色不可用，不能安全领取展品气泡");
        return null;
    }

    var screen = null;
    try {
        screen = captureScreen();
        if (!screen) {
            logFn("[展区] 未获取到展品气泡截图");
            return null;
        }

        var region = scaleRegion(EXHIBITION_BUBBLE_SCAN_REGION, scale);
        var cellWidth = Math.max(1, Math.round(EXHIBITION_BUBBLE_SCAN_CELL_WIDTH * scale.x));
        var cellHeight = Math.max(1, Math.round(EXHIBITION_BUBBLE_SCAN_CELL_HEIGHT * scale.y));
        var endX = region[0] + region[2];
        var endY = region[1] + region[3];
        var pattern = scaleExhibitionBubblePattern(scale);
        var candidates = [];

        // 用小网格逐格查找，既覆盖全展区，又不会因 findMultiColors 只返回首个命中而遗漏其他展柜。
        for (var y = region[1]; y < endY; y += cellHeight) {
            for (var x = region[0]; x < endX; x += cellWidth) {
                var anchor = images.findMultiColors(screen, EXHIBITION_BUBBLE_ANCHOR_COLOR, pattern, {
                    region: [x, y, Math.min(cellWidth, endX - x), Math.min(cellHeight, endY - y)],
                    threshold: EXHIBITION_BUBBLE_COLOR_THRESHOLD
                });
                if (!anchor) continue;
                candidates.push({
                    x: Math.round(anchor.x + EXHIBITION_BUBBLE_CLICK_OFFSET[0] * scale.x),
                    y: Math.round(anchor.y + EXHIBITION_BUBBLE_CLICK_OFFSET[1] * scale.y),
                    anchor: { x: anchor.x, y: anchor.y }
                });
            }
        }
        return sortTopToBottom(candidates);
    } catch (e) {
        logFn("[展区] 展品气泡多点找色异常：" + e.message);
        return null;
    } finally {
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 判断刷新后的候选是否仍是刚点击的同一气泡。
 * 不把其他展柜的正常气泡视为点击失败，只有锚点仍停留在当前气泡附近才中止本轮。
 * @param {Array<{anchor: {x: number, y: number}}>} candidates 刷新后的全部气泡候选。
 * @param {{anchor: {x: number, y: number}}} clicked 已点击的气泡。
 * @param {{x: number, y: number}} scale 当前横纵缩放比例。
 * @returns {boolean} 同一气泡仍显示时返回 true。
 */
function hasUnchangedExhibitionBubble(candidates, clicked, scale) {
    var maxDistance = Math.max(24, Math.round(60 * Math.max(scale.x, scale.y)));
    for (var i = 0; i < candidates.length; i++) {
        var anchor = candidates[i].anchor;
        if (Math.abs(anchor.x - clicked.anchor.x) <= maxDistance && Math.abs(anchor.y - clicked.anchor.y) <= maxDistance) {
            return true;
        }
    }
    return false;
}

/**
 * 去除同一地点图钉的相邻重复匹配，避免同一地点在一轮中被多次打开。
 * @param {Array<Object>} points 原始模板匹配点。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @returns {Array<Object>} 去重后的地点图钉位置。
 */
function dedupeNearbyPoints(points, scale) {
    var result = [];
    var distance = Math.max(16, Math.round(40 * scale.x));
    var sorted = sortTopToBottom(points);
    for (var i = 0; i < sorted.length; i++) {
        var duplicated = false;
        for (var j = 0; j < result.length; j++) {
            if (Math.abs(sorted[i].x - result[j].x) < distance && Math.abs(sorted[i].y - result[j].y) < distance) {
                duplicated = true;
                break;
            }
        }
        if (!duplicated) result.push(sorted[i]);
    }
    return result;
}

/**
 * 检查展区流程所需模板是否均已加载。缺图时完全不进入游戏页面，避免靠坐标猜测页面状态。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {boolean} 所有必需模板可用时返回 true。
 */
function hasRequiredImages(imgs) {
    var required = [
        "baseIcon", "worldIcon", "tradePortEntry", "tradePortClose", "tradePortRewardTitle", "rewardDismissHint",
        "exhibitionMuseum", "exhibitionBubble", "exhibitionTreasureEntry", "exhibitionTreasureTitle",
        "exhibitionSitePin", "exhibitionCompleted", "exhibitionIdle", "exhibitionClaimReward",
        "exhibitionTeamBuild", "exhibitionAddHero", "exhibitionConfirmHero", "exhibitionStart",
        "exhibitionClose", "exhibitionBack"
    ];
    for (var i = 0; i < required.length; i++) {
        if (!imgs || !imgs[required[i]]) return false;
    }
    return true;
}

/**
 * 使用基地/世界切换图标确认已经回到游戏主界面。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {boolean} 当前画面可确认是主界面时返回 true。
 */
function isMainScene(imgs, gameHelper) {
    return !!gameHelper.findFirst(imgs.baseIcon, 0.7, "展区主界面基地") || !!gameHelper.findFirst(imgs.worldIcon, 0.7, "展区主界面世界");
}

/**
 * 检查当前是否仍位于寻宝地图，后续返回操作只会在该确认成立时执行。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {boolean} 找到寻宝标题时返回 true。
 */
function isTreasurePage(imgs, gameHelper) {
    return !!gameHelper.findFirst(imgs.exhibitionTreasureTitle, 0.8, "展区寻宝标题");
}

/**
 * 进入并立即关闭贸易港口，以其现有入口作为地图定位锚点。
 * 此处绝不调用收货、领奖或交货按钮，港口仅用于恢复展区所在的地图位置。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前屏幕缩放比例。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已进入并关闭港口时返回 true。
 */
function enterAndCloseTradePortAnchor(imgs, gameHelper, flow, shouldStop, logFn) {
    var navigate = require("./navigate.js");
    var scene = navigate.detectScene(imgs);
    if (scene === "unknown") {
        return gameHelper.notifyRequiredPositionMissing("展区", "游戏主界面", logFn);
    }
    if (scene === "world") {
        var basePoint = gameHelper.findFirst(imgs.baseIcon, 0.7, "展区切换基地");
        if (!basePoint) {
            return gameHelper.notifyRequiredPositionMissing("展区", "基地入口", logFn);
        }
        clickTemplateCenter(basePoint, imgs.baseIcon);
        sleep(2500);
        if (shouldStop()) return false;
    }

    var entryPoint = gameHelper.findFirst(imgs.tradePortEntry, 0.78, "展区贸易港口定位入口");
    if (!entryPoint) {
        return gameHelper.notifyRequiredPositionMissing("展区", "贸易港口定位入口", logFn);
    }
    clickTemplateCenter(entryPoint, imgs.tradePortEntry);
    flow.page = "tradePort";
    sleep(1600);
    if (shouldStop()) return false;

    var closePoint = gameHelper.findFirst(imgs.tradePortClose, 0.8, "展区贸易港口关闭");
    if (!closePoint) {
        return gameHelper.notifyRequiredPositionMissing("展区", "贸易港口关闭按钮", logFn);
    }
    // 定位锚点只允许点明确的关闭 X；不能复用贸易港口任务中的收货或交货流程。
    clickTemplateCenter(closePoint, imgs.tradePortClose);
    flow.page = "main";
    sleep(1300);
    logFn("[展区] 已使用贸易港口完成地图定位锚点");
    return !shouldStop();
}

/**
 * 连续两次双指内缩并识别博物馆，进入展区前不使用固定建筑坐标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认进入展区时返回 true。
 */
function enterExhibition(imgs, gameHelper, flow, shouldStop, logFn) {
    gameHelper.pinchZoomOut();
    sleep(900);
    if (shouldStop()) return false;
    gameHelper.pinchZoomOut();
    sleep(900);
    if (shouldStop()) return false;

    var museumPoint = gameHelper.findFirst(imgs.exhibitionMuseum, 0.76, "博物馆");
    if (!museumPoint) {
        return gameHelper.notifyRequiredPositionMissing("展区", "博物馆", logFn);
    }
    clickTemplateCenter(museumPoint, imgs.exhibitionMuseum);
    flow.page = "exhibition";
    sleep(1600);
    if (shouldStop()) return false;

    // 寻宝入口是进入展区后的页面标记，先确认它存在才会采集展品气泡。
    if (!gameHelper.findFirst(imgs.exhibitionTreasureEntry, 0.78, "展区寻宝入口")) {
        return gameHelper.notifyRequiredPositionMissing("展区", "博物馆展区页面", logFn);
    }
    return true;
}

/**
 * 逐个领取展区中的展品气泡。每次点击后确认该气泡已消失，避免把模板漏检误记为领取成功。
 * @param {{x: number, y: number}} scale 当前横纵缩放比例。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 所有可见气泡已处理且每次点击均确认消失时返回 true；识别或点击确认异常时返回 false。
 */
function collectExhibitionBubbles(scale, shouldStop, logFn) {
    for (var i = 0; i < MAX_BUBBLE_CLICKS && !shouldStop(); i++) {
        var bubbles = findExhibitionBubbleCandidates(scale, logFn);
        if (bubbles === null) return false;
        if (bubbles.length === 0) {
            logFn("[展区] 展品气泡收集完成");
            return true;
        }
        var clickedBubble = bubbles[0];
        click(clickedBubble.x, clickedBubble.y);

        var dismissed = false;
        for (var attempt = 0; attempt < EXHIBITION_BUBBLE_DISMISS_ATTEMPTS && !shouldStop(); attempt++) {
            sleep(EXHIBITION_BUBBLE_DISMISS_RETRY_DELAY_MS);
            var remainingBubbles = findExhibitionBubbleCandidates(scale, logFn);
            if (remainingBubbles === null) return false;
            if (!hasUnchangedExhibitionBubble(remainingBubbles, clickedBubble, scale)) {
                dismissed = true;
                break;
            }
        }
        if (!dismissed) {
            if (!shouldStop()) logFn("[展区] 展品气泡点击后仍可识别，本轮停止以避免重复点击");
            return false;
        }
    }
    if (shouldStop()) return false;
    logFn("[展区] 展品气泡在最大安全次数后仍存在，未继续重复点击");
    return false;
}

/**
 * 打开右下角寻宝入口并确认寻宝标题，防止在博物馆其他子页执行图钉点击。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认进入寻宝地图时返回 true。
 */
function enterTreasurePage(imgs, gameHelper, flow, shouldStop, logFn) {
    var entryPoint = gameHelper.findFirst(imgs.exhibitionTreasureEntry, 0.78, "展区寻宝入口");
    if (!entryPoint) {
        return gameHelper.notifyRequiredPositionMissing("展区", "寻宝入口", logFn);
    }
    clickTemplateCenter(entryPoint, imgs.exhibitionTreasureEntry);
    flow.page = "treasure";
    sleep(1200);
    if (shouldStop() || !isTreasurePage(imgs, gameHelper)) {
        if (!shouldStop()) return gameHelper.notifyRequiredPositionMissing("展区", "寻宝地图", logFn);
        return false;
    }
    return true;
}

/**
 * 等待“探险完成”结算动画露出领取奖励按钮。
 * 仅在已点击完成队伍后的已确认页面中轮询，不使用系统返回或固定坐标，避免 Android 返回键触发游戏退出确认。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Function} shouldStop 停止标记。
 * @returns {{x: number, y: number}|null} 领取奖励模板坐标；停止或超时未出现时返回 null。
 */
function waitForClaimRewardButton(imgs, gameHelper, shouldStop) {
    for (var attempt = 0; attempt < COMPLETION_CLAIM_ATTEMPTS; attempt++) {
        if (shouldStop()) return null;
        var claimPoint = gameHelper.findFirst(imgs.exhibitionClaimReward, 0.8, "展区领取奖励");
        if (claimPoint) return claimPoint;
        if (attempt < COMPLETION_CLAIM_ATTEMPTS - 1) sleep(COMPLETION_CLAIM_RETRY_DELAY_MS);
    }
    return null;
}

/**
 * 领取最多三个已完成小队的奖励。每次领奖后必须确认底部关闭提示并关闭“恭喜获得”层，才会检查下一小队。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已完成领奖检查时返回 true；任一页面无法确认时返回 false。
 */
function claimCompletedTeams(imgs, gameHelper, scale, flow, shouldStop, logFn) {
    for (var i = 0; i < MAX_COMPLETED_TEAMS && !shouldStop(); i++) {
        var completedPoint = gameHelper.findFirst(imgs.exhibitionCompleted, 0.8, "展区已完成");
        if (!completedPoint) return true;
        clickTemplateCenter(completedPoint, imgs.exhibitionCompleted);
        flow.page = "completion";

        var claimPoint = waitForClaimRewardButton(imgs, gameHelper, shouldStop);
        if (!claimPoint) {
            return gameHelper.notifyRequiredPositionMissing("展区", "领取奖励按钮", logFn);
        }
        clickTemplateCenter(claimPoint, imgs.exhibitionClaimReward);
        flow.page = "rewardOverlay";
        sleep(900);

        var rewardTitlePoint = gameHelper.findFirst(imgs.tradePortRewardTitle, 0.8, "展区恭喜获得");
        if (!rewardTitlePoint) {
            return gameHelper.notifyRequiredPositionMissing("展区", "奖励结算页面", logFn);
        }
        // 标题先于长奖励列表的入场动画出现；底部提示确认后才可关闭，避免本次点击被游戏吞掉。
        if (!gameHelper.waitForRewardDismissHint(imgs.rewardDismissHint, shouldStop, "展区奖励关闭提示")) {
            if (!shouldStop()) gameHelper.notifyRequiredPositionMissing("展区", "奖励关闭提示", logFn);
            return false;
        }
        // 标题只用于确认奖励层；关闭必须点经过现场验证的物品下方空白区。
        clickFixedPoint(FIXED_POINTS.rewardDismiss, scale);
        flow.page = "treasure";
        sleep(700);
        if (!isTreasurePage(imgs, gameHelper)) {
            gameHelper.notifyRequiredPositionMissing("展区", "寻宝地图确认", logFn);
            flow.page = "unknown";
            return false;
        }
        logFn("[展区] 已领取完成小队奖励（" + (i + 1) + "/" + MAX_COMPLETED_TEAMS + "）");
    }
    return !shouldStop();
}

/**
 * 对当前详情弹窗标题做 ML Kit OCR 并拼接为完整文字。标题不能确认时不能组建小队。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} logFn 日志回调。
 * @returns {string|null} OCR 标题文字；OCR 不可用或异常时返回 null。
 */
function readDetailTitle(scale, logFn) {
    if (typeof ocr === "undefined" || !ocr.mlkit || typeof ocr.mlkit.detect !== "function" || typeof captureScreen !== "function") {
        logFn("[展区] ML Kit OCR 不可用，不能确认探险地点");
        return null;
    }
    var screen = null;
    try {
        screen = captureScreen();
        var results = ocr.mlkit.detect(screen, scaleRegion(FIXED_REGIONS.detailTitle, scale)) || [];
        var text = results.slice().sort(function(a, b) {
            var leftA = a.bounds && typeof a.bounds.left === "number" ? a.bounds.left : 0;
            var leftB = b.bounds && typeof b.bounds.left === "number" ? b.bounds.left : 0;
            return leftA - leftB;
        }).map(function(item) {
            return String(item.label || "");
        }).join("");
        return text || null;
    } catch (e) {
        logFn("[展区] 地点标题 OCR 异常：" + e.message);
        return null;
    } finally {
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 关闭当前的详情或组队弹窗。只在已经确认弹窗状态时调用，不能以固定右上角坐标猜测关闭。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 找到并点击已知关闭模板时返回 true。
 */
function closeCurrentDialog(imgs, gameHelper, logFn) {
    var closePoint = gameHelper.findFirst(imgs.exhibitionClose, 0.8, "展区弹窗关闭");
    if (!closePoint) {
        return gameHelper.notifyRequiredPositionMissing("展区", "弹窗关闭按钮", logFn);
    }
    clickTemplateCenter(closePoint, imgs.exhibitionClose);
    sleep(700);
    return true;
}

/**
 * 读取当前地图可点击的地点卡，并通过详情标题 OCR 建立候选集。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Array<string>} selectedSites 已配置地点，顺序即尝试优先级。
 * @param {Object} attemptedSites 本轮已尝试地点集合。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {{ok: boolean, candidates: Array<Object>}} OCR 确认的候选地点；ok=false 表示安全失败。
 */
function scanSiteCandidates(imgs, gameHelper, scale, selectedSites, attemptedSites, flow, shouldStop, logFn) {
    var pinPoints = dedupeNearbyPoints(gameHelper.findAll(imgs.exhibitionSitePin, 0.78, "展区地点图钉"), scale);
    var candidates = [];
    for (var i = 0; i < pinPoints.length && !shouldStop(); i++) {
        clickTemplateCenter(pinPoints[i], imgs.exhibitionSitePin);
        flow.page = "unknown";
        sleep(750);

        var closePoint = gameHelper.findFirst(imgs.exhibitionClose, 0.8, "展区地点详情关闭");
        if (!closePoint) {
            if (isTreasurePage(imgs, gameHelper)) {
                flow.page = "treasure";
                continue;
            }
            gameHelper.notifyRequiredPositionMissing("展区", "地点详情弹窗", logFn);
            return { ok: false, candidates: [] };
        }
        flow.page = "detail";
        var title = readDetailTitle(scale, logFn);
        var site = findKnownSite(title);
        if (!site) {
            gameHelper.notifyRequiredPositionMissing("展区", "地点详情标题", logFn);
            if (closeCurrentDialog(imgs, gameHelper, logFn) && isTreasurePage(imgs, gameHelper)) flow.page = "treasure";
            else flow.page = "unknown";
            return { ok: false, candidates: [] };
        }
        if (!closeCurrentDialog(imgs, gameHelper, logFn)) return { ok: false, candidates: [] };
        if (!isTreasurePage(imgs, gameHelper)) {
            flow.page = "unknown";
            gameHelper.notifyRequiredPositionMissing("展区", "寻宝地图确认", logFn);
            return { ok: false, candidates: [] };
        }
        flow.page = "treasure";
        if (selectedSites.indexOf(site) >= 0 && !attemptedSites[site]) {
            candidates.push({ site: site, point: pinPoints[i] });
        }
    }
    if (shouldStop()) return { ok: false, candidates: [] };
    // 图钉在地图上的视觉位置不代表用户配置优先级，重新按配置顺序排序。
    candidates.sort(function(a, b) {
        return selectedSites.indexOf(a.site) - selectedSites.indexOf(b.site);
    });
    return { ok: true, candidates: candidates };
}

/**
 * 检测当前选定时长的物资数字是否变红。无法读到像素时返回 null，而不是把未知状态当作物资充足。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} logFn 日志回调。
 * @returns {boolean|null} true 为物资不足红字，false 为未发现红字，null 为无法确认。
 */
function hasInsufficientMaterials(scale, logFn) {
    if (typeof captureScreen !== "function" || typeof images === "undefined" || typeof images.pixel !== "function") {
        logFn("[展区] 无法读取物资颜色，停止本次派遣");
        return null;
    }
    var screen = null;
    try {
        screen = captureScreen();
        var region = scaleRegion(FIXED_REGIONS.materialCounts, scale);
        var endX = region[0] + region[2];
        var endY = region[1] + region[3];
        for (var y = region[1]; y < endY; y += 3) {
            for (var x = region[0]; x < endX; x += 3) {
                var rawColor = images.pixel(screen, x, y);
                if (typeof rawColor !== "number") {
                    logFn("[展区] 物资颜色读取结果无效，停止本次派遣");
                    return null;
                }
                var color = rawColor >>> 0;
                var red = (color >> 16) & 255;
                var green = (color >> 8) & 255;
                var blue = color & 255;
                // 缺物资数字为高饱和红色；限定在物资数量行避免把上方橙色物品图标误判为红字。
                if (red >= 160 && green <= 125 && blue <= 125 && red > green * 1.45 && red > blue * 1.45) return true;
            }
        }
        return false;
    } catch (e) {
        logFn("[展区] 物资红字检测异常：" + e.message);
        return null;
    } finally {
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 验证刚点击的寻宝时长是否真正进入绿色选中态。
 * 某些时长会被游戏置灰并忽略点击；此时不能继续按旧时长检测物资或开始探险。
 * @param {number} durationHours 本次尝试的寻宝时长，单位小时。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} logFn 日志回调。
 * @returns {boolean|null} true 为已选中，false 为截图正常但未选中，null 为无法读取状态。
 */
function isDurationSelected(durationHours, scale, logFn) {
    var point = FIXED_POINTS.durationHours[durationHours];
    if (!point || typeof captureScreen !== "function" || typeof images === "undefined" || typeof images.pixel !== "function") {
        logFn("[展区] 无法确认寻宝时长选中态");
        return null;
    }
    var screen = null;
    try {
        screen = captureScreen();
        if (!screen) {
            logFn("[展区] 未获取到寻宝时长截图");
            return null;
        }
        var center = scalePoint(point, scale);
        var halfWidth = Math.max(12, Math.round(30 * scale.x));
        var halfHeight = Math.max(12, Math.round(30 * scale.y));
        for (var y = center.y - halfHeight; y <= center.y + halfHeight; y += 3) {
            for (var x = center.x - halfWidth; x <= center.x + halfWidth; x += 3) {
                var rawColor = images.pixel(screen, x, y);
                if (typeof rawColor !== "number") {
                    logFn("[展区] 寻宝时长颜色读取结果无效");
                    return null;
                }
                var color = rawColor >>> 0;
                var red = (color >> 16) & 255;
                var green = (color >> 8) & 255;
                var blue = color & 255;
                // 实机单选框的已选圆心是饱和绿色；区域只覆盖圆点，避免把进度条等绿色元素误判为选中。
                if (green >= 100 && green > red * 1.35 && green > blue * 1.35) return true;
            }
        }
        return false;
    } catch (e) {
        logFn("[展区] 寻宝时长选中态检测异常：" + e.message);
        return null;
    } finally {
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 返回从用户配置时长开始逐级降档的候选序列。
 * @param {number} durationHours 用户配置的寻宝时长。
 * @returns {Array<number>|null} 例如 12 返回 [12, 8, 4]；无效值返回 null。
 */
function getDurationCandidates(durationHours) {
    if (durationHours === 12) return [12, 8, 4];
    if (durationHours === 8) return [8, 4];
    if (durationHours === 4) return [4];
    return null;
}

/**
 * 在已选英雄的组队页选择时长、检查物资并开始探险。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {number} durationHours 用户配置的优先时长。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {{ok: boolean, started: boolean}} 是否流程可确认；started 表示已成功派遣。
 */
function selectDurationAndStart(imgs, gameHelper, scale, durationHours, flow, shouldStop, logFn) {
    var candidates = getDurationCandidates(durationHours);
    if (!candidates) {
        logFn("[展区] 寻宝时长配置无效");
        return { ok: false, started: false };
    }
    var hasSelectedDuration = false;
    for (var i = 0; i < candidates.length && !shouldStop(); i++) {
        var hours = candidates[i];
        clickFixedPoint(FIXED_POINTS.durationHours[hours], scale);
        sleep(350);
        var selected = isDurationSelected(hours, scale, logFn);
        if (selected === null) return { ok: false, started: false };
        if (!selected) {
            logFn("[展区] " + hours + "小时未进入选中态，尝试更低时长");
            continue;
        }
        hasSelectedDuration = true;
        // 红字是唯一允许降档的依据；无法确认时不触发“开始探险”，避免误消耗物资。
        var insufficient = hasInsufficientMaterials(scale, logFn);
        if (insufficient === null) return { ok: false, started: false };
        if (insufficient) {
            logFn("[展区] " + hours + "小时物资不足，尝试更低时长");
            continue;
        }
        var startPoint = gameHelper.findFirst(imgs.exhibitionStart, 0.8, "展区开始探险");
        if (!startPoint) {
            gameHelper.notifyRequiredPositionMissing("展区", "开始探险按钮", logFn);
            return { ok: false, started: false };
        }
        clickTemplateCenter(startPoint, imgs.exhibitionStart);
        flow.page = "teamAfterStart";
        sleep(1000);
        if (shouldStop()) return { ok: false, started: false };
        if (!closeCurrentDialog(imgs, gameHelper, logFn)) {
            flow.page = "unknown";
            return { ok: false, started: false };
        }
        if (!isTreasurePage(imgs, gameHelper)) {
            flow.page = "unknown";
            gameHelper.notifyRequiredPositionMissing("展区", "开始探险后寻宝地图", logFn);
            return { ok: false, started: false };
        }
        flow.page = "treasure";
        logFn("[展区] 已派遣" + hours + "小时探险队");
        return { ok: true, started: true };
    }
    if (shouldStop()) return { ok: false, started: false };

    if (!hasSelectedDuration) {
        gameHelper.notifyRequiredPositionMissing("展区", "寻宝时长选中状态", logFn);
        return { ok: false, started: false };
    }

    // 最低 4 小时仍红字时，先退出组队页，再退出地点详情，绝不尝试购买或加速入口。
    if (!closeCurrentDialog(imgs, gameHelper, logFn)) return { ok: false, started: false };
    flow.page = "detail";
    if (!closeCurrentDialog(imgs, gameHelper, logFn)) return { ok: false, started: false };
    if (!isTreasurePage(imgs, gameHelper)) {
        flow.page = "unknown";
        gameHelper.notifyRequiredPositionMissing("展区", "寻宝地图确认", logFn);
        return { ok: false, started: false };
    }
    flow.page = "treasure";
    return { ok: true, started: false };
}

/**
 * 对一个已 OCR 确认的地点执行一次组队尝试。锁定或不可用地点不会点击任何购买、解锁或加速控件。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {{site: string, point: Object}} candidate 已确认名称与图钉坐标。
 * @param {number} durationHours 用户配置的优先时长。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {{ok: boolean, started: boolean}} 是否流程可确认；started 表示已成功派遣。
 */
function tryDispatchSite(imgs, gameHelper, scale, candidate, durationHours, flow, shouldStop, logFn) {
    clickTemplateCenter(candidate.point, imgs.exhibitionSitePin);
    flow.page = "unknown";
    sleep(750);
    var closePoint = gameHelper.findFirst(imgs.exhibitionClose, 0.8, "展区地点详情关闭");
    if (!closePoint) {
        gameHelper.notifyRequiredPositionMissing("展区", "地点详情弹窗", logFn);
        return { ok: false, started: false };
    }
    flow.page = "detail";
    var actualSite = findKnownSite(readDetailTitle(scale, logFn));
    if (actualSite !== candidate.site) {
        gameHelper.notifyRequiredPositionMissing("展区", "地点详情标题确认", logFn);
        if (closeCurrentDialog(imgs, gameHelper, logFn) && isTreasurePage(imgs, gameHelper)) flow.page = "treasure";
        else flow.page = "unknown";
        return { ok: false, started: false };
    }
    if (shouldStop()) return { ok: false, started: false };

    var teamBuildPoint = gameHelper.findFirst(imgs.exhibitionTeamBuild, 0.8, "展区组建小队");
    if (!teamBuildPoint) {
        // 没有“组建小队”即为锁定、不可用或该地点当前不可派遣，只关闭详情后尝试下一地点。
        if (!closeCurrentDialog(imgs, gameHelper, logFn)) {
            flow.page = "unknown";
            return { ok: false, started: false };
        }
        if (!isTreasurePage(imgs, gameHelper)) {
            flow.page = "unknown";
            gameHelper.notifyRequiredPositionMissing("展区", "寻宝地图确认", logFn);
            return { ok: false, started: false };
        }
        flow.page = "treasure";
        logFn("[展区] “" + candidate.site + "”当前不可派遣，跳过");
        return { ok: true, started: false };
    }
    clickTemplateCenter(teamBuildPoint, imgs.exhibitionTeamBuild);
    flow.page = "team";
    sleep(800);
    if (shouldStop()) return { ok: false, started: false };

    var addHeroPoint = gameHelper.findFirst(imgs.exhibitionAddHero, 0.8, "展区添加英雄");
    if (!addHeroPoint) {
        gameHelper.notifyRequiredPositionMissing("展区", "添加英雄入口", logFn);
        return { ok: false, started: false };
    }
    clickTemplateCenter(addHeroPoint, imgs.exhibitionAddHero);
    flow.page = "heroSelect";
    sleep(700);
    if (shouldStop()) return { ok: false, started: false };

    var confirmHeroPoint = gameHelper.findFirst(imgs.exhibitionConfirmHero, 0.8, "展区确认英雄");
    if (!confirmHeroPoint) {
        // 现场组队页可能保持“0/3”，此时游戏没有自动勾选推荐英雄；不能把正常的待选人状态误判为模板故障或继续点击未知英雄卡。
        flow.page = "team";
        logFn("[展区] 组建小队页未自动选中英雄，已安全停止本次派遣");
        return { ok: false, started: false };
    }
    // 只有确认按钮实际出现时，才说明游戏已选好英雄，可以继续后续时长和物资校验。
    clickTemplateCenter(confirmHeroPoint, imgs.exhibitionConfirmHero);
    flow.page = "team";
    sleep(700);
    return selectDurationAndStart(imgs, gameHelper, scale, durationHours, flow, shouldStop, logFn);
}

/**
 * 在存在空闲小队槽时按配置地点顺序持续尝试；同一地点在本轮至多调用一次组队流程。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Array<string>} selectedSites 已配置地点。
 * @param {number} durationHours 用户配置的优先时长。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 正常尝试至无空位或候选耗尽时返回 true；页面确认失败时返回 false。
 */
function fillIdleTeams(imgs, gameHelper, scale, selectedSites, durationHours, flow, shouldStop, logFn) {
    if (selectedSites.length === 0) {
        logFn("[展区] 未勾选寻宝地点，仅完成展品和奖励收集");
        return true;
    }
    var attemptedSites = {};
    while (!shouldStop()) {
        var idleSlots = dedupeNearbyPoints(gameHelper.findAll(imgs.exhibitionIdle, 0.8, "展区空闲小队"), scale);
        if (idleSlots.length === 0) {
            logFn("[展区] 当前无空闲小队槽，结束派遣检查");
            return true;
        }

        var scanResult = scanSiteCandidates(imgs, gameHelper, scale, selectedSites, attemptedSites, flow, shouldStop, logFn);
        if (!scanResult.ok) return false;
        if (scanResult.candidates.length === 0) {
            logFn("[展区] 已勾选地点均不可用或本轮已尝试，结束派遣检查");
            return true;
        }

        var candidate = scanResult.candidates[0];
        // 无论锁定、缺物资还是成功出发，这个地点都不在同一轮重复尝试。
        attemptedSites[candidate.site] = true;
        var dispatchResult = tryDispatchSite(imgs, gameHelper, scale, candidate, durationHours, flow, shouldStop, logFn);
        if (!dispatchResult.ok) return false;
    }
    return false;
}

/**
 * 从当前已确认页面安全退出到主界面。奖励层也必须先显示底部关闭提示；探险完成页未确认领奖按钮时不按系统返回，宁可不记录完成时间。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前屏幕缩放比例。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 最终确认主界面时返回 true。
 */
function returnToMainScene(imgs, gameHelper, scale, flow, logFn) {
    if (flow.page === "completion") {
        // 现场证据表明系统返回会弹出“退出游戏吗”，而非返回寻宝地图；不能在结算动画未完成时扩大为退出风险。
        logFn("[展区] 探险完成页未确认领取奖励，未使用系统返回以避免触发退出游戏");
        return false;
    }
    if (flow.page === "rewardOverlay") {
        var rewardTitlePoint = gameHelper.findFirst(imgs.tradePortRewardTitle, 0.8, "展区恭喜获得关闭");
        if (!rewardTitlePoint) return gameHelper.notifyRequiredPositionMissing("展区", "奖励结算页面", logFn);
        // 异常收尾同样不能在奖励列表尚未完成入场时点击关闭区域。
        if (!gameHelper.waitForRewardDismissHint(imgs.rewardDismissHint, null, "展区异常奖励关闭提示")) {
            return gameHelper.notifyRequiredPositionMissing("展区", "奖励关闭提示", logFn);
        }
        // 异常收尾同样只能点击已验证的空白关闭区，不能把标题误当作按钮。
        clickFixedPoint(FIXED_POINTS.rewardDismiss, scale);
        sleep(700);
        flow.page = "treasure";
    }
    if (flow.page === "heroSelect") {
        if (!closeCurrentDialog(imgs, gameHelper, logFn)) return false;
        flow.page = "team";
    }
    if (flow.page === "team") {
        if (!closeCurrentDialog(imgs, gameHelper, logFn)) return false;
        flow.page = "detail";
    }
    if (flow.page === "teamAfterStart") {
        if (!closeCurrentDialog(imgs, gameHelper, logFn)) return false;
        flow.page = "treasure";
    }
    if (flow.page === "detail") {
        if (!closeCurrentDialog(imgs, gameHelper, logFn)) return false;
        flow.page = "treasure";
    }
    if (flow.page === "tradePort") {
        var portClosePoint = gameHelper.findFirst(imgs.tradePortClose, 0.8, "展区贸易港口安全关闭");
        if (!portClosePoint) return gameHelper.notifyRequiredPositionMissing("展区", "贸易港口关闭按钮", logFn);
        clickTemplateCenter(portClosePoint, imgs.tradePortClose);
        sleep(900);
        flow.page = "main";
    }
    if (flow.page === "treasure") {
        if (!isTreasurePage(imgs, gameHelper)) return gameHelper.notifyRequiredPositionMissing("展区", "寻宝地图确认", logFn);
        var treasureBackPoint = gameHelper.findFirst(imgs.exhibitionBack, 0.8, "展区寻宝返回");
        if (!treasureBackPoint) return gameHelper.notifyRequiredPositionMissing("展区", "寻宝返回按钮", logFn);
        clickTemplateCenter(treasureBackPoint, imgs.exhibitionBack);
        sleep(900);
        flow.page = "exhibition";
    }
    if (flow.page === "exhibition") {
        // 展区和寻宝页共用左下角返回样式，但只在已确认展区状态下点击第二次。
        var exhibitionBackPoint = gameHelper.findFirst(imgs.exhibitionBack, 0.8, "展区返回主界面");
        if (!exhibitionBackPoint) return gameHelper.notifyRequiredPositionMissing("展区", "展区返回按钮", logFn);
        clickTemplateCenter(exhibitionBackPoint, imgs.exhibitionBack);
        sleep(1600);
        flow.page = "main";
    }
    if (flow.page !== "main") {
        logFn("[展区] 当前页面未确认，未执行猜测性返回点击");
        return false;
    }
    if (!isMainScene(imgs, gameHelper)) {
        return gameHelper.notifyRequiredPositionMissing("展区", "游戏主界面确认", logFn);
    }
    return true;
}

/**
 * 在异常或中止时尽可能回到已确认主界面，但无论是否成功都不写入冷却完成时间。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前屏幕缩放比例。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} logFn 日志回调。
 */
function failAndReturn(imgs, gameHelper, scale, flow, logFn) {
    if (!returnToMainScene(imgs, gameHelper, scale, flow, logFn)) {
        logFn("[展区] 本轮失败且未能安全确认主界面，未记录完成时间");
    }
}

/**
 * 在已进入游戏流程后归类失败或用户中止，并尽力安全返回主界面。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number}} scale 当前屏幕缩放比例。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {{status: "interrupted"|"failed", waitSeconds: number}} 不中断冷却写入的结果状态。
 */
function finishUncompletedRun(imgs, gameHelper, scale, flow, shouldStop, logFn) {
    var interrupted = shouldStop();
    if (interrupted) logFn("[展区] 收到停止请求，正在安全退出且不记录完成时间");
    failAndReturn(imgs, gameHelper, scale, flow, logFn);
    return { status: interrupted ? "interrupted" : "failed", waitSeconds: interrupted ? 0 : 60 };
}

/**
 * 执行一次展区展品收集与自动寻宝。
 * 冷却期在加载识图工具、截图、OCR 与触屏之前立即返回；只有安全回到主界面后才回调持久化完成时间。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{intervalMinutes: number, lastCompletedAt: number, durationHours: number, sites: Array<string>}} config 当前展区配置。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} uiLog 日志回调。
 * @param {Function} onCompleted 主界面确认后的完成时间持久化回调。
 * @returns {{status: "cooldown"|"completed"|"interrupted"|"failed", waitSeconds: number}} 本轮状态与下一次适合调度的等待秒数。
 */
exhibition.runOnce = function(imgs, config, shouldStop, uiLog, onCompleted) {
    var _log = uiLog || function(message) { log(message); };
    var intervalMinutes = Number(config && config.intervalMinutes);
    var durationHours = Number(config && config.durationHours);
    var selectedSites = normalizeConfiguredSites(config && config.sites);
    if (!isFinite(intervalMinutes) || intervalMinutes <= 0 || !getDurationCandidates(durationHours) || selectedSites === null) {
        _log("[展区] 配置无效，本轮跳过");
        return { status: "failed", waitSeconds: 60 };
    }
    if (shouldStop()) {
        _log("[展区] 收到停止请求，未进入本轮操作");
        return { status: "interrupted", waitSeconds: 0 };
    }

    var now = Date.now();
    var intervalMs = intervalMinutes * 60 * 1000;
    var lastCompletedAt = Number(config.lastCompletedAt) || 0;
    // 冷却判断必须先于 require、截图、OCR 和任何点击，确保总调度重入不会打断正在进行的队伍。
    if (lastCompletedAt && now - lastCompletedAt < intervalMs) {
        var remainingSeconds = Math.max(1, Math.ceil((intervalMs - (now - lastCompletedAt)) / 1000));
        _log("[展区] 冷却中，距下次检查还有 " + Math.ceil(remainingSeconds / 60) + " 分钟");
        return { status: "cooldown", waitSeconds: remainingSeconds };
    }

    if (!hasRequiredImages(imgs)) {
        _log("[展区] 图片资源未加载，本轮跳过");
        return { status: "failed", waitSeconds: 60 };
    }
    var gameHelper = require("./gameHelper.js");
    var scale = getScreenScale(gameHelper);
    if (!scale) {
        _log("[展区] 无法获取真实屏幕分辨率，本轮跳过");
        return { status: "failed", waitSeconds: 60 };
    }
    var flow = { page: "main" };

    try {
        if (!enterAndCloseTradePortAnchor(imgs, gameHelper, flow, shouldStop, _log)) {
            return finishUncompletedRun(imgs, gameHelper, scale, flow, shouldStop, _log);
        }
        if (!enterExhibition(imgs, gameHelper, flow, shouldStop, _log) || !collectExhibitionBubbles(scale, shouldStop, _log)) {
            return finishUncompletedRun(imgs, gameHelper, scale, flow, shouldStop, _log);
        }
        if (!enterTreasurePage(imgs, gameHelper, flow, shouldStop, _log) || !claimCompletedTeams(imgs, gameHelper, scale, flow, shouldStop, _log)) {
            return finishUncompletedRun(imgs, gameHelper, scale, flow, shouldStop, _log);
        }
        if (!fillIdleTeams(imgs, gameHelper, scale, selectedSites, durationHours, flow, shouldStop, _log)) {
            return finishUncompletedRun(imgs, gameHelper, scale, flow, shouldStop, _log);
        }
        // 用户停止时仍应沿已确认页面链路退出，不能因短路判断遗留在组队或寻宝页。
        var returnedToMain = returnToMainScene(imgs, gameHelper, scale, flow, _log);
        if (shouldStop()) {
            _log(returnedToMain ? "[展区] 已安全退出，停止请求不记录完成时间" : "[展区] 停止时未确认主界面，不记录完成时间");
            return { status: "interrupted", waitSeconds: 0 };
        }
        if (!returnedToMain) {
            _log("[展区] 本轮未能安全回到主界面，未记录完成时间");
            return { status: "failed", waitSeconds: 60 };
        }

        var completedAt = Date.now();
        // 只有两次返回和主界面模板均确认成功后才持久化，重启脚本也不会误跳过失败任务。
        if (onCompleted) onCompleted(completedAt);
        _log("[展区] 本轮完成，已安全返回主界面");
        return { status: "completed", waitSeconds: Math.ceil(intervalMs / 1000) };
    } catch (e) {
        _log("[展区] 执行异常：" + e.message);
        return finishUncompletedRun(imgs, gameHelper, scale, flow, shouldStop, _log);
    }
};

module.exports = exhibition;
