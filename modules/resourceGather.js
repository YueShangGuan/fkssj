// resourceGather.js — 资源库存检查与钓鱼、拾荒、打捞流程

var resourceGather = {};

var BASE_WIDTH = 1080;
var BASE_HEIGHT = 2400;
// 奖励标题会早于物品列表完成动画出现；有限等待仅为确认底部关闭提示，超时后不猜测性点击。
var REWARD_CLOSE_HINT_ATTEMPTS = 10;
var REWARD_CLOSE_HINT_RETRY_DELAY_MS = 400;
// “前往”后的资源入口会经过地图转场；只轮询已裁取的入口模板，避免首帧尚未绘制就错误返回主界面。
var COLLECTION_ENTRY_ATTEMPTS = 10;
var COLLECTION_ENTRY_RETRY_DELAY_MS = 400;
// 点击钓鱼入口后必须看到钓鱼页的“甩杆”控件，不能把设施菜单仍停留在屏幕上的状态当作已进入采集。
var FISHING_START_ATTEMPTS = 15;
var FISHING_START_RETRY_DELAY_MS = 400;
// “前往”后的镜头会受设备初始缩放影响；缩小两次后才用同一组设施模板进行有限轮询。
var GATHER_FACILITY_ATTEMPTS = 10;
var GATHER_FACILITY_RETRY_DELAY_MS = 400;
// 三类设施附近会出现外观相似的码头和建筑；阈值高于普通按钮，宁可报告缺位也不能误触其他设施。
var GATHER_FACILITY_THRESHOLD = 0.9;

// 资源储量弹窗固定在 1080×2400 游戏画面内；库存数值区域只包含“当前/上限”，避免 OCR 将资源名称混入数字。
// 坐标已按 2026-10-15 目标设备原始 1080×2400 截图标定，资源行顺序必须和弹窗视觉顺序一致。
var RESOURCE_ROWS = [
    { name: "鱼", group: "fishing", stockRegion: [570, 570, 230, 65], getButton: [902, 671] },
    { name: "塑料", group: "scavenging", stockRegion: [570, 740, 230, 65], getButton: [902, 842] },
    { name: "木材", group: "scavenging", stockRegion: [570, 910, 230, 65], getButton: [902, 1011] },
    { name: "碎布", group: "scavenging", stockRegion: [570, 1080, 230, 65], getButton: [902, 1180] },
    { name: "废金属", group: "salvage", stockRegion: [570, 1250, 230, 65], getButton: [902, 1351] },
    { name: "玻璃", group: "salvage", stockRegion: [570, 1420, 230, 65], getButton: [902, 1520] },
    { name: "海藻", group: "salvage", stockRegion: [570, 1590, 230, 65], getButton: [902, 1689] }
];

var GROUPS = [
    {
        key: "fishing",
        label: "钓鱼",
        actionImage: "gatherFishing",
        facilityName: "钓鱼设施",
        facilityTemplates: [{ imageKey: "gatherFishingFacility", label: "钓鱼设施" }]
    },
    {
        key: "scavenging",
        label: "拾荒",
        actionImage: "gatherScavenging",
        fullReturnImage: "gatherScavengingFullReturn",
        facilityName: "拾荒设施",
        // 拾荒船有两个动画外观；任一稳定模板命中即可进入同一设施。
        facilityTemplates: [
            { imageKey: "gatherScavengingFacilityStateOne", label: "拾荒设施状态一" },
            { imageKey: "gatherScavengingFacilityStateTwo", label: "拾荒设施状态二" }
        ]
    },
    {
        key: "salvage",
        label: "打捞",
        actionImage: "gatherSalvage",
        fullReturnImage: "gatherSalvageFullReturn",
        facilityName: "下潜设施",
        facilityTemplates: [{ imageKey: "gatherSalvageFacility", label: "下潜设施" }]
    }
];

var FIXED_POINTS = {
    // 资源条位于头像下方左侧；右上角头像本身不会打开“资源储量”弹窗。
    resourceEntry: [78, 200],
    resourceClose: [972, 491],
    goButton: [898, 1068],
    // “恭喜获得”已出现底部关闭提示时，此处位于奖励物品与提示文字之间的空白区，不会触及物品或购买入口。
    rewardDismiss: [540, 1800],
    returnButton: [78, 2202]
};

/**
 * 将 1080×2400 基准坐标转换为当前设备的截图坐标。
 * 该换算仅避免状态栏或同纵横比设备造成偏移，识图模板仍必须从目标设备原始截图裁取。
 * @param {Object} gameHelper 游戏公共工具模块。
 * @returns {{x: number, y: number}} 横纵坐标缩放比例。
 */
function getScreenScale(gameHelper) {
    var resolution = gameHelper.getRealResolution();
    return { x: resolution[0] / BASE_WIDTH, y: resolution[1] / BASE_HEIGHT };
}

/**
 * 以当前截图分辨率缩放并点击固定入口。
 * @param {number[]} point 1080×2400 基准坐标。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 */
function clickFixedPoint(point, scale) {
    click(Math.round(point[0] * scale.x), Math.round(point[1] * scale.y));
}

/**
 * 缩放 OCR 区域，确保只读取对应资源行的库存数字。
 * @param {number[]} region 1080×2400 基准区域 [x, y, width, height]。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @returns {number[]} 当前截图的 OCR 区域。
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
 * 读取 OCR 行结果并解析“当前库存/容量”。不能可靠解析时返回 null，避免在错误库存判断下消耗游戏操作。
 * @param {Array} results 当前资源行的 OCR 结果。
 * @returns {{current: number, capacity: number, percent: number}|null} 解析出的库存，或安全失败。
 */
function parseStock(results) {
    if (!results || results.length === 0) return null;
    var sorted = results.slice().sort(function(a, b) {
        var leftA = a.bounds && typeof a.bounds.left === "number" ? a.bounds.left : 0;
        var leftB = b.bounds && typeof b.bounds.left === "number" ? b.bounds.left : 0;
        return leftA - leftB;
    });
    var text = sorted.map(function(item) {
        return String(item.label || "");
    }).join("").replace(/\s/g, "");
    var match = text.match(/(\d+)\s*[\/／]\s*(\d+)/);
    if (!match) return null;

    var current = parseInt(match[1], 10);
    var capacity = parseInt(match[2], 10);
    if (!isFinite(current) || !isFinite(capacity) || current < 0 || capacity <= 0 || current > capacity) return null;
    return { current: current, capacity: capacity, percent: current * 100 / capacity };
}

/**
 * 对资源储量弹窗的七行库存执行区域 OCR。
 * 任意一行无法解析即整体失败，避免把部分识别结果当作完整库存作出采集决策。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} uiLog 日志回调。
 * @returns {Array|null} 带库存的资源行，或 null。
 */
function readAllStocks(scale, uiLog) {
    if (typeof ocr === "undefined" || !ocr.mlkit || typeof ocr.mlkit.detect !== "function") {
        uiLog("[打捞资源] ML Kit OCR 不可用，本轮跳过");
        return null;
    }
    var screen = captureScreen();
    try {
        var stocks = [];
        for (var i = 0; i < RESOURCE_ROWS.length; i++) {
            var row = RESOURCE_ROWS[i];
            var stock = parseStock(ocr.mlkit.detect(screen, scaleRegion(row.stockRegion, scale)));
            if (!stock) {
                uiLog("[打捞资源] 无法识别“" + row.name + "”库存，本轮不采集");
                return null;
            }
            stocks.push({
                name: row.name,
                group: row.group,
                getButton: row.getButton,
                current: stock.current,
                capacity: stock.capacity,
                percent: stock.percent
            });
        }
        return stocks;
    } catch (e) {
        uiLog("[打捞资源] OCR 异常：" + e.message);
        return null;
    } finally {
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 按钓鱼、拾荒、打捞三类合并低库存资源；每类只保留资源列表中最先出现的一项作为“获取”入口。
 * @param {Array} stocks 已完整读取的库存列表。
 * @param {number} thresholdPercent 触发采集的库存百分比阈值。
 * @returns {Array} 需要执行的采集类别及其入口资源。
 */
function selectGroups(stocks, thresholdPercent) {
    var selected = [];
    for (var i = 0; i < GROUPS.length; i++) {
        var group = GROUPS[i];
        var lowStock = null;
        for (var j = 0; j < stocks.length; j++) {
            if (stocks[j].group === group.key && stocks[j].percent < thresholdPercent) {
                lowStock = stocks[j];
                break;
            }
        }
        if (lowStock) selected.push({ group: group, stock: lowStock });
    }
    return selected;
}

/**
 * 在不输出连续“未找到”日志的情况下定位模板，适用于不限时钓鱼的持续状态观察。
 * @param {Object} image 要查找的原始设备截图模板。
 * @param {number} threshold 模板相似度阈值。
 * @returns {{x: number, y: number}|null} 模板左上角坐标。
 */
function findTemplateQuietly(image, threshold) {
    if (!image) return null;
    var screen = captureScreen();
    try {
        var point = images.findImage(screen, image, { threshold: threshold });
        return point ? { x: point.x, y: point.y } : null;
    } finally {
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 等待地图转场后的资源采集入口出现。
 * 转场时不点击任何坐标，只重复识别本轮已经确认需要的入口模板，避免将短暂加载帧当作业务失败。
 * @param {Object} actionImage 钓鱼、拾荒或打捞入口的原始模板。
 * @param {Function} shouldStop 停止标记。
 * @returns {{x: number, y: number}|null} 已出现的入口坐标；超时或停止时返回 null。
 */
function waitForCollectionEntry(actionImage, shouldStop) {
    for (var attempt = 0; attempt < COLLECTION_ENTRY_ATTEMPTS; attempt++) {
        if (shouldStop()) return null;
        var actionPoint = findTemplateQuietly(actionImage, 0.8);
        if (actionPoint) return actionPoint;
        if (attempt < COLLECTION_ENTRY_ATTEMPTS - 1) sleep(COLLECTION_ENTRY_RETRY_DELAY_MS);
    }
    return null;
}

/**
 * 确认点击钓鱼入口后已经进入可操作的钓鱼页面。
 * 设施菜单中的“钓鱼”按钮仍可能可见但点击未被游戏接受；只有钓鱼页的“甩杆”控件出现才允许开始计时。
 * @param {Object} castImage “甩杆”按钮的原始模板。
 * @param {Function} shouldStop 停止标记。
 * @returns {boolean} 已识别到钓鱼页面时返回 true；超时、缺图或停止时返回 false。
 */
function waitForFishingStarted(castImage, shouldStop) {
    if (!castImage) return false;
    for (var attempt = 0; attempt < FISHING_START_ATTEMPTS; attempt++) {
        if (shouldStop()) return false;
        if (findTemplateQuietly(castImage, 0.8)) return true;
        if (attempt < FISHING_START_ATTEMPTS - 1) sleep(FISHING_START_RETRY_DELAY_MS);
    }
    return false;
}

/**
 * 判断本类别是否至少有一张可用的设施模板。
 * 拾荒允许其中一个动画状态模板暂时缺失；其余类别必须存在自己的设施主体，不能退回到白色手势或固定地图坐标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} group 当前资源类别配置。
 * @returns {boolean} 至少存在一张可用于识别的设施模板时返回 true。
 */
function hasGatherFacilityTemplate(imgs, group) {
    var templates = group.facilityTemplates || [];
    for (var i = 0; i < templates.length; i++) {
        if (imgs[templates[i].imageKey]) return true;
    }
    return false;
}

/**
 * 在一张截图中按类别模板识别相似度最高的资源设施。
 * 同一次截图复用给所有候选模板；跨模板选择最高相似度，避免先扫描到的相似码头覆盖真实设施。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} group 当前资源类别配置。
 * @returns {{point: {x: number, y: number}, image: Object, label: string, similarity: number}|null} 匹配到的设施及模板信息；未命中时返回 null。
 */
function findGatherFacility(imgs, group) {
    var templates = group.facilityTemplates || [];
    if (typeof images.matchTemplate !== "function") return null;
    var screen = captureScreen();
    try {
        var bestFacility = null;
        for (var i = 0; i < templates.length; i++) {
            var template = templates[i];
            var image = imgs[template.imageKey];
            if (!image) continue;
            var matchingResult = images.matchTemplate(screen, image, {
                threshold: GATHER_FACILITY_THRESHOLD,
                max: 10
            });
            var matches = matchingResult && matchingResult.matches ? matchingResult.matches : [];
            for (var j = 0; j < matches.length; j++) {
                var match = matches[j];
                if (!bestFacility || match.similarity > bestFacility.similarity) {
                    bestFacility = {
                        point: { x: match.point.x, y: match.point.y },
                        image: image,
                        label: template.label,
                        similarity: match.similarity
                    };
                }
            }
        }
        return bestFacility;
    } finally {
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 等待“前往”后的地图完成缩放并显示本类别设施。
 * 未识别到设施时由调用方报告明确缺位并返回主界面；不再尝试白色手势、相对偏移或历史固定点。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} group 当前资源类别配置。
 * @param {Function} shouldStop 停止标记。
 * @returns {{point: {x: number, y: number}, image: Object, label: string, similarity: number}|null} 已确认的设施及模板信息；超时或停止时返回 null。
 */
function waitForGatherFacility(imgs, group, shouldStop) {
    for (var attempt = 0; attempt < GATHER_FACILITY_ATTEMPTS; attempt++) {
        if (shouldStop()) return null;
        var facility = findGatherFacility(imgs, group);
        if (facility) return facility;
        if (attempt < GATHER_FACILITY_ATTEMPTS - 1) sleep(GATHER_FACILITY_RETRY_DELAY_MS);
    }
    return null;
}

/**
 * 判断当前是否仍处于游戏主界面（基地或世界）。
 * 资源入口和固定返回坐标只在主界面语义明确；其他页面继续按坐标点击会误触该页面的无关功能。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {boolean} 基地或世界导航图标可识别时返回 true。
 */
function isMainScene(imgs) {
    return !!(findTemplateQuietly(imgs.baseIcon, 0.7) || findTemplateQuietly(imgs.worldIcon, 0.7));
}

/**
 * 报告打捞任务因不在主界面而安全跳过。
 * 仅在任务开始前的操作前置条件不满足时提示；库存、按钮和舰队等轮询检测不能弹窗，以免正常检查产生提示骚扰。
 * @param {Function} uiLog 调度器日志回调。
 */
function notifyNotMainScene(uiLog) {
    var message = "[打捞资源] 未在游戏主界面，已跳过本轮";
    uiLog(message);
    if (typeof toast === "function") toast(message);
}

/**
 * 报告采集流程中缺失的强制界面位置。
 * 打捞模块在识别主界面前不能加载公共工具，因此保留本地告警入口；库存、满仓等普通检测结果不会调用它。
 * 缺位发生后调度器仍可能继续检查其他任务，系统 Toast 会遮住主界面模板，因此只写结构化告警而不弹出覆盖层。
 * @param {string} positionName 未识别到的位置名称。
 * @param {Function} uiLog 调度器日志回调。
 * @returns {false} 恒为 false，供安全失败分支直接返回。
 */
function notifyRequiredPositionMissing(positionName, uiLog) {
    var message = "[打捞资源] 未识别到必要位置“" + positionName + "”，本轮已停止操作";
    if (typeof uiLog === "function" && typeof uiLog.appendWarning === "function") uiLog.appendWarning(message);
    else uiLog(message);
    return false;
}

/**
 * 点击已定位到的功能按钮中心。
 * @param {{x: number, y: number}} point 模板左上角坐标。
 * @param {Object} image 已加载的按钮模板。
 */
function clickTemplateCenter(point, image) {
    click(Math.round(point.x + image.getWidth() / 2), Math.round(point.y + image.getHeight() / 2));
}

/**
 * 点击资源行的“获取”并进入对应的钓鱼、拾荒或打捞界面。
 * “前往”后先双指缩小两次统一地图比例，再识别并点击设施模板中心，避免镜头比例差异或白色引导手势遮挡目标。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{group: Object, stock: Object}} selection 当前采集类别。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} uiLog 日志回调。
 * @param {boolean} isResourceWindowOpen 当前资源储量弹窗是否由库存 OCR 保持打开。
 * @param {Object} gameHelper 游戏公共工具，用于沿用种植流程展示设施识别框。
 * @returns {{entered: boolean, shouldContinue: boolean, unconfirmedEntry?: boolean}} 是否已点击采集入口，以及后续是否可继续等待；入口界面未确认时标记为 true。
 */
function enterCollection(imgs, selection, scale, shouldStop, uiLog, isResourceWindowOpen, gameHelper) {
    var actionImage = imgs[selection.group.actionImage];
    if (!isResourceWindowOpen) {
        // 后续分类已从采集场景返回主界面，必须重新打开资源窗才能点击对应“获取”。
        clickFixedPoint(FIXED_POINTS.resourceEntry, scale);
        sleep(1200);
    }
    if (shouldStop()) {
        clickFixedPoint(FIXED_POINTS.resourceClose, scale);
        return { entered: false, shouldContinue: false };
    }

    clickFixedPoint(selection.stock.getButton, scale);
    uiLog("[打捞资源] “" + selection.stock.name + "”低于阈值，进入" + selection.group.label);
    sleep(1000);
    if (shouldStop()) return { entered: false, shouldContinue: false };

    clickFixedPoint(FIXED_POINTS.goButton, scale);
    sleep(3000);
    if (shouldStop()) return { entered: false, shouldContinue: false };

    // 复用种植的两次捏合逻辑，使不同初始镜头的设施保持与现场模板一致的缩放级别。
    require("./navigate.js").pinchZoomOut(uiLog);
    if (shouldStop()) return { entered: false, shouldContinue: false };

    var facility = waitForGatherFacility(imgs, selection.group, shouldStop);
    if (shouldStop()) return { entered: false, shouldContinue: false };
    if (!facility) {
        notifyRequiredPositionMissing(selection.group.facilityName, uiLog);
        // “前往”已离开基地时只允许使用当前流程已验证的返回键，不能以旧地图坐标继续猜测设施位置。
        if (!isMainScene(imgs)) clickFixedPoint(FIXED_POINTS.returnButton, scale);
        return { entered: false, shouldContinue: false };
    }
    // 与种植土地识别一致，先用同一张命中模板绘制非触控绿色框，再点击其中心，便于现场核对实际识别目标。
    gameHelper.showOverlay(facility.point, facility.image);
    clickTemplateCenter(facility.point, facility.image);
    var facilityCenterX = Math.round(facility.point.x + facility.image.getWidth() / 2);
    var facilityCenterY = Math.round(facility.point.y + facility.image.getHeight() / 2);
    var facilitySimilarity = typeof facility.similarity === "number" ? facility.similarity.toFixed(3) : "未知";
    // 记录模板、分数和中心点，现场日志可区分识图漏检、相似建筑误匹配与点击后入口未出现三类问题。
    uiLog(
        "[打捞资源] 已识别并点击" + selection.group.facilityName
        + "（模板: " + facility.label + "；相似度: " + facilitySimilarity
        + "；中心: " + facilityCenterX + "," + facilityCenterY + "）"
    );
    sleep(800);
    var actionPoint = waitForCollectionEntry(actionImage, shouldStop);
    if (shouldStop()) return { entered: false, shouldContinue: false };
    if (!actionPoint) {
        notifyRequiredPositionMissing(selection.group.label + "入口", uiLog);
        // 已离开基地而未找到入口时也要回退，避免下轮重试从地图页误点资源条。
        // 满仓无收获时游戏可能已经自动回到主界面；此时继续点固定坐标会落在主界面其他控件上。
        if (!isMainScene(imgs)) clickFixedPoint(FIXED_POINTS.returnButton, scale);
        // 设施菜单会保留基地/世界图标，单靠主界面图标无法证明菜单已关闭；通知调度器暂停本轮，不能带着该菜单继续其他任务。
        return { entered: false, shouldContinue: false, unconfirmedEntry: true };
    }
    clickTemplateCenter(actionPoint, actionImage);
    if (selection.group.key === "fishing") {
        uiLog("[打捞资源] 已点击钓鱼入口，等待确认钓鱼页面");
        if (!waitForFishingStarted(imgs.gatherCast, shouldStop)) {
            notifyRequiredPositionMissing("钓鱼开始状态", uiLog);
            // 入口按钮可能因点击失效仍停在设施菜单；交给调度器阻断本轮，不能直接进入固定时长等待。
            return { entered: false, shouldContinue: false, unconfirmedEntry: true };
        }
        uiLog("[打捞资源] 已确认进入钓鱼页面");
    }
    sleep(1000);
    return { entered: true, shouldContinue: !shouldStop() };
}

/**
 * 在一次退出点击后使用已有基地/世界图标确认已回到游戏主界面。
 * 左下角通用返回与满仓专属返航都必须共用该确认，避免视觉状态尚未切换就继续下一类采集。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} uiLog 日志回调。
 * @returns {boolean} 是否确认已回到主界面。
 */
function confirmMainScene(imgs, uiLog) {
    sleep(1800);
    if (!isMainScene(imgs)) {
        notifyRequiredPositionMissing("主界面确认", uiLog);
        return false;
    }
    return true;
}

/**
 * 从采集界面点击左下角返回，并确认已回到游戏主界面。
 * 固定时长的打捞有收获时会经过“恭喜获得”结算层，满仓且本轮无收获时则直接回到主界面。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} uiLog 日志回调。
 * @returns {boolean} 是否确认已回到主界面。
 */
function returnToMainScene(imgs, scale, uiLog) {
    // 打捞满仓且本轮无收获时，游戏会自行直返主界面；不得再点击旧采集页的固定返回坐标。
    if (isMainScene(imgs)) {
        uiLog("[打捞资源] 已自动回到主界面，不再点击固定返回坐标");
        return true;
    }
    clickFixedPoint(FIXED_POINTS.returnButton, scale);
    sleep(1200);
    // 奖励结算层不是每次都会出现；未出现时必须继续验证主界面，而不是将其视作失败。
    dismissRewardIfShown(imgs, scale);
    return confirmMainScene(imgs, uiLog);
}

/**
 * 等待“恭喜获得”结算层底部出现关闭提示。
 * 长奖励列表的标题会先显示，只有提示文字出现时空白区域才可关闭，不能直接用标题作为就绪信号。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {boolean} 底部关闭提示出现时返回 true；超时或缺图时返回 false。
 */
function waitForRewardDismissHint(imgs) {
    if (!imgs.rewardDismissHint) return false;
    for (var attempt = 0; attempt < REWARD_CLOSE_HINT_ATTEMPTS; attempt++) {
        if (findTemplateQuietly(imgs.rewardDismissHint, 0.8)) return true;
        if (attempt < REWARD_CLOSE_HINT_ATTEMPTS - 1) sleep(REWARD_CLOSE_HINT_RETRY_DELAY_MS);
    }
    return false;
}

/**
 * 若出现则关闭“恭喜获得”结算层。
 * 打捞有收获和贸易港口共用该全屏奖励样式；只有底部关闭提示出现时才点击现场确认的空白区，避免动画期间无效点击或误触奖励物品。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @returns {boolean} 是否找到并关闭结算层。
 */
function dismissRewardIfShown(imgs, scale) {
    var rewardTitlePoint = findTemplateQuietly(imgs.tradePortRewardTitle, 0.8);
    if (!rewardTitlePoint) return false;
    // 奖励提示文本出现前，游戏不会响应关闭点击；保留弹层以便下轮安全重试。
    if (!waitForRewardDismissHint(imgs)) return false;
    // 标题只用于确认当前确为奖励层；游戏要求点击物品下方的空白区才会真正关闭。
    clickFixedPoint(FIXED_POINTS.rewardDismiss, scale);
    sleep(700);
    return true;
}

/**
 * 点击满仓画面专属的“返航（全部满仓）”按钮，并确认游戏已经离开采集界面。
 * 该按钮会先展示“恭喜获得”结算层，关闭结算层后才可检查主界面。
 * @param {{x: number, y: number}} point 满仓返航按钮模板左上角坐标。
 * @param {Object} fullReturnImage 已加载的满仓返航按钮模板。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} uiLog 日志回调。
 * @returns {boolean} 是否确认已回到主界面。
 */
function returnFromFullWarehouse(point, fullReturnImage, imgs, scale, uiLog) {
    clickTemplateCenter(point, fullReturnImage);
    sleep(1200);
    if (!dismissRewardIfShown(imgs, scale)) {
        notifyRequiredPositionMissing("满仓结算页面", uiLog);
        return false;
    }
    return confirmMainScene(imgs, uiLog);
}

/**
 * 在指定分钟内保持采集界面，停止请求会在当前秒级等待边界后返回。
 * @param {number} minutes 本类别采集时长，单位分钟。
 * @param {Function} shouldStop 停止标记。
 * @returns {boolean} 是否自然计时结束。
 */
function waitFixedDuration(minutes, shouldStop) {
    var endAt = Date.now() + minutes * 60 * 1000;
    while (!shouldStop() && Date.now() < endAt) sleep(1000);
    return !shouldStop();
}

/**
 * 等待钓鱼界面出现并持续保留“甩杆”图标，再做一次独立复核。
 * 每轮钓鱼间隙会短暂闪现该图标；只有满仓后图标会长期存在，故不能以单次或单段可见状态直接退出。
 * @param {Object} castImage “甩杆”按钮模板。
 * @param {Function} shouldStop 停止标记。
 * @returns {boolean} 是否检测到稳定的甩杆状态。
 */
function waitForStableCast(castImage, shouldStop) {
    // 使用 null 表示未开始观察，不能用 0，因为时间戳 0 也可能是合法测试/运行时间。
    var firstSeenAt = null;
    while (!shouldStop()) {
        if (findTemplateQuietly(castImage, 0.8)) {
            if (firstSeenAt === null) firstSeenAt = Date.now();
            if (Date.now() - firstSeenAt >= 3000) {
                // 三秒持续可见后再隔一秒复核，过滤普通钓鱼流程中短暂闪现的“甩杆”按钮。
                sleep(1000);
                if (!shouldStop() && findTemplateQuietly(castImage, 0.8)) return true;
                firstSeenAt = null;
                continue;
            }
        } else {
            firstSeenAt = null;
        }
        sleep(1000);
    }
    return false;
}

/**
 * 等待拾荒或打捞出现满仓返航按钮。
 * 资源满仓时游戏展示专属且持续可见的绿色返航按钮，可作为不限时模式的唯一安全退出信号。
 * @param {Object} fullReturnImage 满仓返航按钮模板。
 * @param {Function} shouldStop 停止标记。
 * @returns {{x: number, y: number}|null} 按钮模板坐标；停止前未出现时返回 null。
 */
function waitForFullWarehouse(fullReturnImage, shouldStop) {
    while (!shouldStop()) {
        var point = findTemplateQuietly(fullReturnImage, 0.8);
        if (point) return point;
        sleep(1000);
    }
    return null;
}

/**
 * 执行一个已选中的采集类别，并始终在退出前请求回到主界面。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{group: Object, stock: Object}} selection 当前采集类别。
 * @param {number|null} durationMinutes 单类别固定时长；null 代表不限时。
 * @param {{x: number, y: number}} scale 当前缩放比例。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} uiLog 日志回调。
 * @param {boolean} isResourceWindowOpen 当前资源储量弹窗是否仍可直接点击“获取”。
 * @param {Object} gameHelper 游戏公共工具，向设施进入流程传递绿色框绘制能力。
 * @returns {{completed: boolean, resourceWindowOpen: boolean, unconfirmedEntry?: boolean}} 当前类别完成状态、资源弹窗是否仍需调用方关闭及入口界面是否未确认。
 */
function runCollectionGroup(imgs, selection, durationMinutes, scale, shouldStop, uiLog, isResourceWindowOpen, gameHelper) {
    var fullReturnImage = selection.group.fullReturnImage ? imgs[selection.group.fullReturnImage] : null;
    if (durationMinutes === null && selection.group.key !== "fishing" && !fullReturnImage) {
        // 拾荒和打捞必须以各自的满仓返航按钮判断结束，不能用钓鱼的“甩杆”或固定时长代替。
        uiLog("[打捞资源] 不限时时跳过“" + selection.group.label + "”，等待补充满仓返航模板");
        return { completed: true, resourceWindowOpen: isResourceWindowOpen };
    }
    // 在进入本类采集流程前确认模板已就绪，缺图时由调用方按当前弹窗状态安全收起。
    if (!imgs[selection.group.actionImage]) {
        uiLog("[打捞资源] 缺少“" + selection.group.label + "”原始截图模板，本轮不执行");
        return { completed: false, resourceWindowOpen: isResourceWindowOpen };
    }
    if (!hasGatherFacilityTemplate(imgs, selection.group)) {
        uiLog("[打捞资源] 缺少“" + selection.group.facilityName + "”原始截图模板，本轮不执行");
        return { completed: false, resourceWindowOpen: isResourceWindowOpen };
    }
    if (selection.group.key === "fishing" && !imgs.gatherCast) {
        // 固定时长与不限时钓鱼都以“甩杆”确认真正进入钓鱼页，缺图时不能盲等并把设施菜单留在前台。
        uiLog("[打捞资源] 缺少“甩杆”模板，无法确认钓鱼已开始");
        return { completed: false, resourceWindowOpen: isResourceWindowOpen };
    }
    var entryResult = enterCollection(imgs, selection, scale, shouldStop, uiLog, isResourceWindowOpen, gameHelper);
    if (!entryResult.entered) {
        // 把设施菜单未确认状态继续上传给总调度，避免它仅凭残留的主界面图标切换到下一个任务。
        return { completed: false, resourceWindowOpen: false, unconfirmedEntry: !!entryResult.unconfirmedEntry };
    }

    var fullReturnPoint = null;
    var finished = false;
    if (entryResult.shouldContinue) {
        if (durationMinutes !== null) {
            finished = waitFixedDuration(durationMinutes, shouldStop);
        } else if (selection.group.key === "fishing") {
            finished = waitForStableCast(imgs.gatherCast, shouldStop);
        } else {
            fullReturnPoint = waitForFullWarehouse(fullReturnImage, shouldStop);
            finished = !!fullReturnPoint;
        }
    }
    var returned = fullReturnPoint
        ? returnFromFullWarehouse(fullReturnPoint, fullReturnImage, imgs, scale, uiLog)
        : returnToMainScene(imgs, scale, uiLog);
    return { completed: finished && returned, resourceWindowOpen: false };
}

/**
 * 执行一次资源库存检查和必要的分类采集。
 * 冷却时间由总调度会话传入，不持久化到配置；冷却期会直接返回且不会截图、OCR 或点击。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{intervalMinutes: number, thresholdPercent: number, durationMinutes: number|null, lastCompletedAt: number}} config 当前任务配置及会话内完成时间。
 * @param {Function} shouldStop 停止标记。
 * @param {Function} uiLog 日志回调。
 * @returns {"cooldown"|"completed"|"failed"|"unconfirmed"} 本次执行状态；unconfirmed 表示设施点击后的入口界面未确认。
 */
resourceGather.runOnce = function(imgs, config, shouldStop, uiLog) {
    var _log = uiLog || function(msg) { log(msg); };
    var intervalMinutes = Number(config.intervalMinutes);
    var thresholdPercent = Number(config.thresholdPercent);
    var durationMinutes = config.durationMinutes === null || config.durationMinutes === "" ? null : Number(config.durationMinutes);
    if (!isFinite(intervalMinutes) || intervalMinutes <= 0 || !isFinite(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 100 || (durationMinutes !== null && (!isFinite(durationMinutes) || durationMinutes <= 0))) {
        _log("[打捞资源] 配置无效，本轮跳过");
        return "failed";
    }

    var now = Date.now();
    var intervalMs = intervalMinutes * 60 * 1000;
    if (config.lastCompletedAt && now - config.lastCompletedAt < intervalMs) return "cooldown";

    // 资源储量入口使用固定坐标，只有主界面才有稳定业务含义；未知页面必须完全不触屏。
    if (!isMainScene(imgs)) {
        notifyNotMainScene(_log);
        return "failed";
    }

    var gameHelper = require("./gameHelper.js");
    var scale = getScreenScale(gameHelper);
    clickFixedPoint(FIXED_POINTS.resourceEntry, scale);
    sleep(1200);
    if (shouldStop()) {
        clickFixedPoint(FIXED_POINTS.resourceClose, scale);
        return "failed";
    }

    var stocks = readAllStocks(scale, _log);
    if (!stocks) {
        clickFixedPoint(FIXED_POINTS.resourceClose, scale);
        return "failed";
    }
    var selectedGroups = selectGroups(stocks, thresholdPercent);
    // OCR 已确认首个低库存分类的“获取”行，保留弹窗可直接进入该分类，避免一次无意义的关闭和重开。
    var resourceWindowOpen = selectedGroups.length > 0;
    if (!resourceWindowOpen) {
        clickFixedPoint(FIXED_POINTS.resourceClose, scale);
        sleep(800);
    }

    for (var i = 0; i < selectedGroups.length; i++) {
        if (shouldStop()) {
            // 首个分类尚未离开资源窗时收到停止请求，必须主动关闭，不能把弹窗遗留给下一轮调度。
            if (resourceWindowOpen) clickFixedPoint(FIXED_POINTS.resourceClose, scale);
            return "failed";
        }
        var groupResult = runCollectionGroup(imgs, selectedGroups[i], durationMinutes, scale, shouldStop, _log, resourceWindowOpen, gameHelper);
        resourceWindowOpen = groupResult.resourceWindowOpen;
        if (!groupResult.completed) {
            // 模板前置校验失败时尚未点击“获取”，资源窗仍在；其余失败分支已离开或自行关闭该弹窗。
            if (resourceWindowOpen) clickFixedPoint(FIXED_POINTS.resourceClose, scale);
            // 设施点击后可能仍停留在弹出菜单；该状态必须由调度器阻断剩余任务，不能与普通前置校验失败混为一谈。
            return groupResult.unconfirmedEntry ? "unconfirmed" : "failed";
        }
    }
    // 不限时缺少满仓模板的分类会安全跳过且未离开资源窗，循环结束时统一收起它。
    if (resourceWindowOpen) {
        clickFixedPoint(FIXED_POINTS.resourceClose, scale);
        sleep(800);
    }
    _log(selectedGroups.length ? "[打捞资源] 本轮采集结束" : "[打捞资源] 库存均不低于阈值，本轮结束");
    return "completed";
};

module.exports = resourceGather;
