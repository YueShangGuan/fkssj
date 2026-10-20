// gameHelper.js
// 疯狂水世界辅助工具 - 核心逻辑模块

var gameHelper = {};

// 奖励物品会逐项入场；只有底部关闭提示出现，空白区域才真正可用于关闭弹层。
var REWARD_CLOSE_HINT_ATTEMPTS = 10;
var REWARD_CLOSE_HINT_RETRY_DELAY_MS = 400;
var mainSceneRecoveryHandler = null;
var mainSceneRecoveryInProgress = false;

/**
 * 读取可选的任务模板。打捞资源的图片需要由设备原始截图人工裁取，未准备时不能阻断其他任务启动。
 * @param {string} path 项目内模板相对路径。
 * @returns {Object|null} 已加载图片，或模板尚未提供时的 null。
 */
function readOptionalImage(path) {
    try {
        return images.read(path);
    } catch (e) {
        return null;
    }
}

/**
 * 加载所有任务共用的截图模板；模板必须与目标设备的实际分辨率一致。
 * @returns {Object} 按业务场景分组的图片资源。
 */
gameHelper.loadImages = function() {
    return {
        // 作物成熟图
        crops: {
            "水稻": images.read("./img/作物/水稻.png"),
            "玉米": images.read("./img/作物/玉米.png"),
            "土豆": images.read("./img/作物/土豆.png"),
            "西红柿": images.read("./img/作物/西红柿.png"),
            "胡萝卜": images.read("./img/作物/胡萝卜.png"),
            "卷心菜": images.read("./img/作物/卷心菜.png"),
            "大豆": images.read("./img/作物/大豆.png"),
            "南瓜": images.read("./img/作物/南瓜.png"),
        },
        // 作物种子图标
        seeds: {
            "水稻": images.read("./img/种子图标/水稻.png"),
            "玉米": images.read("./img/种子图标/玉米.png"),
            "土豆": images.read("./img/种子图标/土豆.png"),
            "西红柿": images.read("./img/种子图标/西红柿.png"),
            "胡萝卜": images.read("./img/种子图标/胡萝卜.png"),
            "卷心菜": images.read("./img/种子图标/卷心菜.png"),
            "大豆": images.read("./img/种子图标/大豆.png"),
            "南瓜": images.read("./img/种子图标/南瓜.png"),
        },
        liandao: images.read("./img/镰刀.png"),
        tudi: images.read("./img/土地.png"),
        stockFull: images.read("./img/该农作物库存已达上限.png"),
        duanzao: images.read("./img/锻造/开始锻造.png"),
        duanzaoDone: images.read("./img/锻造/锻造完成.png"),
        // 锻造类型
        forgeTypeGun: images.read("./img/锻造/枪械未选中.png"),
        forgeTypeArmor: images.read("./img/锻造/防具未选中.png"),
        forgeTypeBlade: images.read("./img/锻造/兵刃未选中.png"),
        // 锻造级别
        forgeLevelBlue: images.read("./img/锻造/蓝级.png"),
        forgeLevelPurple: images.read("./img/锻造/紫级.png"),
        forgeLevelOrange: images.read("./img/锻造/橙级.png"),
        // 舰队
        fleetIdle: images.read("./img/舰队/空闲中.png"),
        fleetUnchecked: images.read("./img/舰队/未勾选.png"),
        // 情报任务只确认游戏默认勾选的舰队，不能复用 fleetUnchecked 去勾选全部。
        fleetChecked: images.read("./img/舰队/勾选.png"),
        fleetDispatch: images.read("./img/舰队/出征.png"),
        fleetGo: images.read("./img/舰队/前往.png"),
        fleetAttack: images.read("./img/舰队/进攻.png"),
        // 堡垒
        // 集结入口沿用原城战派遣流程；未识别到时由 war.js 按进攻、再防守安全回退。
        fortRally: images.read("./img/盟战/集结.png"),
        fortAttack: images.read("./img/堡垒/进攻堡垒.png"),
        fortDefend: images.read("./img/堡垒/防御堡垒.png"),
        // 盟战奖励
        warReward: images.read("./img/盟战/城战奖励.png"),
        warRewardExclaim: images.read("./img/盟战/感叹号.png"),
        warRewardItem: images.read("./img/盟战/奖励.png"),
        warRewardClose: images.read("./img/盟战/城战奖励关闭.png"),
        warRewardDone: images.read("./img/盟战/领取奖励完成.png"),
        // 城战逐舰队：底部舰队条状态用于判断维修/行军；弹窗元素只在确认可操作页面后点击。
        warFleetDialogTitle: images.read("./img/盟战/舰队选择标题.png"),
        warFleetDialogClose: images.read("./img/盟战/舰队选择关闭.png"),
        warFleetDetailArrow: images.read("./img/盟战/舰队详情箭头.png"),
        warFleetMarching: images.read("./img/盟战/舰队行军图标.png"),
        warFleetRepairing: images.read("./img/盟战/舰队维修图标.png"),
        // 维修标题尚无原始截图，war.js 会用 OCR 精确确认“维修加速”；两类弹窗共用速度x2按钮。
        warMarchSpeedUpTitle: images.read("./img/盟战/加速行军标题.png"),
        warSpeedUpX2: images.read("./img/盟战/速度x2.png"),
        warSpeedDialogClose: images.read("./img/盟战/加速弹窗关闭.png"),
        // 搁浅商船
        shipIcon: images.read("./img/搁浅商船/图标.png"),
        shipLarge: images.read("./img/搁浅商船/万吨商轮.png"),
        shipInList: images.read("./img/搁浅商船/万吨货轮在列表.png"),
        shipGoBtn: images.read("./img/搁浅商船/前往按钮.png"),
        shipCloseList: images.read("./img/搁浅商船/关闭货轮列表.png"),
        shipClosePage: images.read("./img/搁浅商船/关闭搁浅商船页面.png"),
        // 贸易港口
        tradePortEntry: images.read("./img/贸易港口/入口.png"),
        tradePortReceive: images.read("./img/贸易港口/收货.png"),
        tradePortRewardTitle: images.read("./img/贸易港口/恭喜获得.png"),
        tradePortAllDeliver: images.read("./img/贸易港口/全部交货.png"),
        tradePortInsufficient: images.read("./img/贸易港口/所需产品不足.png"),
        tradePortInsufficientClose: images.read("./img/贸易港口/所需产品不足关闭.png"),
        tradePortClose: images.read("./img/贸易港口/关闭.png"),
        // 展区：全部从 MuMu 原始 1080×2400 截图裁取；地点名称由 exhibition.js 使用 OCR 二次确认，图钉只负责打开详情。
        exhibitionMuseum: images.read("./img/展区/博物馆.png"),
        exhibitionBubble: images.read("./img/展区/展品气泡.png"),
        exhibitionTreasureEntry: images.read("./img/展区/寻宝入口.png"),
        exhibitionTreasureTitle: images.read("./img/展区/寻宝标题.png"),
        exhibitionSitePin: images.read("./img/展区/地点图钉.png"),
        exhibitionCompleted: images.read("./img/展区/已完成.png"),
        exhibitionIdle: images.read("./img/展区/空闲.png"),
        exhibitionClaimReward: images.read("./img/展区/领取奖励.png"),
        exhibitionTeamBuild: images.read("./img/展区/组建小队.png"),
        exhibitionAddHero: images.read("./img/展区/添加英雄.png"),
        exhibitionConfirmHero: images.read("./img/展区/确认英雄.png"),
        exhibitionStart: images.read("./img/展区/开始探险.png"),
        exhibitionClose: images.read("./img/展区/关闭.png"),
        // 返回图只保留按钮主体，排除寻宝/展区页面各自的背景和可能遮挡上沿的运行告警，避免共享按钮在不同页面失配。
        exhibitionBack: images.read("./img/展区/返回-按钮主体.png"),
        // 挂机奖励：全部从目标 MuMu 的 1080×2400 原始截图裁取，电视模板不包含动态倒计时。
        hangUpRewardEntry: images.read("./img/挂机奖励/闯关入口.png"),
        hangUpRewardTv: images.read("./img/挂机奖励/电视入口.png"),
        hangUpRewardTitle: images.read("./img/挂机奖励/标题.png"),
        hangUpRewardClaim: images.read("./img/挂机奖励/领取奖励.png"),
        hangUpRewardCongrats: images.read("./img/挂机奖励/恭喜获得.png"),
        hangUpRewardBack: images.read("./img/挂机奖励/返回.png"),
        // 情报：全部裁自 MuMu 1080×2400 原始截图；0 号箭头示意图不参与任何模板加载。
        intelligenceEntry: images.read("./img/情报/入口.png"),
        intelligenceTitle: images.read("./img/情报/标题.png"),
        intelligenceBubbleChest: images.read("./img/情报/气泡-宝箱.png"),
        intelligenceBubbleFlag: images.read("./img/情报/气泡-旗帜.png"),
        intelligenceBubbleTools: images.read("./img/情报/气泡-工具.png"),
        intelligenceBubbleAttack: images.read("./img/情报/气泡-攻击.png"),
        intelligenceBubbleLightning: images.read("./img/情报/气泡-闪电.png"),
        intelligenceBubbleSalvage: images.read("./img/情报/气泡-打捞.png"),
        intelligenceBubbleRescue: images.read("./img/情报/气泡-救助.png"),
        intelligenceDimBubble: images.read("./img/情报/进行中气泡.png"),
        // 仅保留固定的勾和按钮主体，排除随气泡等级、地图位置变化的外围背景。
        intelligenceCompletedCheck: images.read("./img/情报/完成勾-状态.png"),
        intelligenceGo: images.read("./img/情报/前往-按钮.png"),
        intelligenceEventSalvage: images.read("./img/情报/事件-打捞.png"),
        intelligenceEventAttack: images.read("./img/情报/事件-攻击.png"),
        // 两种按钮文案不能共用模板：避免“救助章鱼”等事件因文字不同而被安全拦截。
        intelligenceEventRescue: images.read("./img/情报/事件-解救.png"),
        intelligenceEventAid: images.read("./img/情报/事件-救助.png"),
        intelligenceEventExplore: images.read("./img/情报/事件-探查.png"),
        intelligenceEventOccupy: images.read("./img/情报/事件-占领.png"),
        intelligenceEventCollect: images.read("./img/情报/事件-征收.png"),
        intelligenceBack: images.read("./img/情报/返回.png"),
        intelligenceFleetClose: images.read("./img/情报/舰队关闭.png"),
        // 打捞资源：入口按钮和地图设施分开加载；设施只使用 MuMu 原始截图裁取，避免被白色引导手势或设备缩放干扰。
        gatherFishing: readOptionalImage("./img/打捞资源/钓鱼.png"),
        gatherScavenging: readOptionalImage("./img/打捞资源/拾荒.png"),
        gatherSalvage: readOptionalImage("./img/打捞资源/打捞.png"),
        gatherFishingFacility: readOptionalImage("./img/打捞资源/钓鱼设施.png"),
        gatherScavengingFacilityStateOne: readOptionalImage("./img/打捞资源/拾荒设施-状态一.png"),
        gatherScavengingFacilityStateTwo: readOptionalImage("./img/打捞资源/拾荒设施-状态二.png"),
        gatherSalvageFacility: readOptionalImage("./img/打捞资源/下潜设施.png"),
        gatherCast: readOptionalImage("./img/打捞资源/甩杆.png"),
        // 不限时拾荒/打捞满仓后显示专属返航按钮；未提供原始截图时对应类别必须安全跳过。
        gatherScavengingFullReturn: readOptionalImage("./img/打捞资源/拾荒满仓返航.png"),
        gatherSalvageFullReturn: readOptionalImage("./img/打捞资源/打捞满仓返航.png"),
        // 通用导航
        // 全屏奖励弹层完全展开后才出现，用作所有任务关闭奖励前的安全前置条件。
        rewardDismissHint: images.read("./img/通用/点击空白区域关闭.png"),
        baseIcon: images.read("./img/通用/基地.png"),
        worldIcon: images.read("./img/通用/世界.png"),
        forgeHouse: images.read("./img/通用/锻造屋.png"),
        forgeBack: images.read("./img/通用/锻造屋返回.png"),
        forgeSize: images.read("./img/通用/锻造屋大小.png")
    };
};

// 屏幕查找图片并点击中心 + 随机像素
gameHelper.findAndClick = function(targetImage, threshold, name) {
    if (typeof threshold === "string") { name = threshold; threshold = 0.7; }
    let screen = captureScreen();
    var result = images.findImage(screen, targetImage, {
        threshold: threshold || 0.7
    });
    var tag = name ? " [" + name + "]" : "";
    if (result) {
        console.log("找到图片" + tag + "，坐标：", result.x, result.y);
        click(
            result.x + targetImage.getWidth() / 2 + random(-10, 10),
            result.y + targetImage.getHeight() / 2 + random(-10, 10)
        );
        return true;
    } else {
        console.error("未找到图片" + tag);
        return false;
    }
};

/**
 * 在当前屏幕中查找模板并返回第一个坐标。
 * 每次识图完成都释放本次截图，避免长时间调度累积 Bitmap，最终让后续 `images.findImage` 使用已回收的图像资源。
 * @param {Object} targetImage 已加载的模板图片。
 * @param {number|string} [threshold] 图片相似度；第二参数为名称时使用默认值。
 * @param {string} [name] 日志中使用的图片名称。
 * @returns {{x: number, y: number}|null} 模板左上角坐标；未匹配时返回 null。
 */
gameHelper.findFirst = function(targetImage, threshold, name) {
    if (typeof threshold === "string") { name = threshold; threshold = 0.7; }
    var screen = captureScreen();
    var result;
    try {
        result = images.findImage(screen, targetImage, {
            threshold: threshold || 0.7
        });
    } finally {
        // 返回的是普通坐标对象，不再依赖截图本身；立即释放可防止循环调度耗尽截图缓冲区。
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
    var tag = name ? " [" + name + "]" : "";
    if (result) {
        console.log("找到图片" + tag + "，坐标：", result.x, result.y);
        return {
            x: result.x,
            y: result.y
        };
    }
    console.error("未找到图片" + tag);
    return null;
};

/**
 * 注册必要元素缺失后的主界面恢复处理器。
 * 处理器由入口在图片资源加载完成后设置，公共识图模块不直接依赖导航模块，从而避免循环引用。
 * @param {Function|null} handler 接收任务名、缺失位置和日志回调，成功恢复时返回 true。
 */
gameHelper.setMainSceneRecovery = function(handler) {
    mainSceneRecoveryHandler = typeof handler === "function" ? handler : null;
};

/**
 * 报告必要位置缺失并在记录诊断证据后尝试恢复主页。
 * 仅由已进入业务流程的硬性缺位调用；普通轮询结果不应使用此入口，以免把无奖励等正常状态误当异常。
 * @param {string} taskName 任务名称。
 * @param {string} positionName 未识别到的位置或模板名称。
 * @param {Function} [logFn] 可选的任务日志回调。
 * @returns {boolean} 已由注册处理器确认恢复到主界面时返回 true。
 */
gameHelper.reportRequiredPositionMissing = function(taskName, positionName, logFn) {
    var message = "[" + taskName + "] 未识别到必要位置“" + positionName + "”，本轮已停止操作";
    if (typeof logFn === "function" && typeof logFn.appendWarning === "function") logFn.appendWarning(message);
    else if (typeof logFn === "function") logFn(message);
    else console.error(message);
    if (typeof toast === "function") toast(message);

    if (!mainSceneRecoveryHandler) return false;
    if (mainSceneRecoveryInProgress) {
        // 恢复过程中再遇到缺位只保留原告警，不能递归触发第二条恢复链路。
        if (typeof logFn === "function") logFn("[" + taskName + "] 全局恢复正在执行，跳过嵌套恢复");
        return false;
    }

    mainSceneRecoveryInProgress = true;
    try {
        return mainSceneRecoveryHandler(taskName, positionName, logFn) === true;
    } catch (e) {
        var reason = e && e.message ? e.message : String(e);
        if (typeof logFn === "function") logFn("[" + taskName + "] 全局回主页恢复异常: " + reason);
        else console.error("[" + taskName + "] 全局回主页恢复异常: " + reason);
        return false;
    } finally {
        mainSceneRecoveryInProgress = false;
    }
};

/**
 * 报告任务继续执行所必需的界面位置或模板缺失。
 * 该安全失败入口恒返回 false，确保任务在恢复成功后也会结束当前业务动作，而不是继续使用失效上下文。
 * @param {string} taskName 任务名称。
 * @param {string} positionName 未识别到的位置或模板名称。
 * @param {Function} [logFn] 可选的任务日志回调。
 * @returns {false} 恒为 false，供调用方直接作为安全失败结果返回。
 */
gameHelper.notifyRequiredPositionMissing = function(taskName, positionName, logFn) {
    gameHelper.reportRequiredPositionMissing(taskName, positionName, logFn);
    return false;
};

/**
 * 等待全屏奖励弹层出现“点击空白区域关闭”提示后再允许后续点击。
 * 奖励列表较长时标题会先出现，提示文字才表示物品入场动画已结束，提前点击会被游戏忽略。
 * @param {Object} targetImage 底部关闭提示的原始截图模板。
 * @param {Function} [shouldStop] 可选停止标记；返回 true 时立即结束等待。
 * @param {string} [name] 日志中使用的任务名称。
 * @returns {boolean} 提示文字已确认时返回 true；超时、缺图或停止时返回 false。
 */
gameHelper.waitForRewardDismissHint = function(targetImage, shouldStop, name) {
    if (!targetImage) return false;
    var isStopRequested = typeof shouldStop === "function" ? shouldStop : function() { return false; };
    var tag = name ? " [" + name + "]" : "";
    for (var attempt = 0; attempt < REWARD_CLOSE_HINT_ATTEMPTS; attempt++) {
        if (isStopRequested()) return false;
        var screen = captureScreen();
        var result;
        try {
            result = images.findImage(screen, targetImage, { threshold: 0.8 });
        } finally {
            // 截图只服务于本次识图；回收失败不能覆盖已经取得的关闭提示判定。
            try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
        }
        if (result) {
            console.log("确认奖励关闭提示" + tag + "，坐标：", result.x, result.y);
            return true;
        }
        if (attempt < REWARD_CLOSE_HINT_ATTEMPTS - 1) sleep(REWARD_CLOSE_HINT_RETRY_DELAY_MS);
    }
    console.error("未确认奖励关闭提示" + tag);
    return false;
};

/**
 * 在指定区域内查找图片并返回第一个坐标。
 * 每次调用均回收本次截图，城战等高频区域扫描不会持有 Bitmap。
 * @param {Object} targetImage 已加载的模板图片。
 * @param {number} x 搜索区域左上角横坐标。
 * @param {number} y 搜索区域左上角纵坐标。
 * @param {number} w 搜索区域宽度。
 * @param {number} h 搜索区域高度。
 * @param {number} [threshold] 图片相似度。
 * @param {string} [name] 日志中使用的图片名称。
 * @returns {{x: number, y: number}|null} 模板左上角坐标；未匹配时返回 null。
 */
gameHelper.findFirstInRegion = function(targetImage, x, y, w, h, threshold, name) {
    var screen = captureScreen();
    var result;
    try {
        var regionX = Math.max(0, x);
        var regionY = Math.max(0, y);
        result = images.findImage(screen, targetImage, {
            threshold: threshold || 0.7,
            region: [regionX, regionY, w, h]
        });
    } finally {
        // 区域识图只返回坐标；异常路径也必须释放截图，避免连续城战扫描耗尽图像缓冲。
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
    var tag = name ? " [" + name + "]" : "";
    if (result) {
        console.log("区域内找到图片" + tag + "，坐标：", result.x, result.y);
        return { x: result.x, y: result.y };
    }
    console.error("区域内未找到图片" + tag);
    return null;
};

/**
 * 在指定区域以灰度图查找首个模板，忽略同一业务图标因等级或状态产生的颜色差异。
 * @param {Object} targetImage 原始彩色模板图片。
 * @param {number} x 区域左上角横坐标。
 * @param {number} y 区域左上角纵坐标。
 * @param {number} w 区域宽度。
 * @param {number} h 区域高度。
 * @param {number|string} [threshold] 相似度阈值，省略时使用 0.7；传名称时自动使用默认值。
 * @param {string} [name] 日志中使用的图片名称。
 * @returns {{x: number, y: number}|null} 灰度匹配坐标；未匹配时返回 null。
 */
gameHelper.findFirstInRegionInGrayscale = function(targetImage, x, y, w, h, threshold, name) {
    if (typeof threshold === "string") { name = threshold; threshold = 0.7; }
    var screen = captureScreen();
    var grayscaleScreen = null;
    var grayscaleTemplate = null;
    var tag = name ? " [" + name + "]" : "";
    try {
        // 仅灰度化本次搜索用的临时图，原始模板仍由调用方持有，避免多轮情报扫描累积 Bitmap。
        grayscaleScreen = images.grayscale(screen);
        grayscaleTemplate = images.grayscale(targetImage);
        var result = images.findImage(grayscaleScreen, grayscaleTemplate, {
            threshold: threshold || 0.7,
            region: [Math.max(0, x), Math.max(0, y), w, h]
        });
        if (result) {
            console.log("区域内灰度找到图片" + tag + "，坐标：", result.x, result.y);
            return { x: result.x, y: result.y };
        }
        console.error("区域内未找到灰度图片" + tag);
        return null;
    } finally {
        try { if (grayscaleTemplate && grayscaleTemplate.recycle) grayscaleTemplate.recycle(); } catch (e) {}
        try { if (grayscaleScreen && grayscaleScreen.recycle) grayscaleScreen.recycle(); } catch (e) {}
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
};

/**
 * 在当前屏幕查找全部模板位置。
 * 返回值只含普通坐标，匹配完成后可立即释放截图。
 * @param {Object} targetImage 已加载的模板图片。
 * @param {number|string} [threshold] 图片相似度；第二参数为名称时使用默认值。
 * @param {string} [name] 日志中使用的图片名称。
 * @returns {Array<{x: number, y: number}>} 全部模板左上角坐标。
 */
gameHelper.findAll = function(targetImage, threshold, name) {
    if (typeof threshold === "string") { name = threshold; threshold = 0.7; }
    var screen = captureScreen();
    var matches;
    try {
        var result = images.matchTemplate(screen, targetImage, {
            threshold: threshold || 0.7,
            max: 20
        });
        matches = result.matches;
    } finally {
        // 结果会在释放截图前复制为坐标，确保高频多目标扫描不泄漏 Bitmap。
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
    var tag = name ? " [" + name + "]" : "";
    matches.forEach(function(match) {
        log("找到图片" + tag + " point=" + match.point + " similarity=" + match.similarity);
    });
    return matches.map(function(match) {
        return { x: match.point.x, y: match.point.y };
    });
};

/**
 * 在灰度化后的画面中查找多个模板位置，消除情报气泡蓝、紫、橙等级颜色对同一白色事件图标的干扰。
 * @param {Object} targetImage 原始彩色模板图片。
 * @param {number|string} [threshold] 图片相似度，省略时使用 0.7；第二参数为名称时自动使用默认值。
 * @param {string} [name] 日志中使用的图片名称。
 * @returns {Array<{x: number, y: number}>} 所有匹配位置。
 */
gameHelper.findAllInGrayscale = function(targetImage, threshold, name) {
    if (typeof threshold === "string") { name = threshold; threshold = 0.7; }
    var screen = captureScreen();
    var grayscaleScreen = null;
    var grayscaleTemplate = null;
    var tag = name ? " [" + name + "]" : "";
    try {
        // 情报同一事件会按等级换色；灰度化后保留图标轮廓，避免因颜色变化漏掉可派遣气泡。
        grayscaleScreen = images.grayscale(screen);
        grayscaleTemplate = images.grayscale(targetImage);
        var result = images.matchTemplate(grayscaleScreen, grayscaleTemplate, {
            threshold: threshold || 0.7,
            max: 20
        });
        result.matches.forEach(function(match) {
            log("灰度找到图片" + tag + " point=" + match.point + " similarity=" + match.similarity);
        });
        return result.matches.map(function(match) {
            return { x: match.point.x, y: match.point.y };
        });
    } finally {
        // 灰度临时图和本次截图都只用于匹配；及时回收避免总调度多轮扫描积累 Bitmap 内存。
        try { if (grayscaleTemplate && grayscaleTemplate.recycle) grayscaleTemplate.recycle(); } catch (e) {}
        try { if (grayscaleScreen && grayscaleScreen.recycle) grayscaleScreen.recycle(); } catch (e) {}
        try { if (screen && screen.recycle) screen.recycle(); } catch (e) {}
    }
};

// 屏幕查找图片并根据使用二值化过滤无效土地
gameHelper.findAllToFilter = function(targetImage, threshold, name, colorThreshold) {
    if (typeof threshold === "string") { name = threshold; threshold = 0.7; }
    let screen = captureScreen();
    var result = images.matchTemplate(screen, targetImage, {
        threshold: threshold || 0.7,
        max: 20
    });
    var tag = name ? " [" + name + "]" : "";
    let res = result.matches.filter(item=>{
        let tmp =  images.clip(screen, item.point.x, item.point.y, targetImage.getWidth(), targetImage.getHeight());
        let tmp2 = images.threshold(tmp, colorThreshold, 255);
        let isValid = !images.findColor(tmp2, "#000000");
        tmp.recycle();
        tmp2.recycle();
        if(isValid){
            return true;
        }else{
            return false;
        }
    });
    
    console.log("检测到" + res.length +"个" + tag);
    return res.map(item => {
        return { x: item.point.x, y: item.point.y };
    });;
};

// 稳定土地检测：第一次有匹配才继续，至少跑5次，出现两个不同数量后取多的
gameHelper.findLandStable = function(targetImage, threshold, name, colorThreshold) {
    // 第一次检测，没有匹配直接返回
    var first = gameHelper.findAllToFilter(targetImage, threshold, name, colorThreshold);
    if (first.length === 0) return [];

    var counts = [first.length];
    var results = [first];
    // 直到出现不同数量
    while(true){
        var r = gameHelper.findAllToFilter(targetImage, threshold, name, colorThreshold);
        counts.push(r.length);
        results.push(r);
        if (r.length !== first.length) break;
        sleep(200);
    }
    // 取数量最多的那次
    var maxIdx = 0;
    for (var j = 1; j < counts.length; j++) {
        if (counts[j] > counts[maxIdx]) maxIdx = j;
    }
    return results[maxIdx];
};

// 显示检测结果叠加层（非阻塞，1.5秒后自动消失）
gameHelper.showOverlay = function(matches, img) {
    if (!matches) return;
    if (!Array.isArray(matches)) matches = [matches];
    if (matches.length === 0) return;
    var imgW = img.getWidth(), imgH = img.getHeight();
    var overlay;
    $ui.run(function() {
        var boxColor = "#22c55e";
        var resId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
        var statusBarH = context.getResources().getDimensionPixelSize(resId);

        overlay = floaty.rawWindow(
            <frame id="root" bg="#00000000">
                <canvas id="cv" w="*" h="*"/>
            </frame>
        );
        overlay.setSize(-1, -1);
        overlay.setPosition(0, 0);
        overlay.setTouchable(false);

        overlay.cv.on("draw", function(canvas) {
            canvas.drawARGB(0, 0, 0, 0);
            canvas.translate(0, -statusBarH);

            var boxPaint = new Paint();
            boxPaint.setAntiAlias(true);
            boxPaint.setStyle(Paint.Style.STROKE);
            boxPaint.setStrokeWidth(6);
            boxPaint.setColor(colors.parseColor(boxColor));

            var textPaint = new Paint();
            textPaint.setAntiAlias(true);
            textPaint.setTextSize(36);
            textPaint.setColor(colors.parseColor(boxColor));

            for (var i = 0; i < matches.length; i++) {
                var x = matches[i].x, y = matches[i].y;
                canvas.drawRect(x, y, x + imgW, y + imgH, boxPaint);
                canvas.drawText("#" + (i+1) + " (" + x + "," + y + ")", x, y - 8, textPaint);
            }
        });

        overlay.cv.invalidate();
    });
    // 异步关闭，不阻塞主流程
    threads.start(function() {
        sleep(1500);
        try { if (overlay) { overlay.close(); overlay = null; } } catch(e) {}
    });
};

// 显示矩形区域叠加层（非阻塞，1.5秒后自动消失）
// region: [x, y, w, h]，label: 可选文字标签，color: 可选颜色，默认橙色
gameHelper.showRegionOverlay = function(region, label, color) {
    if (!region || region.length < 4) return;
    var rx = region[0], ry = region[1], rw = region[2], rh = region[3];
    var boxColor = color || "#f97316";
    var overlay;
    $ui.run(function() {
        var dm = context.getResources().getDisplayMetrics();
        var resId = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
        var statusBarH = context.getResources().getDimensionPixelSize(resId);

        overlay = floaty.rawWindow(
            <frame id="root" bg="#00000000">
                <canvas id="cv" w="*" h="*"/>
            </frame>
        );
        overlay.setSize(-1, -1);
        overlay.setPosition(0, 0);
        overlay.setTouchable(false);

        overlay.cv.on("draw", function(canvas) {
            canvas.drawARGB(0, 0, 0, 0);
            canvas.translate(0, -statusBarH);

            var paint = new Paint();
            paint.setAntiAlias(true);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(4);
            paint.setColor(colors.parseColor(boxColor));

            canvas.drawRect(rx, ry, rx + rw, ry + rh, paint);

            var textPaint = new Paint();
            textPaint.setAntiAlias(true);
            textPaint.setTextSize(32);
            textPaint.setColor(colors.parseColor(boxColor));

            var lbl = label || ("Region [" + rx + "," + ry + "," + rw + "," + rh + "]");
            canvas.drawText(lbl, rx + 4, ry - 6, textPaint);
        });

        overlay.cv.invalidate();
    });
    threads.start(function() {
        sleep(1500);
        try { if (overlay) { overlay.close(); overlay = null; } } catch(e) {}
    });
};

// 双指向内收拢（缩小地图）
gameHelper.pinchZoomOut = function() {
    console.log("双指向内收拢（缩小地图）");
    var dm = context.getResources().getDisplayMetrics();
    var cx = Math.round(dm.widthPixels / 2);
    var cy = Math.round(dm.heightPixels / 2);
    gestures(
        [0, 800, [cx - 300, cy - 100], [cx - 50, cy]],
        [0, 800, [cx + 300, cy + 100], [cx + 50, cy]]
    );
};

// 查找最高点
gameHelper.getMaxYPoint = function(points) {
    var topMatch = points[0];
    for (var i = 1; i < points.length; i++) {
        if (points[i].y < topMatch.y) topMatch = points[i];
    }
    return topMatch;
};

// 获取真实物理分辨率 [width, height]
gameHelper.getRealResolution = function() {
    var wm = context.getSystemService(android.content.Context.WINDOW_SERVICE);
    var display = wm.getDefaultDisplay();
    var realDm = new android.util.DisplayMetrics();
    display.getRealMetrics(realDm);
    return [realDm.widthPixels, realDm.heightPixels];
};

// 应用列表权限
gameHelper.hasPackageListPerm = function() {
    try {
        return context.getPackageManager().getInstalledPackages(0).size() > 1;
    } catch(e) { return false; }
};

// 无障碍权限
gameHelper.hasAccessibilityPerm = function() {
    try {
        var accStr = android.provider.Settings.Secure.getString(
            context.getContentResolver(),
            android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        if (!accStr) return false;
        var lower = accStr.toLowerCase();
        var pkg = context.getPackageName().toLowerCase();
        return lower.indexOf(pkg) >= 0;
    } catch(e) { return false; }
};

// 后台弹出界面权限
gameHelper.hasBackgroundPopupPerm = function() {
    try {
        var appOps = context.getSystemService(android.content.Context.APP_OPS_SERVICE);
        var mode = appOps.checkOpNoThrow(
            android.app.AppOpsManager.OP_SYSTEM_ALERT_WINDOW,
            android.os.Process.myUid(),
            context.getPackageName()
        );
        return mode === android.app.AppOpsManager.MODE_ALLOWED;
    } catch(e) { return false; }
};

// 悬浮窗权限
gameHelper.hasOverlayPerm = function() {
    try {
        return android.provider.Settings.canDrawOverlays(context);
    } catch(e) { return false; }
};

module.exports = gameHelper;
