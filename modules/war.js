// war.js — 城战任务：按舰队独立选择城镇、出征与钻石加速

var war = {};
var gh = require("./gameHelper.js");

var FLEET_COUNT = 3;
var CITY_OCR_WIDTH = 320;
var CITY_OCR_HEIGHT = 170;
var SPEED_TITLE_REGION = [180, 800, 720, 180];
var SPEED_TIME_REGION = [180, 1000, 720, 210];
var SPEED_DIALOG_TITLE = "加速完成";
var FLEET_DIALOG_WAIT_ATTEMPTS = 8;
var FLEET_DIALOG_WAIT_INTERVAL_MS = 400;
var WORLD_FLEET_STRIPS = [
    { left: 0.01, width: 0.13 },
    { left: 0.14, width: 0.13 },
    { left: 0.27, width: 0.13 }
];
// 仅记住当前脚本进程中的一段倒计时；舰队重新空闲时才允许新的维修/行军再加速一次。
var acceleratedSegments = { repair: [false, false, false], march: [false, false, false] };

/**
 * 按需加载城战专用模板，避免共享图片清单的无关任务资源缺失时阻断城战启动。
 * @param {Object} imgs 总调度器已加载的图片资源。
 * @param {Function} _log 城战日志回调。
 * @returns {boolean} 两张本轮必要模板均已加载时返回 true。
 */
function ensureWarImages(imgs, _log) {
    if (imgs.warFleetCombat && imgs.warDiamondSpeedUp) return true;
    if (typeof images === "undefined" || typeof images.read !== "function") {
        _log("[城战] 缺少城战模板加载环境，本轮停止操作");
        return false;
    }
    try {
        // 交战标记与钻石按钮仅在城战流程使用，按需读取可避免影响其他任务的模板依赖。
        if (!imgs.warFleetCombat) imgs.warFleetCombat = images.read("./img/盟战/舰队交战中.png");
        if (!imgs.warDiamondSpeedUp) imgs.warDiamondSpeedUp = images.read("./img/盟战/钻石加速.png");
        return !!imgs.warFleetCombat && !!imgs.warDiamondSpeedUp;
    } catch (e) {
        _log("[城战] 加载交战或钻石加速模板失败：" + (e && e.message ? e.message : String(e)));
        return false;
    }
}

/**
 * 规范化用户设置或 OCR 读取到的城镇坐标。
 * @param {string} value 坐标原文。
 * @returns {string} 合法的 F6 形式坐标；空值或非法格式返回空字符串。
 */
function normalizeCityTarget(value) {
    var target = String(value || "").replace(/\s/g, "").toUpperCase();
    return /^[A-Z][0-9]+$/.test(target) ? target : "";
}

/**
 * 读取某支舰队的独立计划。集结与进攻、防守同属当前舰队配置，旧全局模式不参与流程。
 * @param {Array<Object>} plans 面板保存的舰队计划。
 * @param {number} index 从 0 开始的舰队索引。
 * @returns {{mode: "attack"|"defend"|"rally", target: string, repairAccelerate: boolean, marchAccelerate: boolean}|null} 有效计划。
 */
function readPlan(plans, index) {
    var plan = Array.isArray(plans) ? plans[index] : null;
    if (!plan || (plan.mode !== "attack" && plan.mode !== "defend" && plan.mode !== "rally")) return null;
    var rawTarget = String(plan.target || "").replace(/\s/g, "");
    var target = normalizeCityTarget(rawTarget);
    // 非空的损坏值不能误当成空目标而自动派往别的城镇。
    if (rawTarget && !target) return null;
    return {
        mode: plan.mode,
        target: target,
        repairAccelerate: plan.repairAccelerate === true,
        marchAccelerate: plan.marchAccelerate === true
    };
}

/**
 * 返回进攻或防守城镇卡使用的识图模板。
 * @param {Object} imgs 已加载的图片资源。
 * @param {"attack"|"defend"} mode 当前舰队模式。
 * @returns {{image: Object, label: string}|null} 模式描述；模板缺失时返回 null。
 */
function getModeDescriptor(imgs, mode) {
    if (mode === "attack" && imgs.fortAttack) return { image: imgs.fortAttack, label: "进攻" };
    if (mode === "defend" && imgs.fortDefend) return { image: imgs.fortDefend, label: "防守" };
    return null;
}

/**
 * 去除同一城镇卡的重复匹配，并固定为左侧列表从上至下的业务顺序。
 * @param {Array<{x: number, y: number}>} points 原始模板匹配点。
 * @returns {Array<{x: number, y: number}>} 每个城镇的唯一锚点。
 */
function sortCityPoints(points) {
    var sorted = (points || []).slice().sort(function(a, b) { return a.y - b.y; });
    var result = [];
    for (var i = 0; i < sorted.length; i++) {
        if (!result.length || Math.abs(sorted[i].y - result[result.length - 1].y) > 36) result.push(sorted[i]);
    }
    return result;
}

/**
 * 读取固定区域的 ML Kit OCR 文字。目标城镇与钻石消耗均不能只用坐标推测。
 * @param {Array<number>} region OCR 区域 [x, y, width, height]。
 * @param {Function} _log 城战日志回调。
 * @param {string} stage 当前 OCR 的业务步骤。
 * @returns {{ok: boolean, text: string}} 识别成功时返回拼接文本。
 */
function readOcrText(region, _log, stage) {
    if (typeof ocr === "undefined" || !ocr.mlkit || typeof ocr.mlkit.detect !== "function" || typeof captureScreen !== "function") {
        _log("[城战] " + stage + "需要 ML Kit OCR，本轮停止操作");
        return { ok: false, text: "" };
    }
    var screen = null;
    try {
        screen = captureScreen();
        var results = ocr.mlkit.detect(screen, region) || [];
        var text = results.slice().sort(function(a, b) {
            var topA = a.bounds && typeof a.bounds.top === "number" ? a.bounds.top : 0;
            var topB = b.bounds && typeof b.bounds.top === "number" ? b.bounds.top : 0;
            if (topA !== topB) return topA - topB;
            var leftA = a.bounds && typeof a.bounds.left === "number" ? a.bounds.left : 0;
            var leftB = b.bounds && typeof b.bounds.left === "number" ? b.bounds.left : 0;
            return leftA - leftB;
        }).map(function(item) {
            return String(item.label || "");
        }).join("");
        return { ok: true, text: text };
    } catch (e) {
        _log("[城战] " + stage + " OCR 异常：" + (e && e.message ? e.message : String(e)));
        return { ok: false, text: "" };
    } finally {
        // 每轮都重新截图；及时释放临时 Bitmap，避免活动时间内持续增长内存。
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
}

/**
 * 识别城镇卡附近的 F6 等坐标。未读到坐标不能作为“目标不存在”的依据。
 * @param {{x: number, y: number}} point 城镇卡模板锚点。
 * @param {Function} _log 城战日志回调。
 * @returns {{ok: boolean, target: string}} 坐标识别状态。
 */
function readCityTarget(point, _log) {
    var read = readOcrText([
        0,
        Math.max(0, Math.floor(point.y - 52)),
        CITY_OCR_WIDTH,
        CITY_OCR_HEIGHT
    ], _log, "城镇坐标");
    if (!read.ok) return { ok: false, target: "" };
    var matches = String(read.text || "").toUpperCase().match(/[A-Z]\s*[0-9]+/g);
    var target = matches && matches.length ? normalizeCityTarget(matches[matches.length - 1]) : "";
    return target ? { ok: true, target: target } : { ok: false, target: "" };
}

/**
 * 扫描一个攻防城镇列表。目标为空直接取首项；有目标时必须完整 OCR 扫描，不能把无法识别当成目标缺失。
 * @param {Object} imgs 已加载的图片资源。
 * @param {"attack"|"defend"} mode 要扫描的城镇类型。
 * @param {string} target 优先城镇坐标。
 * @param {Function} _log 城战日志回调。
 * @returns {{status: "selected"|"empty"|"missing"|"failed", point?: Object, descriptor?: Object}} 扫描结果。
 */
function scanCityList(imgs, mode, target, _log) {
    var descriptor = getModeDescriptor(imgs, mode);
    if (!descriptor) {
        gh.notifyRequiredPositionMissing("城战", mode === "attack" ? "进攻城镇模板" : "防守城镇模板", _log);
        return { status: "failed" };
    }
    var points = sortCityPoints(gh.findAll(descriptor.image, 0.76, descriptor.label + "城镇"));
    if (!points.length) return { status: "empty" };
    if (!target) return { status: "selected", point: points[0], descriptor: descriptor };

    for (var i = 0; i < points.length; i++) {
        var city = readCityTarget(points[i], _log);
        if (!city.ok) {
            _log("[城战] 无法确认" + descriptor.label + "列表第 " + (i + 1) + " 个坐标，本轮停止操作");
            return { status: "failed" };
        }
        if (city.target === target) return { status: "selected", point: points[i], descriptor: descriptor };
    }
    return { status: "missing", point: points[0], descriptor: descriptor };
}

/**
 * 选择指定类型的普通城镇。目标缺失只在该列表的全部坐标均已 OCR 确认后，才回退其首项。
 * @param {Object} imgs 已加载的图片资源。
 * @param {"attack"|"defend"} mode 当前舰队模式。
 * @param {string} target 优先城镇坐标。
 * @param {Function} _log 城战日志回调。
 * @returns {{status: "selected"|"skip"|"failed", point?: Object, descriptor?: Object}} 城镇选择结果。
 */
function chooseNormalCity(imgs, mode, target, _log) {
    var city = scanCityList(imgs, mode, target, _log);
    if (city.status === "empty") {
        _log("[城战] 未发现可用" + (mode === "attack" ? "进攻" : "防守") + "城镇，跳过该舰队");
        return { status: "skip" };
    }
    if (city.status === "missing") {
        // 同类列表已完整 OCR 且未命中目标，才允许使用其首个可用城镇。
        _log("[城战] " + city.descriptor.label + "列表没有目标 " + target + "，回退到首个可用城镇");
        return { status: "selected", point: city.point, descriptor: city.descriptor };
    }
    return city;
}

/**
 * 集结入口缺失时按进攻、再防守查找城镇。坐标目标需在两个列表都完成 OCR 后才允许回退首项。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{target: string}} plan 当前舰队集结计划。
 * @param {Function} _log 城战日志回调。
 * @returns {{status: "selected"|"skip"|"failed", point?: Object, descriptor?: Object}} 集结或回退城镇选择结果。
 */
function chooseRallyCity(imgs, plan, _log) {
    if (!imgs.fortRally) {
        gh.notifyRequiredPositionMissing("城战", "集结入口模板", _log);
        return { status: "failed" };
    }
    var rally = gh.findFirst(imgs.fortRally, 0.7, "集结入口");
    if (rally) return { status: "selected", point: rally, descriptor: { image: imgs.fortRally, label: "集结" } };

    _log("[城战] 未发现集结入口，按进攻、再防守查找城镇");
    var attack = scanCityList(imgs, "attack", plan.target, _log);
    if (attack.status === "failed" || attack.status === "selected") return attack;
    var defend = scanCityList(imgs, "defend", plan.target, _log);
    if (defend.status === "failed" || defend.status === "selected") return defend;

    // 有坐标时，两个列表均确认未命中后优先回退进攻首项；空坐标则依次尝试两类列表的首项。
    var fallback = attack.status === "missing" ? attack : (defend.status === "missing" ? defend : null);
    if (!fallback) {
        _log("[城战] 集结入口和可用攻防城镇均未发现，跳过该舰队");
        return { status: "skip" };
    }
    _log("[城战] 集结回退未找到目标 " + plan.target + "，使用首个可用" + fallback.descriptor.label + "城镇");
    return { status: "selected", point: fallback.point, descriptor: fallback.descriptor };
}

/**
 * 选择当前舰队的集结或攻防城镇。集结命中时优先沿用原流程；其入口缺失才进入安全的攻防回退。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{mode: "attack"|"defend"|"rally", target: string}} plan 当前舰队计划。
 * @param {Function} _log 城战日志回调。
 * @returns {{status: "selected"|"skip"|"failed", point?: Object, descriptor?: Object}} 城镇选择结果。
 */
function chooseCity(imgs, plan, _log) {
    if (plan.mode === "rally") return chooseRallyCity(imgs, plan, _log);
    return chooseNormalCity(imgs, plan.mode, plan.target, _log);
}

/**
 * 打开城镇后点击行动按钮，并确认已进入舰队选择弹窗。
 * @param {Object} imgs 已加载的图片资源。
 * @param {{point: Object, descriptor: Object}} city 已选择城镇。
 * @param {Function} _log 城战日志回调。
 * @returns {boolean} 已确认舰队选择弹窗时返回 true。
 */
function openFleetDialog(imgs, city, _log) {
    click(city.point.x + city.descriptor.image.getWidth() / 2, city.point.y + city.descriptor.image.getHeight() / 2);
    _log("[城战] 打开" + city.descriptor.label + "城镇");
    sleep(1000);
    var action = gh.findFirst(imgs.fleetAttack, 0.76, "城战进攻按钮");
    var actionImage = imgs.fleetAttack;
    if (!action) {
        action = gh.findFirst(imgs.fleetGo, 0.76, "城战前往按钮");
        actionImage = imgs.fleetGo;
    }
    if (!action || !actionImage) return gh.notifyRequiredPositionMissing("城战", "前往或进攻按钮", _log);
    click(action.x + actionImage.getWidth() / 2, action.y + actionImage.getHeight() / 2);
    return waitForFleetDialog(imgs) || gh.notifyRequiredPositionMissing("城战", "舰队选择弹窗", _log);
}

/**
 * 在点击城镇操作后有限轮询舰队选择标题。城战动画偶尔超过固定等待时间，
 * 只重新识图而不补点任何坐标，避免把延迟误判为可再次点击。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {boolean} 已确认舰队选择弹窗时返回 true。
 */
function waitForFleetDialog(imgs) {
    for (var attempt = 0; attempt < FLEET_DIALOG_WAIT_ATTEMPTS; attempt++) {
        if (gh.findFirst(imgs.warFleetDialogTitle, 0.8, "城战舰队选择标题")) return true;
        if (attempt < FLEET_DIALOG_WAIT_ATTEMPTS - 1) sleep(FLEET_DIALOG_WAIT_INTERVAL_MS);
    }
    return false;
}

/**
 * 仅在仍可识别舰队选择标题时关闭弹窗，确保上一支舰队的弹窗不会遮挡下一支的城镇扫描。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 城战日志回调。
 * @returns {boolean} 未打开或已确认关闭时返回 true；关闭状态无法确认时返回 false。
 */
function closeFleetDialog(imgs, _log) {
    if (!gh.findFirst(imgs.warFleetDialogTitle, 0.8, "城战舰队选择标题")) return true;
    var close = gh.findFirst(imgs.warFleetDialogClose, 0.8, "城战舰队选择关闭");
    if (!close) return gh.notifyRequiredPositionMissing("城战", "舰队选择关闭按钮", _log);
    click(close.x + imgs.warFleetDialogClose.getWidth() / 2, close.y + imgs.warFleetDialogClose.getHeight() / 2);
    sleep(700);
    if (!gh.findFirst(imgs.warFleetDialogTitle, 0.8, "城战舰队选择标题")) return true;
    _log("[城战] 舰队选择弹窗关闭后仍存在，本轮停止后续点击");
    return false;
}

/**
 * 按纵向顺序收集三支舰队的行状态，不能根据模板返回顺序推定舰队编号。
 * 忙碌舰队不会显示复选框而只显示详情箭头，必须将两类控件合并，
 * 才能让空闲舰队的编号不被忙碌舰队挤乱。
 * @param {Object} imgs 已加载的图片资源。
 * @returns {Array<Object>|null} 舰队一至三的行状态；数量异常返回 null。
 */
function readFleetRows(imgs) {
    var rows = [];
    var checked = gh.findAll(imgs.fleetChecked, 0.8, "已勾选舰队");
    var unchecked = gh.findAll(imgs.fleetUnchecked, 0.8, "未勾选舰队");
    for (var i = 0; i < checked.length; i++) rows.push({ x: checked[i].x, y: checked[i].y, checked: true, selectable: true, image: imgs.fleetChecked });
    for (var j = 0; j < unchecked.length; j++) rows.push({ x: unchecked[j].x, y: unchecked[j].y, checked: false, selectable: true, image: imgs.fleetUnchecked });
    var arrows = gh.findAll(imgs.warFleetDetailArrow, 0.8, "舰队详情箭头");
    for (var k = 0; k < arrows.length; k++) {
        var belongsToSelectableRow = false;
        for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            if (Math.abs(rows[rowIndex].y - arrows[k].y) <= 120) {
                belongsToSelectableRow = true;
                break;
            }
        }
        if (!belongsToSelectableRow) {
            // 详情箭头代表不可出征的忙碌舰队；保留其行号，后续仅可在状态已确认时进入加速流程。
            rows.push({ x: arrows[k].x, y: arrows[k].y, checked: false, selectable: false, image: null, detailArrow: arrows[k] });
        }
    }
    var combatMarkers = imgs.warFleetCombat ? gh.findAll(imgs.warFleetCombat, 0.8, "舰队交战中") : [];
    for (var markerIndex = 0; markerIndex < combatMarkers.length; markerIndex++) {
        var belongsToKnownRow = false;
        for (var knownIndex = 0; knownIndex < rows.length; knownIndex++) {
            if (Math.abs(rows[knownIndex].y - combatMarkers[markerIndex].y) <= 120) {
                belongsToKnownRow = true;
                break;
            }
        }
        if (!belongsToKnownRow) {
            // 交战中的舰队既不能勾选也没有详情箭头；保留该行，防止后续空闲舰队错配到前一支的计划。
            rows.push({ x: combatMarkers[markerIndex].x, y: combatMarkers[markerIndex].y, checked: false, selectable: false, image: null, state: "combat" });
        }
    }
    rows.sort(function(a, b) { return a.y - b.y; });
    return rows.length === FLEET_COUNT ? rows : null;
}

/**
 * 判断舰队行当前是否可出征。城战弹窗给出复选框即代表该舰队空闲可选；
 * 忙碌舰队由详情箭头或交战标记保留行号，不能再额外依赖易受缩放影响的“空闲中”文字模板。
 * @param {Object} row 当前舰队复选框位置。
 * @returns {"idle"|"busy"} 当前可出征状态。
 */
function getFleetState(row) {
    return row.selectable === true ? "idle" : "busy";
}

/**
 * 读取世界地图底部舰队条的维修或行军状态。三张舰队卡位置固定但屏幕高度会变，因此只按底边计算纵向区域。
 * @param {Object} imgs 已加载的图片资源。
 * @param {number} index 从 0 开始的舰队索引。
 * @returns {"repair"|"march"|"unknown"} 已确认的状态；未出现两类图标时返回 unknown。
 */
function readWorldFleetStatus(imgs, index) {
    var strip = WORLD_FLEET_STRIPS[index];
    if (!strip || typeof context === "undefined" || !context.getResources) return "unknown";
    var metrics = context.getResources().getDisplayMetrics();
    var width = metrics.widthPixels;
    var height = metrics.heightPixels;
    var x = Math.floor(width * strip.left);
    // 图标固定在舰队头像左下角；收紧到该带状区域，避开地图底部的其他蓝色 UI 图标。
    var y = Math.max(0, height - 360);
    var stripWidth = Math.ceil(width * strip.width);
    var stripHeight = 90;
    // 两种蓝色图标只存在于对应舰队卡；先识别维修，避免扳手齿轮被细小的脚印模板误判。
    if (imgs.warFleetRepairing && gh.findFirstInRegion(imgs.warFleetRepairing, x, y, stripWidth, stripHeight, 0.78, "底部舰队维修图标")) return "repair";
    if (imgs.warFleetMarching && gh.findFirstInRegion(imgs.warFleetMarching, x, y, stripWidth, stripHeight, 0.78, "底部舰队行军图标")) return "march";
    return "unknown";
}

/**
 * 仅选择指定舰队，取消其他被游戏默认勾选的舰队后重新识别确认。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Array<Object>} rows 当前三行选择框状态。
 * @param {number} index 目标舰队索引。
 * @param {Function} _log 城战日志回调。
 * @returns {boolean} 仅目标舰队被勾选时返回 true。
 */
function selectOnlyFleet(imgs, rows, index, _log) {
    for (var i = 0; i < rows.length; i++) {
        // 忙碌舰队没有复选框；详情箭头不能被当成选择控件点击。
        if (rows[i].selectable && i !== index && rows[i].checked) click(rows[i].x + rows[i].image.getWidth() / 2, rows[i].y + rows[i].image.getHeight() / 2);
    }
    if (!rows[index].selectable) {
        _log("[城战] 舰队" + (index + 1) + "忙碌且不可勾选，未执行出征");
        return false;
    }
    if (!rows[index].checked) click(rows[index].x + rows[index].image.getWidth() / 2, rows[index].y + rows[index].image.getHeight() / 2);
    sleep(500);
    var verified = readFleetRows(imgs);
    if (!verified) return gh.notifyRequiredPositionMissing("城战", "三支舰队勾选状态", _log);
    var count = 0;
    var selectedIndex = -1;
    for (var j = 0; j < verified.length; j++) {
        if (verified[j].selectable && verified[j].checked) {
            count++;
            selectedIndex = j;
        }
    }
    if (count === 1 && selectedIndex === index) return true;
    _log("[城战] 舰队勾选校验失败，未执行出征");
    return false;
}

/**
 * 查找与当前舰队行垂直对齐的详情箭头，避免点击另一个忙碌舰队的入口。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} row 当前舰队复选框位置。
 * @returns {{x: number, y: number}|null} 对应详情箭头。
 */
function findDetailArrow(imgs, row) {
    // 忙碌舰队在选择框位置直接显示箭头，readFleetRows 已按垂直行号归属，不必再次近似匹配。
    if (row.detailArrow) return row.detailArrow;
    var arrows = gh.findAll(imgs.warFleetDetailArrow, 0.8, "舰队详情箭头");
    var selected = null;
    var distance = Number.MAX_VALUE;
    for (var i = 0; i < arrows.length; i++) {
        var candidateDistance = Math.abs(arrows[i].y - row.y);
        if (candidateDistance < distance) {
            selected = arrows[i];
            distance = candidateDistance;
        }
    }
    return distance <= 120 ? selected : null;
}

/**
 * 将 OCR 识别到的时分秒转换为秒数，作为钻石加速成功的可核验结果。
 * @param {string} text OCR 原始文字。
 * @returns {number|null} 剩余秒数；格式不完整时返回 null。
 */
function parseSeconds(text) {
    var match = String(text || "").match(/([0-9]{1,2}):([0-9]{2}):([0-9]{2})/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/**
 * 判断 OCR 文本是否为游戏当前统一使用的钻石加速弹窗标题。
 * 维修和行军都显示“加速完成”，具体业务类型只能依赖点击前已确认的舰队状态，不能臆测标题类别。
 * @param {string} text OCR 识别的弹窗标题区域文字。
 * @returns {boolean} 已确认是钻石加速弹窗时返回 true。
 */
function isSpeedDialogTitle(text) {
    return String(text || "").replace(/\s/g, "").indexOf(SPEED_DIALOG_TITLE) >= 0;
}

/**
 * 读取并验证加速窗口：统一标题、钻石按钮与倒计时三项必须同时成立。
 * @param {Object} imgs 已加载的图片资源。
 * @param {"repair"|"march"} kind 加速类型。
 * @param {Function} _log 城战日志回调。
 * @returns {{ok: boolean, button: Object|null, seconds: number|null}} 已确认的加速窗口数据。
 */
function readSpeedDialog(imgs, kind, _log) {
    var stage = kind === "repair" ? "维修" : "行军";
    var text = readOcrText(SPEED_TITLE_REGION, _log, stage + "加速弹窗标题");
    if (!text.ok || !isSpeedDialogTitle(text.text)) return { ok: false, button: null, seconds: null };
    var button = gh.findFirst(imgs.warDiamondSpeedUp, 0.82, "钻石加速按钮");
    if (!button) return { ok: false, button: null, seconds: null };
    var timer = readOcrText(SPEED_TIME_REGION, _log, stage + "加速倒计时");
    var seconds = timer.ok ? parseSeconds(timer.text) : null;
    return { ok: seconds !== null, button: button, seconds: seconds };
}

/**
 * 在已确认速度x2生效后关闭仍显示的加速窗，恢复到舰队选择页，避免遮挡下一支舰队的操作。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 城战日志回调。
 * @returns {boolean} 弹窗已经关闭或确认关闭时返回 true。
 */
function closeSpeedDialog(imgs, _log) {
    var close = gh.findFirst(imgs.warSpeedDialogClose, 0.82, "加速弹窗关闭");
    if (!close) return gh.notifyRequiredPositionMissing("城战", "加速弹窗关闭按钮", _log);
    click(close.x + imgs.warSpeedDialogClose.getWidth() / 2, close.y + imgs.warSpeedDialogClose.getHeight() / 2);
    sleep(600);
    var title = readOcrText(SPEED_TITLE_REGION, _log, "加速窗关闭确认");
    if (!title.ok) return false;
    if (!isSpeedDialogTitle(title.text)) return true;
    _log("[城战] 加速窗关闭后标题仍存在，本轮停止后续点击");
    return false;
}

/**
 * 只对一段维修或行军倒计时点击一次钻石加速，并确认倒计时缩短或弹窗被游戏关闭。
 * @param {Object} imgs 已加载的图片资源。
 * @param {"repair"|"march"} kind 加速类型。
 * @param {number} index 当前舰队索引。
 * @param {Function} _log 城战日志回调。
 * @returns {boolean} 已确认加速成功时返回 true。
 */
function useSpeedUpOnce(imgs, kind, index, _log) {
    if (acceleratedSegments[kind][index]) return false;
    var before = readSpeedDialog(imgs, kind, _log);
    if (!before.ok) return gh.notifyRequiredPositionMissing("城战", kind === "repair" ? "维修加速弹窗" : "行军加速弹窗", _log);
    click(before.button.x + imgs.warDiamondSpeedUp.getWidth() / 2, before.button.y + imgs.warDiamondSpeedUp.getHeight() / 2);
    _log("[城战] 舰队" + (index + 1) + "点击" + (kind === "repair" ? "维修" : "行军") + "钻石加速，等待倒计时确认");
    sleep(900);
    var after = readSpeedDialog(imgs, kind, _log);
    if (after.ok && after.seconds < before.seconds) {
        // 钻石已因倒计时缩短被确认消耗，即使随后无法关闭弹窗也不得再次点击同一段加速。
        acceleratedSegments[kind][index] = true;
        if (!closeSpeedDialog(imgs, _log)) return false;
        _log("[城战] 舰队" + (index + 1) + "确认" + (kind === "repair" ? "维修" : "行军") + "加速成功");
        return true;
    }
    // 部分版本接受点击后会立即收起弹窗，标题消失可作为页面状态变化的确认。
    var title = readOcrText(SPEED_TITLE_REGION, _log, "加速后标题");
    if (title.ok && !isSpeedDialogTitle(title.text)) {
        acceleratedSegments[kind][index] = true;
        _log("[城战] 舰队" + (index + 1) + "确认" + (kind === "repair" ? "维修" : "行军") + "加速成功");
        return true;
    }
    _log("[城战] 加速后未确认倒计时变化，本轮停止后续操作");
    return false;
}

/**
 * 在舰队被确认空闲时结束上一段维修和行军的钻石加速记账。
 * @param {number} index 当前舰队索引。
 */
function resetAcceleratedSegments(index) {
    acceleratedSegments.repair[index] = false;
    acceleratedSegments.march[index] = false;
}

/**
 * 逐舰队复核某类钻石加速是否由用户明确启用。
 * 该校验位于详情箭头点击前，作为调用方条件判断之外的最后一道防线。
 * @param {Object} plan 当前舰队冻结后的执行计划。
 * @param {"repair"|"march"} kind 要执行的加速类型。
 * @returns {boolean} 对应开关为 true 时返回 true。
 */
function isAccelerationEnabled(plan, kind) {
    return !!plan && (kind === "repair" ? plan.repairAccelerate === true : plan.marchAccelerate === true);
}

/**
 * 点击当前舰队行的详情箭头并确认进入对应的维修或行军加速弹窗。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} row 当前舰队行。
 * @param {"repair"|"march"} kind 已在世界地图底部舰队条确认的状态。
 * @param {Object} plan 当前舰队冻结后的执行计划。
 * @param {number} index 当前舰队索引。
 * @param {Function} _log 城战日志回调。
 * @returns {{status: "handled"|"skip"|"failed"}} 加速结果。
 */
function accelerateFleetStatus(imgs, row, kind, plan, index, _log) {
    if (!isAccelerationEnabled(plan, kind)) {
        _log("[城战] 舰队" + (index + 1) + (kind === "repair" ? "维修" : "行军") + "加速已关闭，拒绝打开钻石加速弹窗");
        return { status: "skip" };
    }
    var arrow = findDetailArrow(imgs, row);
    if (!arrow) return { status: "skip" };
    click(arrow.x + imgs.warFleetDetailArrow.getWidth() / 2, arrow.y + imgs.warFleetDetailArrow.getHeight() / 2);
    sleep(600);
    return useSpeedUpOnce(imgs, kind, index, _log) ? { status: "handled" } : { status: "failed" };
}

/**
 * 执行一支舰队的城镇选择、独占勾选、出征与可选加速。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Object} plan 当前舰队计划。
 * @param {number} index 当前舰队索引。
 * @param {Function} _log 城战日志回调。
 * @returns {{status: "handled"|"skip"|"failed"}} 单舰队处理结果。
 */
function processFleet(imgs, plan, index, _log) {
    var worldStatus = readWorldFleetStatus(imgs, index);
    // 已确认的忙碌舰队在对应自动加速关闭或已用完本段机会时不再打开城镇弹窗。
    if (worldStatus === "repair" && (!plan.repairAccelerate || acceleratedSegments.repair[index])) return { status: "skip" };
    if (worldStatus === "march" && (!plan.marchAccelerate || acceleratedSegments.march[index])) return { status: "skip" };
    var city = chooseCity(imgs, plan, _log);
    if (city.status !== "selected") return { status: city.status };
    if (!openFleetDialog(imgs, city, _log)) return { status: "failed" };
    var rows = readFleetRows(imgs);
    if (!rows) {
        gh.notifyRequiredPositionMissing("城战", "三支舰队选择框", _log);
        return { status: "failed" };
    }
    var row = rows[index];
    var state = getFleetState(row);
    if (state === "idle") {
        // 空闲代表前一段倒计时完成；新的维修或出征可再各消耗一次钻石。
        resetAcceleratedSegments(index);
        if (!selectOnlyFleet(imgs, rows, index, _log)) return { status: "failed" };
        var fleet = require("./fleet.js");
        if (!fleet.dispatch(imgs, null, "城战", _log)) return { status: "failed" };
        _log("[城战] 舰队" + (index + 1) + "已按" + city.descriptor.label + "计划出征");
        // 游戏仍停留在选择页时才可确认行军入口；已经关闭时不能猜测性重开地图。
        if (plan.marchAccelerate && gh.findFirst(imgs.warFleetDialogTitle, 0.8, "城战舰队选择标题")) {
            var postRows = readFleetRows(imgs);
            if (!postRows) return { status: "failed" };
            var marchAfterDispatch = accelerateFleetStatus(imgs, postRows[index], "march", plan, index, _log);
            if (marchAfterDispatch.status === "failed") return marchAfterDispatch;
        }
        return { status: "handled" };
    }
    if (worldStatus === "march") {
        // 行军已确认时上一段维修结束；仅允许这一段行军消耗一次钻石。
        acceleratedSegments.repair[index] = false;
        return !plan.marchAccelerate || acceleratedSegments.march[index] ? { status: "skip" } : accelerateFleetStatus(imgs, row, "march", plan, index, _log);
    }
    if (worldStatus === "repair") {
        // 维修已确认时上一段行军结束；仅允许这一段维修消耗一次钻石。
        acceleratedSegments.march[index] = false;
        return !plan.repairAccelerate || acceleratedSegments.repair[index] ? { status: "skip" } : accelerateFleetStatus(imgs, row, "repair", plan, index, _log);
    }
    _log("[城战] 舰队" + (index + 1) + "非空闲但未确认维修或行军状态，跳过以避免误扣钻石");
    return { status: "skip" };
}

/**
 * 执行一次城战：先领奖，再按舰队一至三的独立计划逐项处理。活动窗口和下一轮等待由总调度器管理。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Array<Object>} plans 三支舰队的独立计划。
 * @param {Function} uiLog 调度器日志回调。
 * @param {boolean} claimReward 是否自动领取城战奖励。
 * @returns {boolean} 已领奖、出征或确认加速至少一支舰队时返回 true。
 */
war.runOnce = function(imgs, plans, uiLog, claimReward) {
    var navigate = require("./navigate.js");
    var _log = uiLog || function(message) { log(message); };
    if (!ensureWarImages(imgs, _log)) return false;
    var plansToRun = [];
    for (var i = 0; i < FLEET_COUNT; i++) {
        var plan = readPlan(plans, i);
        if (!plan) {
            _log("[城战] 舰队" + (i + 1) + "配置无效，本轮停止操作");
            return false;
        }
        plansToRun.push(plan);
    }
    var scene = navigate.detectScene(imgs);
    if (scene === "base") {
        var world = gh.findFirst(imgs.worldIcon, 0.7, "世界图标");
        if (!world) return gh.notifyRequiredPositionMissing("城战", "世界入口", _log);
        click(world.x + imgs.worldIcon.getWidth() / 2, world.y + imgs.worldIcon.getHeight() / 2);
        sleep(2500);
        if (!gh.findFirst(imgs.baseIcon, 0.7, "城战世界主界面基地")) return gh.notifyRequiredPositionMissing("城战", "世界主界面确认", _log);
    } else if (scene !== "world") {
        return gh.notifyRequiredPositionMissing("城战", "游戏主界面", _log);
    }
    if (claimReward !== false && checkReward(imgs, _log)) {
        _log("[城战] 奖励领取完毕");
        return true;
    }
    var handled = false;
    for (var index = 0; index < FLEET_COUNT; index++) {
        var result = processFleet(imgs, plansToRun[index], index, _log);
        // 不论本舰队是出征、跳过或失败，都先确认选择弹窗已退回世界地图，避免遮挡下一次完整列表扫描。
        if (!closeFleetDialog(imgs, _log)) return false;
        if (result.status === "failed") return false;
        if (result.status === "handled") handled = true;
    }
    return handled;
};

/**
 * 检查奖励角标并领取最右侧奖励；奖励弹层只在底部关闭提示出现后才执行空白区域点击。
 * @param {Object} imgs 已加载的图片资源。
 * @param {Function} _log 城战任务日志回调。
 * @returns {boolean} 已完成本次领奖和面板关闭时返回 true；未发现奖励或弹层未就绪时返回 false。
 */
function checkReward(imgs, _log) {
    if (!imgs.warReward || !imgs.warRewardExclaim || !imgs.warRewardItem || !imgs.warRewardClose || !imgs.rewardDismissHint) return false;
    var reward = gh.findFirst(imgs.warReward, 0.7, "城战奖励");
    if (!reward) return false;
    var width = imgs.warReward.getWidth();
    var height = imgs.warReward.getHeight();
    var padding = Math.floor(width / 4);
    if (!gh.findFirstInRegion(imgs.warRewardExclaim, Math.max(0, reward.x - padding), Math.max(0, reward.y - 200), width + padding * 2, 200, 0.7, "城战奖励感叹号")) return false;
    click(reward.x + width / 2 + random(-10, 10), reward.y + height / 2 + random(-10, 10));
    sleep(1500);
    var rewards = gh.findAll(imgs.warRewardItem, 0.7, "城战奖励物品");
    if (!rewards.length) return false;
    var last = rewards[0];
    for (var i = 1; i < rewards.length; i++) if (rewards[i].x > last.x) last = rewards[i];
    click(last.x + imgs.warRewardItem.getWidth() / 2 + random(-10, 10), last.y + imgs.warRewardItem.getHeight() / 2 + random(-10, 10));
    sleep(1200);
    if (gh.findFirst(imgs.warRewardDone, 0.7, "领取奖励完成")) {
        if (!gh.waitForRewardDismissHint(imgs.rewardDismissHint, null, "城战奖励关闭提示")) return gh.notifyRequiredPositionMissing("城战", "奖励关闭提示", _log);
        var metrics = context.getResources().getDisplayMetrics();
        click(random(100, metrics.widthPixels - 100), metrics.heightPixels - random(80, 200));
        sleep(800);
    }
    var close = gh.findFirst(imgs.warRewardClose, 0.7, "城战奖励关闭");
    if (!close) return gh.notifyRequiredPositionMissing("城战", "城战奖励关闭按钮", _log);
    click(close.x + imgs.warRewardClose.getWidth() / 2, close.y + imgs.warRewardClose.getHeight() / 2);
    sleep(800);
    return true;
}

module.exports = war;
