// intelligence.js — 联盟情报领奖、派遣与安全返回

var intelligence = {};

var MAX_REWARD_CLAIMS = 20;
var MAX_DISPATCHES = 20;
// 气泡按蓝、紫、橙等级换色，使用灰度模板后保留略低阈值并由亮色像素二次确认。
var BUBBLE_MATCH_THRESHOLD = 0.78;
var COMPLETED_CHECK_MATCH_THRESHOLD = 0.8;
// 完成勾模板裁掉了外圈，勾的左上角相对气泡中心固定在右上方；点击偏移回气泡主体可复用游戏原有点击区域。
var COMPLETED_BUBBLE_CLICK_OFFSET_X = -10;
var COMPLETED_BUBBLE_CLICK_OFFSET_Y = 95;
// 事件动作模板本身来自详情页原图，保持原有严格阈值，避免未知页面误点相似按钮。
var EVENT_ACTION_MATCH_THRESHOLD = 0.8;
// “前往”后的地图定位动画没有固定完成时刻，短轮询以实际事件按钮为准，不能再以世界页基地图标猜测状态。
var EVENT_ACTION_WAIT_ATTEMPTS = 12;
var EVENT_ACTION_WAIT_INTERVAL_MS = 500;
// 选中气泡后按钮会随详情卡入场；必须等到稳定按钮模板出现再点击，不能只查一次。
var GO_BUTTON_WAIT_ATTEMPTS = 6;
var GO_BUTTON_WAIT_INTERVAL_MS = 400;
// 整点商船驻守可能长期占用全部舰队；连续十次、每次 30 秒未自动勾选时，本轮应安全跳过情报而非无限停留在弹窗。
var FLEET_IDLE_POLL_INTERVAL_MS = 30000;
var FLEET_IDLE_MAX_POLL_COUNT = 10;
// 从基地切换世界时会出现不可预测的加载页；只等待已确认的基地图标，超时后仍按安全失败退出。
var WORLD_SCENE_WAIT_ATTEMPTS = 10;
var WORLD_SCENE_WAIT_INTERVAL_MS = 400;
// “恭喜获得”层必须点击物品和底部提示之间的空白区关闭，标题只用于确认弹层已出现。
var REWARD_EMPTY_CLOSE_POINT = [540, 1800];

// 事件图标覆盖当前情报地图可出现的气泡；不同等级换色由灰度匹配统一处理。
var BUBBLE_TEMPLATES = [
    { key: "intelligenceBubbleChest", label: "宝箱气泡" },
    { key: "intelligenceBubbleFlag", label: "旗帜气泡" },
    { key: "intelligenceBubbleTools", label: "工具气泡" },
    { key: "intelligenceBubbleAttack", label: "攻击气泡" },
    { key: "intelligenceBubbleLightning", label: "闪电气泡" },
    { key: "intelligenceBubbleSalvage", label: "打捞气泡" },
    { key: "intelligenceBubbleRescue", label: "救助气泡" }
];

// 定位后只允许点击已确认的事件动作，未知页面或未知动作一律停止。
var EVENT_ACTION_TEMPLATES = [
    { key: "intelligenceEventSalvage", label: "打捞" },
    { key: "intelligenceEventAttack", label: "攻击" },
    // “解救”和“救助”分别对应不同事件，虽然业务含义接近，仍必须以各自文字模板确认后才点击。
    { key: "intelligenceEventRescue", label: "解救" },
    { key: "intelligenceEventAid", label: "救助" },
    { key: "intelligenceEventExplore", label: "探查" },
    { key: "intelligenceEventOccupy", label: "占领" },
    { key: "intelligenceEventCollect", label: "征收" }
];

/**
 * 点击已确认模板的中心，避免将模板左上角误触到气泡边框或按钮阴影。
 * @param {{x: number, y: number}} point 模板左上角坐标。
 * @param {Object} image 已加载的模板图片。
 */
function clickTemplateCenter(point, image) {
    click(
        Math.round(point.x + image.getWidth() / 2),
        Math.round(point.y + image.getHeight() / 2)
    );
}

/**
 * 将模板匹配结果按视觉阅读顺序排列，使多气泡派遣不依赖 matchTemplate 的返回顺序。
 * @param {Array<Object>} points 坐标或候选对象集合。
 * @returns {Array<Object>} 新的从上到下、从左到右排序结果。
 */
function sortTopToBottom(points) {
    return (points || []).slice().sort(function(a, b) {
        return a.y === b.y ? a.x - b.x : a.y - b.y;
    });
}

/**
 * 计算模板候选的视觉中心，用于跨模板去重与记录已处理气泡。
 * @param {{x: number, y: number, image: Object}} candidate 气泡模板匹配结果。
 * @returns {{x: number, y: number}} 气泡中心坐标。
 */
function getCandidateCenter(candidate) {
    return {
        x: Math.round(candidate.x + candidate.image.getWidth() / 2),
        y: Math.round(candidate.y + candidate.image.getHeight() / 2)
    };
}

/**
 * 合并不同气泡模板对同一地图气泡的重复匹配，保留稳定的第一个候选。
 * @param {Array<Object>} candidates 原始气泡匹配结果。
 * @returns {Array<Object>} 已按视觉顺序去重的候选集合。
 */
function dedupeBubbleCandidates(candidates) {
    var result = [];
    var sorted = sortTopToBottom(candidates);
    for (var i = 0; i < sorted.length; i++) {
        var center = getCandidateCenter(sorted[i]);
        var duplicated = false;
        for (var j = 0; j < result.length; j++) {
            var existingCenter = getCandidateCenter(result[j]);
            // 同一气泡的图标模板左上角最多会因裁图边缘相差几十像素，不能重复点击它。
            if (Math.abs(center.x - existingCenter.x) < 70 && Math.abs(center.y - existingCenter.y) < 70) {
                duplicated = true;
                break;
            }
        }
        if (!duplicated) result.push(sorted[i]);
    }
    return result;
}

/**
 * 合并同一完成勾在模板匹配边缘产生的相邻结果，避免一次领奖对同一情报重复点击。
 * @param {Array<{x: number, y: number}>} points 原始完成勾位置。
 * @param {number} minimumDistance 同一勾允许的最大坐标偏差。
 * @returns {Array<{x: number, y: number}>} 按视觉顺序去重后的完成勾位置。
 */
function dedupeNearbyPoints(points, minimumDistance) {
    var result = [];
    var sorted = sortTopToBottom(points);
    for (var i = 0; i < sorted.length; i++) {
        var duplicated = false;
        for (var j = 0; j < result.length; j++) {
            if (Math.abs(sorted[i].x - result[j].x) < minimumDistance &&
                Math.abs(sorted[i].y - result[j].y) < minimumDistance) {
                duplicated = true;
                break;
            }
        }
        if (!duplicated) result.push(sorted[i]);
    }
    return result;
}

/**
 * 检查情报任务全部模板是否可用。缺失任一状态模板时不以固定坐标猜测页面或按钮。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {boolean} 所有必需模板均已加载时返回 true。
 */
function hasRequiredImages(imgs) {
    var required = [
        "baseIcon", "worldIcon", "tradePortRewardTitle", "rewardDismissHint", "fleetChecked", "fleetDispatch",
        "intelligenceEntry", "intelligenceTitle", "intelligenceCompletedCheck", "intelligenceDimBubble",
        "intelligenceGo", "intelligenceBack", "intelligenceFleetClose"
    ];
    var i;
    for (i = 0; i < BUBBLE_TEMPLATES.length; i++) required.push(BUBBLE_TEMPLATES[i].key);
    for (i = 0; i < EVENT_ACTION_TEMPLATES.length; i++) required.push(EVENT_ACTION_TEMPLATES[i].key);
    for (i = 0; i < required.length; i++) {
        if (!imgs || !imgs[required[i]]) return false;
    }
    return true;
}

/**
 * 读取指定区域的颜色样本；无法使用截图像素 API 时返回 null，让模板验证仍可安全运行。
 * @param {{x: number, y: number}} point 区域左上角。
 * @param {Object} image 对应模板图片。
 * @param {Function} predicate RGB 颜色是否满足目标状态的判定函数。
 * @param {number} minMatches 至少需要满足条件的样本数。
 * @returns {boolean|null} 满足、未满足或当前环境不支持像素校验。
 */
function hasExpectedColor(point, image, predicate, minMatches) {
    if (typeof captureScreen !== "function" || typeof images === "undefined" || typeof images.pixel !== "function") return null;
    var screen = captureScreen();
    if (!screen) return null;
    var width = image.getWidth();
    var height = image.getHeight();
    var found = 0;
    try {
        // 只抽取模板内部网格，避免外部地图、白色文字或阴影影响情报状态判断。
        for (var row = 1; row <= 6; row++) {
            for (var column = 1; column <= 6; column++) {
                var px = Math.round(point.x + width * column / 7);
                var py = Math.round(point.y + height * row / 7);
                var color = Number(images.pixel(screen, px, py));
                var red = (color >>> 16) & 255;
                var green = (color >>> 8) & 255;
                var blue = color & 255;
                if (predicate(red, green, blue)) {
                    found++;
                    if (found >= minMatches) return true;
                }
            }
        }
        return false;
    } finally {
        if (screen && typeof screen.recycle === "function") screen.recycle();
    }
}

/**
 * 确认气泡仍为正常亮色。亮色图标必须同时具有足够亮度和色彩跨度，浅色进行中气泡不满足该条件。
 * @param {{x: number, y: number, image: Object}} candidate 待处理气泡。
 * @returns {boolean|null} 亮色、非亮色或无法读取像素。
 */
function isBrightBubble(candidate) {
    return hasExpectedColor(candidate, candidate.image, function(red, green, blue) {
        var maximum = Math.max(red, green, blue);
        var minimum = Math.min(red, green, blue);
        return maximum >= 175 && maximum - minimum >= 75;
    }, 4);
}

/**
 * 确认完成勾内确有绿色像素，防止白色边框或地图装饰被误认为可领奖状态。
 * @param {{x: number, y: number}} point 完成勾模板左上角。
 * @param {Object} image 完成勾模板。
 * @returns {boolean|null} 绿色、非绿色或无法读取像素。
 */
function isGreenCompletionMark(point, image) {
    return hasExpectedColor(point, image, function(red, green, blue) {
        return green >= 120 && green - red >= 25 && green - blue >= 10;
    }, 2);
}

/**
 * 在一个气泡右上角局部识别完成勾，并通过绿色像素二次确认。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number, image: Object}} candidate 待检查气泡。
 * @returns {boolean} 该气泡是可领取的已完成情报时返回 true。
 */
function hasCompletedCheckNear(imgs, gameHelper, candidate) {
    var width = candidate.image.getWidth();
    var height = candidate.image.getHeight();
    var point = gameHelper.findFirstInRegionInGrayscale(
        imgs.intelligenceCompletedCheck,
        Math.max(0, Math.round(candidate.x + width * 0.45)),
        Math.max(0, Math.round(candidate.y - height * 0.25)),
        Math.round(width * 0.78),
        Math.round(height * 0.70),
        COMPLETED_CHECK_MATCH_THRESHOLD,
        "情报完成勾"
    );
    if (!point) return false;
    var green = isGreenCompletionMark(point, imgs.intelligenceCompletedCheck);
    return green === null || green;
}

/**
 * 判断候选是否为正在进行的浅色气泡。颜色校验失败时宁可跳过，也不对可能已派遣的舰队重复下令。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number, image: Object}} candidate 待检查气泡。
 * @returns {boolean} 浅色进行中状态时返回 true。
 */
function isDimBubble(imgs, gameHelper, candidate) {
    // 浅色状态的专用模板只在当前气泡小范围内查询，避免屏幕上其他进行中任务影响本气泡。
    var dimPoint = gameHelper.findFirstInRegion(
        imgs.intelligenceDimBubble,
        Math.max(0, candidate.x - 10),
        Math.max(0, candidate.y - 10),
        candidate.image.getWidth() + 20,
        candidate.image.getHeight() + 20,
        0.76,
        "情报进行中气泡"
    );
    var bright = isBrightBubble(candidate);
    if (dimPoint) {
        // 专用模板命中后仍须反查亮色像素，避免相似图标被错误跳过而漏掉可派遣情报。
        return bright !== true;
    }
    if (bright === true) return false;

    // 若像素 API 可用但亮色不成立，仍按进行中/未知状态跳过，避免误派已在路上的舰队。
    return bright === false;
}

/**
 * 收集当前情报页可见的全部事件气泡，并合并同一气泡的多模板匹配。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {Array<Object>} 稳定排序且去重后的气泡候选。
 */
function collectBubbleCandidates(imgs, gameHelper) {
    var candidates = [];
    for (var i = 0; i < BUBBLE_TEMPLATES.length; i++) {
        var template = BUBBLE_TEMPLATES[i];
        var points = gameHelper.findAllInGrayscale(imgs[template.key], BUBBLE_MATCH_THRESHOLD, "情报" + template.label);
        for (var j = 0; j < points.length; j++) {
            candidates.push({ x: points[j].x, y: points[j].y, image: imgs[template.key], label: template.label });
        }
    }
    return dedupeBubbleCandidates(candidates);
}

/**
 * 扫描全屏全部绿色完成勾。先以灰度忽略状态图标的颜色差异，再以绿色像素确认领奖语义；领奖不能依赖被勾覆盖的普通气泡模板先命中。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {Array<{x: number, y: number}>} 按视觉顺序排列的有效完成勾。
 */
function findCompletedRewardMarks(imgs, gameHelper) {
    var rawPoints = gameHelper.findAllInGrayscale(
        imgs.intelligenceCompletedCheck,
        COMPLETED_CHECK_MATCH_THRESHOLD,
        "情报完成勾"
    ) || [];
    var greenPoints = [];
    for (var i = 0; i < rawPoints.length; i++) {
        // 灰度模板只负责忽略颜色差异并定位；仍须确认绿色，避免白色图案或地图装饰被当成已完成状态。
        var green = isGreenCompletionMark(rawPoints[i], imgs.intelligenceCompletedCheck);
        if (green === true) greenPoints.push(rawPoints[i]);
    }
    return dedupeNearbyPoints(greenPoints, 40);
}

/**
 * 从完成勾位置换算回对应气泡主体的点击点，避免点击勾的装饰层而未触发领奖详情。
 * @param {{x: number, y: number}} mark 完成勾裁剪模板的左上角位置。
 * @returns {{x: number, y: number}} 对应情报气泡主体中心附近的点击点。
 */
function getCompletedBubbleClickPoint(mark) {
    return {
        x: Math.round(mark.x + COMPLETED_BUBBLE_CLICK_OFFSET_X),
        y: Math.round(mark.y + COMPLETED_BUBBLE_CLICK_OFFSET_Y)
    };
}

/**
 * 检查候选是否已在本轮成功派遣，防止出征动画尚未完全切换时重复派遣同一坐标。
 * @param {{x: number, y: number, image: Object}} candidate 当前候选气泡。
 * @param {Array<Object>} attempted 已派遣气泡中心集合。
 * @returns {boolean} 已在本轮处理过时返回 true。
 */
function wasAttempted(candidate, attempted) {
    var center = getCandidateCenter(candidate);
    for (var i = 0; i < attempted.length; i++) {
        if (Math.abs(center.x - attempted[i].x) < 70 && Math.abs(center.y - attempted[i].y) < 70) return true;
    }
    return false;
}

/**
 * 领取当前页面全部带绿色勾的已完成情报。每次领奖后都必须确认底部关闭提示、关闭“恭喜获得”层并重新确认情报页。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 所有可见完成奖励均已领取时返回 true。
 */
function claimCompletedRewards(imgs, gameHelper, flow, shouldStop, logFn) {
    for (var i = 0; i < MAX_REWARD_CLAIMS && !shouldStop(); i++) {
        var completedMarks = findCompletedRewardMarks(imgs, gameHelper);
        if (!completedMarks.length) return true;

        // 绿色勾位于气泡右上角；每次只点击它关联的气泡主体，绝不触碰页面底部的月卡“一键领取”入口。
        var rewardBubblePoint = getCompletedBubbleClickPoint(completedMarks[0]);
        click(rewardBubblePoint.x, rewardBubblePoint.y);
        logFn("[情报] 领取带绿色勾的已完成奖励（" + (i + 1) + "）");
        flow.page = "reward";
        sleep(900);
        if (shouldStop()) return false;

        var rewardTitle = gameHelper.findFirst(imgs.tradePortRewardTitle, 0.8, "情报恭喜获得");
        if (!rewardTitle) {
            gameHelper.notifyRequiredPositionMissing("情报", "奖励结算页面", logFn);
            return false;
        }
        // “恭喜获得”标题会早于奖励物品动画出现；只有底部提示出现后才允许关闭。
        if (!gameHelper.waitForRewardDismissHint(imgs.rewardDismissHint, shouldStop, "情报奖励关闭提示")) {
            if (!shouldStop()) gameHelper.notifyRequiredPositionMissing("情报", "奖励关闭提示", logFn);
            return false;
        }
        // 标题只确认奖励层存在；游戏要求点击物品与底部提示之间的空白区关闭，不能触碰奖励物品。
        click(REWARD_EMPTY_CLOSE_POINT[0], REWARD_EMPTY_CLOSE_POINT[1]);
        sleep(800);
        if (!isIntelligencePage(imgs, gameHelper)) {
            gameHelper.notifyRequiredPositionMissing("情报", "联盟情报页面确认", logFn);
            flow.page = "unknown";
            return false;
        }
        flow.page = "intelligence";
    }
    if (!shouldStop()) logFn("[情报] 完成勾数量超过安全上限，未继续重复领取");
    return false;
}

/**
 * 从可见气泡中选出首个可派遣的正常亮色气泡；完成勾、浅色进行中和本轮已派遣均会跳过。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Array<Object>} attempted 本轮已派遣气泡中心集合。
 * @param {Function} logFn 日志回调。
 * @returns {Object|null} 可派遣候选；没有可派遣气泡时返回 null。
 */
function selectNextDispatchCandidate(imgs, gameHelper, attempted, logFn) {
    var candidates = collectBubbleCandidates(imgs, gameHelper);
    for (var i = 0; i < candidates.length; i++) {
        if (wasAttempted(candidates[i], attempted)) continue;
        if (hasCompletedCheckNear(imgs, gameHelper, candidates[i])) continue;
        if (isDimBubble(imgs, gameHelper, candidates[i])) {
            logFn("[情报] 跳过浅色进行中气泡");
            continue;
        }
        return candidates[i];
    }
    return null;
}

/**
 * 判断当前画面是否为世界主界面。世界界面必须能识别到“基地”图标，不能只凭上一页状态推断。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {boolean} 已确认世界主界面时返回 true。
 */
function isWorldScene(imgs, gameHelper) {
    return !!gameHelper.findFirst(imgs.baseIcon, 0.8, "情报世界主界面基地");
}

/**
 * 等待基地图标出现以确认世界主界面加载完成。
 * 页面转场期间不补点世界入口或底部导航，避免把加载帧误判为失败后误触其他页面。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Function} shouldStop 停止标记。
 * @returns {boolean} 已确认世界主界面时返回 true；超时或停止时返回 false。
 */
function waitForWorldScene(imgs, gameHelper, shouldStop) {
    for (var attempt = 0; attempt < WORLD_SCENE_WAIT_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (isWorldScene(imgs, gameHelper)) return true;
        if (attempt < WORLD_SCENE_WAIT_ATTEMPTS - 1) sleep(WORLD_SCENE_WAIT_INTERVAL_MS);
    }
    return false;
}

/**
 * 判断当前画面是否为用户基地主界面。基地界面必须能识别到“世界”图标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {boolean} 已确认基地主界面时返回 true。
 */
function isBaseScene(imgs, gameHelper) {
    return !!gameHelper.findFirst(imgs.worldIcon, 0.8, "情报基地主界面世界");
}

/**
 * 判断当前是否为联盟情报页。所有气泡识别前先确认标题，避免在其他地图误点相似图标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {boolean} 已确认联盟情报标题时返回 true。
 */
function isIntelligencePage(imgs, gameHelper) {
    return !!gameHelper.findFirst(imgs.intelligenceTitle, 0.8, "联盟情报标题");
}

/**
 * 在世界事件详情中定位一项已知事件动作。动作按钮本身才是“前往”完成后的可靠页面标识，事件弹窗不会显示世界页的基地图标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {{template: Object, point: {x: number, y: number}}|null} 已识别动作及其位置；未知页面时返回 null。
 */
function findKnownEventAction(imgs, gameHelper) {
    for (var i = 0; i < EVENT_ACTION_TEMPLATES.length; i++) {
        var template = EVENT_ACTION_TEMPLATES[i];
        var point = gameHelper.findFirst(imgs[template.key], EVENT_ACTION_MATCH_THRESHOLD, "情报事件" + template.label);
        if (point) return { template: template, point: point };
    }
    return null;
}

/**
 * 等待选中情报详情的“前往”按钮完成入场。模板仅包含稳定按钮主体，避免地图背景变化把已显示按钮判为缺失。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Function} shouldStop 停止标记。
 * @returns {{x: number, y: number}|null} 已稳定定位到的按钮位置；超时或停止时返回 null。
 */
function findGoButton(imgs, gameHelper, shouldStop) {
    for (var attempt = 0; attempt < GO_BUTTON_WAIT_ATTEMPTS && !shouldStop(); attempt++) {
        var point = gameHelper.findFirst(imgs.intelligenceGo, 0.8, "情报前往");
        if (point) return point;
        if (attempt < GO_BUTTON_WAIT_ATTEMPTS - 1) sleep(GO_BUTTON_WAIT_INTERVAL_MS);
    }
    // 调用方需要先确认是否仍停在情报地图，避免把候选点击未生效误判为按钮模板缺失。
    return null;
}

/**
 * 从基地或世界安全进入世界界面。未知页面不会尝试点击底部导航。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认世界主界面时返回 true。
 */
function ensureWorldScene(imgs, gameHelper, flow, shouldStop, logFn) {
    if (isWorldScene(imgs, gameHelper)) {
        flow.page = "world";
        return true;
    }
    var worldPoint = gameHelper.findFirst(imgs.worldIcon, 0.8, "情报切换世界");
    if (!worldPoint) {
        gameHelper.notifyRequiredPositionMissing("情报", "基地或世界主界面", logFn);
        return false;
    }
    flow.page = "base";
    clickTemplateCenter(worldPoint, imgs.worldIcon);
    if (!waitForWorldScene(imgs, gameHelper, shouldStop)) {
        if (shouldStop()) return false;
        gameHelper.notifyRequiredPositionMissing("情报", "世界主界面确认", logFn);
        flow.page = "unknown";
        return false;
    }
    flow.page = "world";
    return true;
}

/**
 * 从已确认世界界面打开联盟情报，并确认标题后才允许扫描气泡。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认进入情报页面时返回 true。
 */
function enterIntelligencePage(imgs, gameHelper, flow, shouldStop, logFn) {
    if (!isWorldScene(imgs, gameHelper)) {
        gameHelper.notifyRequiredPositionMissing("情报", "世界主界面", logFn);
        return false;
    }
    var entry = gameHelper.findFirst(imgs.intelligenceEntry, 0.8, "联盟情报入口");
    if (!entry) {
        gameHelper.notifyRequiredPositionMissing("情报", "联盟情报入口", logFn);
        return false;
    }
    clickTemplateCenter(entry, imgs.intelligenceEntry);
    flow.page = "intelligence";
    sleep(1300);
    if (shouldStop()) return false;
    if (!isIntelligencePage(imgs, gameHelper)) {
        gameHelper.notifyRequiredPositionMissing("情报", "联盟情报标题", logFn);
        flow.page = "unknown";
        return false;
    }
    return true;
}

/**
 * 进入或恢复联盟情报页。上轮在“前往”前中断时用户可能仍停在情报详情卡，重启后应确认标题并继续，而非要求用户先手动回到基地。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认在联盟情报页时返回 true。
 */
function enterOrResumeIntelligencePage(imgs, gameHelper, flow, shouldStop, logFn) {
    if (isIntelligencePage(imgs, gameHelper)) {
        // 当前情报页的标题仍可见时，直接复用该页面，优先处理遗留的绿色完成勾。
        flow.page = "intelligence";
        logFn("[情报] 检测到已有联盟情报页面，继续本页流程");
        return true;
    }
    return ensureWorldScene(imgs, gameHelper, flow, shouldStop, logFn) &&
        enterIntelligencePage(imgs, gameHelper, flow, shouldStop, logFn);
}

/**
 * 点击正常气泡后使用“前往”定位事件。事件弹窗没有世界页的基地图标，必须以六类动作按钮确认页面已加载。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {{x: number, y: number, image: Object}} candidate 正常亮色气泡。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {{template: Object, point: {x: number, y: number}}|{skipped: true}|null} 已定位到的事件动作；仍在情报地图时跳过候选；超时、停止或未知页面时返回 null。
 */
function goToCandidateEvent(imgs, gameHelper, candidate, flow, shouldStop, logFn) {
    clickTemplateCenter(candidate, candidate.image);
    flow.page = "candidate";
    sleep(800);
    if (shouldStop()) return false;

    var goPoint = findGoButton(imgs, gameHelper, shouldStop);
    if (!goPoint) {
        if (!shouldStop() && isIntelligencePage(imgs, gameHelper)) {
            var center = getCandidateCenter(candidate);
            // 六次有限轮询后仍留在情报地图说明本次点击未打开详情；跳过该候选以继续检查其他气泡，但本轮不能记为完成。
            logFn("[情报] 气泡未打开详情，跳过候选：" + (candidate.label || "未命名气泡") + "（" + center.x + ", " + center.y + "）");
            flow.page = "intelligence";
            return { skipped: true };
        }
        if (!shouldStop()) {
            gameHelper.notifyRequiredPositionMissing("情报", "前往按钮", logFn);
            flow.page = "unknown";
        }
        return null;
    }
    clickTemplateCenter(goPoint, imgs.intelligenceGo);
    flow.page = "world";
    for (var attempt = 0; attempt < EVENT_ACTION_WAIT_ATTEMPTS && !shouldStop(); attempt++) {
        var eventAction = findKnownEventAction(imgs, gameHelper);
        if (eventAction) {
            flow.page = "event";
            return eventAction;
        }
        if (attempt < EVENT_ACTION_WAIT_ATTEMPTS - 1) sleep(EVENT_ACTION_WAIT_INTERVAL_MS);
    }
    if (!shouldStop()) {
        gameHelper.notifyRequiredPositionMissing("情报", "事件动作按钮", logFn);
        flow.page = "unknown";
    }
    return null;
}

/**
 * 在世界事件详情中识别六种已知动作之一，并打开舰队选择弹窗。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @param {{template: Object, point: {x: number, y: number}}} eventAction 已在前往后确认的事件动作。
 * @returns {boolean} 已确认舰队选择弹窗时返回 true。
 */
function openFleetDialogForEvent(imgs, gameHelper, flow, shouldStop, logFn, eventAction) {
    if (!eventAction) {
        gameHelper.notifyRequiredPositionMissing("情报", "事件动作按钮", logFn);
        return false;
    }
    clickTemplateCenter(eventAction.point, imgs[eventAction.template.key]);
    flow.page = "fleetDialog";
    logFn("[情报] 点击事件按钮：" + eventAction.template.label);
    sleep(1200);
    if (shouldStop()) return false;
    if (!gameHelper.findFirst(imgs.intelligenceFleetClose, 0.8, "情报舰队弹窗关闭")) {
        gameHelper.notifyRequiredPositionMissing("情报", "舰队选择弹窗", logFn);
        flow.page = "unknown";
        return false;
    }
    return true;
}

/**
 * 在舰队选择页等待游戏自动勾选空闲舰队。绝不调用“勾选全部”；连续五分钟无空闲舰队时，让调用方安全关闭弹窗并跳过本轮情报。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {boolean|string} 已确认默认勾选、点击出征并回到世界主界面时返回 true；五分钟无空闲舰队时返回 noIdleFleet。
 */
function waitForDefaultFleetAndDispatch(imgs, gameHelper, flow, shouldStop, logFn) {
    var idleFleetPollCount = 0;
    while (!shouldStop()) {
        var selected = gameHelper.findFirst(imgs.fleetChecked, 0.82, "情报已勾选舰队");
        if (selected) {
            var dispatch = gameHelper.findFirst(imgs.fleetDispatch, 0.8, "情报出征");
            if (!dispatch) {
                gameHelper.notifyRequiredPositionMissing("情报", "出征按钮", logFn);
                return false;
            }
            // 仅在游戏已自动勾选一个舰队后出征，避免脚本替用户改动舰队组合。
            clickTemplateCenter(dispatch, imgs.fleetDispatch);
            logFn("[情报] 检测到已勾选舰队，点击出征");
            flow.page = "world";
            sleep(1500);
            if (shouldStop()) return false;
            if (!isWorldScene(imgs, gameHelper)) {
                gameHelper.notifyRequiredPositionMissing("情报", "出征后世界主界面", logFn);
                flow.page = "unknown";
                return false;
            }
            return true;
        }

        // 自动勾选状态可能恰好在用户点击停止后才刷新；此时立即交给安全退出，不再额外等待 30 秒。
        if (shouldStop()) return false;

        // 弹窗消失意味着状态无法确认；不能在未知画面继续等或误点。
        if (!gameHelper.findFirst(imgs.intelligenceFleetClose, 0.8, "情报舰队弹窗仍在")) {
            gameHelper.notifyRequiredPositionMissing("情报", "舰队选择弹窗", logFn);
            flow.page = "unknown";
            return false;
        }
        if (idleFleetPollCount >= FLEET_IDLE_MAX_POLL_COUNT) {
            // 商船驻守会让游戏持续不勾选任何舰队，不能一直占用弹窗或把该正常状态误报为模板故障。
            logFn("[情报] 连续 5 分钟未等到空闲舰队，可能正在整点商船驻守；本轮跳过情报，下一轮再试");
            return "noIdleFleet";
        }
        idleFleetPollCount++;
        logFn("[情报] 所有舰队忙碌，保留选择页，30 秒后检查自动勾选状态（" + idleFleetPollCount + "/" + FLEET_IDLE_MAX_POLL_COUNT + "）");
        sleep(FLEET_IDLE_POLL_INTERVAL_MS);
    }
    return false;
}

/**
 * 从已确认状态安全返回用户基地。无法识别的页面不做猜测性点击，完成时间也不会写入。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} logFn 日志回调。
 * @returns {boolean} 已确认返回用户基地主界面时返回 true。
 */
function returnToBaseScene(imgs, gameHelper, flow, logFn) {
    if (flow.page === "reward") {
        var rewardTitle = gameHelper.findFirst(imgs.tradePortRewardTitle, 0.8, "情报异常奖励层关闭");
        if (!rewardTitle) return gameHelper.notifyRequiredPositionMissing("情报", "奖励结算页面", logFn);
        // 失败收尾也要等到奖励弹层可关闭，避免留下覆盖情报页的半入场动画。
        if (!gameHelper.waitForRewardDismissHint(imgs.rewardDismissHint, null, "情报异常奖励关闭提示")) {
            return gameHelper.notifyRequiredPositionMissing("情报", "奖励关闭提示", logFn);
        }
        // 异常收尾仍使用已验证的空白关闭区，避免标题点击留下遮挡情报页的奖励层。
        click(REWARD_EMPTY_CLOSE_POINT[0], REWARD_EMPTY_CLOSE_POINT[1]);
        sleep(700);
        if (!isIntelligencePage(imgs, gameHelper)) return gameHelper.notifyRequiredPositionMissing("情报", "联盟情报页面确认", logFn);
        flow.page = "intelligence";
    }
    if (flow.page === "fleetDialog") {
        var fleetClose = gameHelper.findFirst(imgs.intelligenceFleetClose, 0.8, "情报舰队弹窗关闭");
        if (!fleetClose) return gameHelper.notifyRequiredPositionMissing("情报", "舰队弹窗关闭按钮", logFn);
        // 停止或失败时只关闭已确认的舰队弹窗，不改动任意舰队勾选状态。
        clickTemplateCenter(fleetClose, imgs.intelligenceFleetClose);
        sleep(900);
        if (!isWorldScene(imgs, gameHelper)) return gameHelper.notifyRequiredPositionMissing("情报", "世界主界面确认", logFn);
        flow.page = "world";
    }
    if (flow.page === "intelligence") {
        if (!isIntelligencePage(imgs, gameHelper)) return gameHelper.notifyRequiredPositionMissing("情报", "联盟情报页面确认", logFn);
        var backPoint = gameHelper.findFirst(imgs.intelligenceBack, 0.8, "情报返回世界");
        if (!backPoint) return gameHelper.notifyRequiredPositionMissing("情报", "情报返回按钮", logFn);
        clickTemplateCenter(backPoint, imgs.intelligenceBack);
        sleep(1200);
        if (!isWorldScene(imgs, gameHelper)) return gameHelper.notifyRequiredPositionMissing("情报", "世界主界面确认", logFn);
        flow.page = "world";
    }
    if (flow.page === "base") return isBaseScene(imgs, gameHelper);
    if (flow.page !== "world") {
        logFn("[情报] 当前页面未确认，未执行猜测性返回");
        return false;
    }

    var basePoint = gameHelper.findFirst(imgs.baseIcon, 0.8, "情报返回基地");
    if (!basePoint) return gameHelper.notifyRequiredPositionMissing("情报", "基地入口", logFn);
    clickTemplateCenter(basePoint, imgs.baseIcon);
    sleep(2500);
    flow.page = "base";
    if (!isBaseScene(imgs, gameHelper)) {
        return gameHelper.notifyRequiredPositionMissing("情报", "基地主界面确认", logFn);
    }
    return true;
}

/**
 * 在失败或用户停止后尽量沿已确认页面状态退出；无论退出是否成功均不记录完成时间。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @param {Object} flow 当前已确认的页面状态。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} logFn 日志回调。
 * @returns {{status: "interrupted"|"failed", waitSeconds: number}} 不会触发冷却写入的结果。
 */
function finishUncompletedRun(imgs, gameHelper, flow, shouldStop, logFn) {
    var interrupted = shouldStop();
    if (interrupted) logFn("[情报] 收到停止请求，正在安全退出且不记录完成时间");
    if (!returnToBaseScene(imgs, gameHelper, flow, logFn)) {
        logFn("[情报] 本轮未能安全确认基地，未记录完成时间");
    }
    return { status: interrupted ? "interrupted" : "failed", waitSeconds: interrupted ? 0 : 30 };
}

/**
 * 执行一次联盟情报任务：先领取全部完成奖励，再按视觉顺序派遣正常亮色气泡，最后确认回到基地才记录完成时间。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{intervalHours: number, lastCompletedAt: number}} config 小时级完成后间隔与上次安全完成时间。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} uiLog 日志回调。
 * @param {Function} onCompleted 仅在安全回到基地后的完成时间持久化回调。
 * @returns {{status: "cooldown"|"completed"|"interrupted"|"skipped"|"failed", waitSeconds: number}} 本轮状态和建议等待秒数。
 */
intelligence.runOnce = function(imgs, config, shouldStop, uiLog, onCompleted) {
    var _log = uiLog || function(message) { log(message); };
    var stopRequested = shouldStop || function() { return false; };
    var intervalHours = Number(config && config.intervalHours);
    var lastCompletedAt = Number(config && config.lastCompletedAt) || 0;
    if (!isFinite(intervalHours) || intervalHours <= 0) {
        _log("[情报] 配置无效，本轮跳过");
        return { status: "failed", waitSeconds: 30 };
    }
    if (stopRequested()) {
        _log("[情报] 收到停止请求，未进入本轮操作");
        return { status: "interrupted", waitSeconds: 0 };
    }

    var intervalMs = intervalHours * 60 * 60 * 1000;
    var now = Date.now();
    // 冷却必须早于 require、截图和任何触屏；总调度并行启用其他任务时可无副作用地跳过情报。
    if (lastCompletedAt && now - lastCompletedAt < intervalMs) {
        var remainingSeconds = Math.max(1, Math.ceil((intervalMs - (now - lastCompletedAt)) / 1000));
        _log("[情报] 冷却中，距下次检查还有 " + Math.ceil(remainingSeconds / 3600) + " 小时");
        return { status: "cooldown", waitSeconds: remainingSeconds };
    }
    if (!hasRequiredImages(imgs)) {
        _log("[情报] 图片资源未加载，本轮跳过");
        return { status: "failed", waitSeconds: 30 };
    }

    var gameHelper = require("./gameHelper.js");
    var flow = { page: "unknown" };
    var attempted = [];
    var skippedCandidateCount = 0;
    try {
        if (!enterOrResumeIntelligencePage(imgs, gameHelper, flow, stopRequested, _log) ||
            !claimCompletedRewards(imgs, gameHelper, flow, stopRequested, _log)) {
            return finishUncompletedRun(imgs, gameHelper, flow, stopRequested, _log);
        }

        for (var i = 0; i < MAX_DISPATCHES && !stopRequested(); i++) {
            var candidate = selectNextDispatchCandidate(imgs, gameHelper, attempted, _log);
            if (!candidate) {
                var returnedToBase = returnToBaseScene(imgs, gameHelper, flow, _log);
                if (stopRequested()) {
                    _log(returnedToBase ? "[情报] 已安全退出，停止请求不记录完成时间" : "[情报] 停止时未确认基地，不记录完成时间");
                    return { status: "interrupted", waitSeconds: 0 };
                }
                if (!returnedToBase) {
                    _log("[情报] 未能安全回到基地，未记录完成时间");
                    return { status: "failed", waitSeconds: 30 };
                }
                if (skippedCandidateCount > 0) {
                    // 有候选未进入详情时不能把其余气泡处理完成误记为整轮完成，保留冷却起点以便下轮重新核验。
                    _log("[情报] 有 " + skippedCandidateCount + " 个气泡未打开详情，未记录完成时间");
                    return { status: "failed", waitSeconds: 30 };
                }
                var completedAt = Date.now();
                // 只有奖励层已关闭、可派遣气泡已处理且基地模板已确认后才持久化冷却起点。
                if (onCompleted) onCompleted(completedAt);
                _log("[情报] 本轮完成，已安全返回基地");
                return { status: "completed", waitSeconds: Math.ceil(intervalMs / 1000) };
            }

            attempted.push(getCandidateCenter(candidate));
            _log("[情报] 派遣正常亮色气泡（" + (i + 1) + "）");
            var eventAction = goToCandidateEvent(imgs, gameHelper, candidate, flow, stopRequested, _log);
            if (eventAction && eventAction.skipped) {
                skippedCandidateCount++;
                continue;
            }
            if (!eventAction ||
                !openFleetDialogForEvent(imgs, gameHelper, flow, stopRequested, _log, eventAction)) {
                return finishUncompletedRun(imgs, gameHelper, flow, stopRequested, _log);
            }
            var fleetDispatchResult = waitForDefaultFleetAndDispatch(imgs, gameHelper, flow, stopRequested, _log);
            if (fleetDispatchResult === "noIdleFleet") {
                // 仅在已确认舰队弹窗仍打开时收尾，避免为等待商船空档而写入情报冷却时间。
                if (!returnToBaseScene(imgs, gameHelper, flow, _log)) {
                    _log("[情报] 舰队忙碌后未能安全回到基地，未记录完成时间");
                    return { status: "failed", waitSeconds: 30 };
                }
                _log("[情报] 舰队可能驻守，本轮已安全跳过，下一轮重新检查");
                return { status: "skipped", waitSeconds: 0 };
            }
            if (fleetDispatchResult !== true ||
                !enterIntelligencePage(imgs, gameHelper, flow, stopRequested, _log)) {
                return finishUncompletedRun(imgs, gameHelper, flow, stopRequested, _log);
            }
        }
        if (!stopRequested()) _log("[情报] 正常气泡超过安全上限，未写入完成时间");
        return finishUncompletedRun(imgs, gameHelper, flow, stopRequested, _log);
    } catch (e) {
        _log("[情报] 执行异常：" + e.message);
        return finishUncompletedRun(imgs, gameHelper, flow, stopRequested, _log);
    }
};

module.exports = intelligence;
