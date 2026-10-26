// plantFood.js — 种食物：收割→翻地→播种，库存满自动切换作物

var plantFood = {};

// 当前 MuMu 的游戏分辨率为 1080×2400；此点位是选种栏外左侧海水空白区，不会命中农田或功能入口。
var SEED_SELECTOR_DISMISS_POINT = { x: 120, y: 1200 };
// 建造弹层有暗色遮罩，现场截图中蓝图图标的最高匹配分为 0.625；0.60 仍高于普通基地的 0.445 假阳性上界。
var CONSTRUCTION_BLUEPRINT_THRESHOLD = 0.60;

/**
 * 执行一次收割与播种检查，供总调度器在普通任务轮次中调用。
 * @param {Object} imgs 已加载的作物、种子及农田图片资源。
 * @param {{foodType: string, intervalSeconds: number, lastCompletedAt: number}} config 当前作物与本会话冷却配置。
 * @param {Function} shouldStop 返回 true 时停止本轮操作。
 * @param {Function} [uiLog] 任务日志回调。
 * @param {Function} [onFoodSwitch] 需要切换作物时的配置更新回调。
 * @returns {boolean} 本轮执行了收割或种植相关操作时返回 true。
 */
plantFood.runOnce = function(imgs, config, shouldStop, uiLog, onFoodSwitch) {
    var _log = uiLog || function(msg) { log(msg); };
    var taskConfig = config || {};
    var foodType = taskConfig.foodType;
    var intervalSeconds = Number(taskConfig.intervalSeconds);
    var lastCompletedAt = Number(taskConfig.lastCompletedAt) || 0;
    var allFoods = ["水稻", "玉米", "土豆", "西红柿", "胡萝卜", "卷心菜", "大豆", "南瓜"];
    var currentFood = foodType;
    if (!isFinite(intervalSeconds) || intervalSeconds <= 0) {
        _log("[种植] 配置无效，本轮跳过");
        return false;
    }
    // 高频调度时冷却分支必须完全不识图、不触屏，也不记录正常冷却日志。
    if (lastCompletedAt && Date.now() - lastCompletedAt < intervalSeconds * 1000) return false;
    var gh = require("./gameHelper.js");
    // 商船和盟战可能切换主界面；只有种植确实到期后才定位农田，避免冷却任务在轮转中干扰其他页面。
    if (!require("./navigate.js").autoLocate(imgs, _log)) {
        _log("自动定位失败，本轮跳过种植");
        return false;
    }
    var cropImg = imgs.crops[currentFood];
    var seedImg = imgs.seeds[currentFood];
    var didSomething = false;

    if (!cropImg || !seedImg) {
        _log("不支持的食物类型: " + currentFood);
        return false;
    }

    /**
     * 播种失败时更新为下一种可用作物；下一轮由调度器使用新作物重试，避免在单个原子动作内无限循环。
     */
    function switchToNextFood() {
        var idx = allFoods.indexOf(currentFood);
        for (var i = 1; i < allFoods.length; i++) {
            var next = allFoods[(idx + i) % allFoods.length];
            if (imgs.crops[next] && imgs.seeds[next]) {
                _log("自动切换作物: " + next);
                if (onFoodSwitch) onFoodSwitch(next);
                return true;
            }
        }
        _log("没有可切换的作物，保留当前作物");
        return false;
    }

    /**
     * 通过空土地是否消失确认拖拽播种已被游戏接受。
     */
    function checkPlantResult() {
        for (var c = 0; c < 3 && !shouldStop(); c++) {
            sleep(1500);
            if (gh.findAllToFilter(imgs.tudi, 0.8, "土地", 120).length === 0) return true;
        }
        return false;
    }

    /**
     * 从种子图标拖拽经过全部土地，模拟游戏要求的连续播种操作。
     * @param {Array<{x: number, y: number}>} land 已确认可播种的土地坐标。
     * @returns {boolean} 已发起播种手势时返回 true；选种栏中当前种子不可用时返回 false。
     */
    function plantAll(land) {
        var seedPos = gh.findFirst(seedImg, 0.7, currentFood + "种子");
        gh.showOverlay(seedPos, seedImg);
        if (!seedPos) {
            // 种子栏未显示当前种子通常表示该作物已满仓；调用方必须先退出选种栏，避免后续任务停在此页面。
            _log("未找到" + currentFood + "种子，可能已满仓");
            return false;
        }
        var sdx = seedPos.x + seedImg.getWidth() / 2 + Math.round(Math.random() * 10 - 5);
        var sdy = seedPos.y + seedImg.getHeight() / 2 + Math.round(Math.random() * 10 - 5);
        var points = land.map(function(p) {
            return {
                x: p.x + imgs.tudi.getWidth() / 2 + Math.round(Math.random() * 10 - 5),
                y: p.y + imgs.tudi.getHeight() * 1.5 + Math.round(Math.random() * 10 - 5)
            };
        }).sort(function(a, b) { return a.y - b.y; });
        var gestureParams = [2000, [sdx, sdy]];
        for (var i = 0; i < points.length; i++) gestureParams.push([points[i].x, points[i].y]);
        gesture.apply(null, gestureParams);
        _log("播种完成，经过 " + points.length + " 块土地");
        return true;
    }

    /**
     * 在当前播种上下文无法继续确认时关闭已打开的选种栏。
     * 本轮点击土地后，即使土地匹配突然消失也可能已经打开选种栏；左侧海水空白区是当前游戏页面的安全退出区域。
     * @returns {void}
     */
    function closeSeedSelector() {
        click(SEED_SELECTOR_DISMISS_POINT.x, SEED_SELECTOR_DISMISS_POINT.y);
        _log("当前种子不可选，已点击左侧海水空白区退出选种界面");
        // 给选种栏的关闭动画留出时间，避免本轮紧接着的其他任务点击仍落在遮罩层上。
        sleep(600);
    }

    if (shouldStop()) return false;

    // ===== 收割 =====
    var foundCrop = null;
    var foundCropImg = null;
    var foundCropName = null;
    var cropsToTry = [currentFood].concat(allFoods.filter(function(food) { return food !== currentFood; }));
    for (var ci = 0; ci < cropsToTry.length; ci++) {
        var name = cropsToTry[ci];
        var image = imgs.crops[name];
        if (!image) continue;
        var matches = gh.findAll(image, 0.7, name);
        if (matches.length > 0) {
            foundCrop = matches;
            foundCropImg = image;
            foundCropName = name;
            gh.showOverlay(matches, image);
            break;
        }
    }
    if (foundCrop) {
        didSomething = true;
        var topCrop = gh.getMaxYPoint(foundCrop);
        click(topCrop.x + foundCropImg.getWidth() / 2, topCrop.y + foundCropImg.getHeight());
        _log("点击" + foundCropName + ": (" + topCrop.x + ", " + topCrop.y + ")");
        sleep(2000);

        var scythePos = gh.findFirst(imgs.liandao, 0.6, "镰刀");
        gh.showOverlay(scythePos, imgs.liandao);
        if (scythePos) {
            sleep(2000);
            var harvestMatches = gh.findAll(foundCropImg, 0.5, foundCropName);
            if (harvestMatches.length > 0) {
                var ldx = scythePos.x + imgs.liandao.getWidth() / 2 + Math.round(Math.random() * 10 - 5);
                var ldy = scythePos.y + imgs.liandao.getHeight() / 2 + Math.round(Math.random() * 10 - 5);
                var harvestPoints = harvestMatches.map(function(p) {
                    return {
                        x: p.x + foundCropImg.getWidth() / 2 + Math.round(Math.random() * 10 - 5),
                        y: p.y + foundCropImg.getHeight() * 1.5 + Math.round(Math.random() * 10 - 5)
                    };
                }).sort(function(a, b) { return a.y - b.y; });
                var harvestGesture = [2000, [ldx, ldy]];
                for (var hi = 0; hi < harvestPoints.length; hi++) harvestGesture.push([harvestPoints[hi].x, harvestPoints[hi].y]);
                gesture.apply(null, harvestGesture);
                _log("收割完成，经过 " + harvestPoints.length + " 个" + foundCropName);
            } else {
                _log("收割前未找到" + foundCropName);
            }
        } else {
            gh.notifyRequiredPositionMissing("种植", "镰刀", _log);
        }
    } else {
        _log("未找到成熟" + currentFood + "，跳过收割");
    }

    if (shouldStop()) return false;
    sleep(3000);

    // ===== 翻地播种 =====
    var land = gh.findAllToFilter(imgs.tudi, 0.8, "有效土地", 120);
    gh.showOverlay(land, imgs.tudi);
    if (land.length === 0) {
        _log("未找到空土地，跳过播种");
        return didSomething;
    }
    didSomething = true;
    var topLand = gh.getMaxYPoint(land);
    click(topLand.x + imgs.tudi.getWidth() / 2, topLand.y + imgs.tudi.getHeight());
    _log("点击土地: (" + topLand.x + ", " + topLand.y + ")");
    sleep(2000);
    if (shouldStop()) return false;

    // 未完工地块与空土地共用泥土纹理，不能仅凭初始模板命中开始播种；建筑蓝图弹层是明确的负向状态。
    if (imgs.constructionBlueprint && gh.findFirst(imgs.constructionBlueprint, CONSTRUCTION_BLUEPRINT_THRESHOLD, "建筑蓝图")) {
        _log("候选土地打开建筑蓝图，判定为未完工地块，交由通用回主页恢复");
        // 必要位置缺失入口会复用既有的有限递归回主页链路，禁止在建筑弹层上猜测性点击选种栏外的坐标。
        gh.notifyRequiredPositionMissing("种植", "已建成可播种农田", _log);
        return didSomething;
    }

    // 种子图标出现才证明点击进入选种界面；避免在未完工或其它未知弹层中把后续拖拽落到错误页面。
    if (!gh.findFirst(seedImg, 0.7, currentFood + "种子")) {
        _log("点击候选土地后未确认选种界面，交由通用回主页恢复");
        gh.notifyRequiredPositionMissing("种植", "选种界面", _log);
        return didSomething;
    }

    land = gh.findLandStable(imgs.tudi, 0.8, "土地", 120);
    gh.showOverlay(land, imgs.tudi);
    if (land.length === 0) {
        // 点击土地已可能打开选种栏；先退出遮罩再上报缺位，避免下一任务在残留选种界面上误点。
        closeSeedSelector();
        gh.notifyRequiredPositionMissing("种植", "播种土地", _log);
        return didSomething;
    }
    sleep(2000);
    var startedPlanting = plantAll(land);
    if (!startedPlanting) {
        closeSeedSelector();
        switchToNextFood();
        _log(currentFood + " 未开始播种，已切换作物等待下轮重试");
    } else if (!checkPlantResult()) {
        _log(currentFood + " 播种失败，尝试切换作物");
        if (gh.findFirst(imgs.stockFull, 0.7, "库存已满")) _log("确认: " + currentFood + " 库存已满");
        // 满仓时种子图标仍可被识别，拖拽失败后选种栏会保持打开；切换下一作物前必须先退出该界面。
        closeSeedSelector();
        switchToNextFood();
        _log(currentFood + " 本轮未完成播种，已切换作物等待下轮重试");
        return didSomething;
    }
    _log(currentFood + " 本轮完成");
    return didSomething;
};

module.exports = plantFood;
