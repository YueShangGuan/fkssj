// resourceGather.test.js — 使用 Node 桩验证不依赖 AutoJs6 设备的安全分支

var assert = require("assert");
var Module = require("module");

var clicks = [];
var logs = [];
var currentFraction = "660/660";
var rowFractions = null;
var detectCount = 0;
var detectedRegions = [];
var toastMessages = [];
var isInMainScene = true;
var mainSceneIcon = { name: "世界图标" };
var facilityImage = null;
var facilityMatchPoint = null;
var actionImage = null;
var actionMatchPoint = null;
var pinchCalls = 0;
var overlayCalls = [];
var interactionEvents = [];
var fakeGameHelper = {
    /**
     * 返回测试固定的游戏分辨率，使资源固定坐标保持与设备基准一致。
     * @returns {number[]} 1080×2400 的模拟截图分辨率。
     */
    getRealResolution: function() { return [1080, 2400]; },
    /**
     * 记录设施框选请求，验证资源流程把已命中的模板交给非触控绿色叠加层。
     * @param {{x: number, y: number}} point 已识别模板的左上角坐标。
     * @param {Object} image 与识别结果对应的模板图片。
     */
    showOverlay: function(point, image) {
        overlayCalls.push({ point: point, image: image });
        interactionEvents.push(["overlay", point.x, point.y]);
    }
};
var fakeNavigate = {
    /**
     * 记录资源流程是否复用了两次缩小地图的导航入口。
     * @param {Function} taskLog 任务日志回调；该桩不需要写入日志。
     */
    pinchZoomOut: function(taskLog) {
        pinchCalls++;
    }
};
var originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
    if (request === "./gameHelper.js") return fakeGameHelper;
    if (request === "./navigate.js") return fakeNavigate;
    return originalLoad.call(this, request, parent, isMain);
};

/**
 * 模拟 AutoJs 触控，并与绿色框事件一起记录顺序以验证先框选后点击。
 * @param {number} x 点击横坐标。
 * @param {number} y 点击纵坐标。
 */
global.click = function(x, y) {
    clicks.push([x, y]);
    interactionEvents.push(["click", x, y]);
};
global.sleep = function() {};
global.log = function() {};
global.toast = function(message) { toastMessages.push(message); };
global.captureScreen = function() {
    return { recycle: function() {} };
};
global.images = {
    /**
     * 仅为主界面守卫返回模板坐标；OCR 测试本身不依赖图片匹配。
     * @param {Object} screen 当前截图桩。
     * @param {Object} image 被查找的模板。
     * @returns {{x: number, y: number}|null} 模拟主界面状态对应的匹配位置。
     */
    findImage: function(screen, image) {
        if (isInMainScene && image === mainSceneIcon) return { x: 10, y: 20 };
        if (image === actionImage) return actionMatchPoint;
        return null;
    },
    /**
     * 为设施匹配返回带相似度的结果，验证资源模块通过 matchTemplate 选择设施而非第一个普通找图结果。
     * @param {Object} screen 当前截图桩。
     * @param {Object} image 待匹配的设施模板。
     * @returns {{matches: Array}} 模拟的模板匹配结果。
     */
    matchTemplate: function(screen, image) {
        if (image !== facilityImage || !facilityMatchPoint) return { matches: [] };
        return {
            matches: [{ point: facilityMatchPoint, similarity: 0.99 }]
        };
    }
};
global.ocr = {
    mlkit: {
        detect: function(screen, region) {
            var rowIndex = detectCount % 7;
            detectCount++;
            detectedRegions.push(region);
            return [{ label: rowFractions ? rowFractions[rowIndex] : currentFraction, bounds: { left: 0 } }];
        }
    }
};

var resourceGather = require("../../modules/resourceGather.js");

/**
 * 用相同配置运行一次，并收集触屏、日志与 OCR 调用次数。
 * @param {Object} overrides 需要覆盖的任务配置。
 * @param {Object} [taskImages] 覆盖默认主界面模板的任务图片，用于验证具体入口分支。
 * @param {Function} [taskLog] 覆盖默认日志回调，用于验证结构化告警通道。
 * @returns {string} resourceGather 返回的状态。
 */
function runOnce(overrides, taskImages, taskLog) {
    clicks = [];
    logs = [];
    toastMessages = [];
    detectCount = 0;
    detectedRegions = [];
    pinchCalls = 0;
    overlayCalls = [];
    interactionEvents = [];
    var config = {
        intervalMinutes: 60,
        thresholdPercent: 90,
        durationMinutes: 5,
        lastCompletedAt: 0
    };
    Object.keys(overrides || {}).forEach(function(key) { config[key] = overrides[key]; });
    return resourceGather.runOnce(taskImages || { baseIcon: mainSceneIcon }, config, function() { return false; }, taskLog || function(message) { logs.push(message); });
}

currentFraction = "660/660";
assert.strictEqual(runOnce(), "completed");
assert.strictEqual(detectCount, 7);
assert.deepStrictEqual(clicks, [[78, 200], [972, 491]]);
assert.deepStrictEqual(detectedRegions, [
    [570, 570, 230, 65], [570, 740, 230, 65], [570, 910, 230, 65], [570, 1080, 230, 65],
    [570, 1250, 230, 65], [570, 1420, 230, 65], [570, 1590, 230, 65]
]);

// 恰好 90% 时不触发：业务规则是严格低于阈值。
currentFraction = "594/660";
assert.strictEqual(runOnce(), "completed");
assert.deepStrictEqual(clicks, [[78, 200], [972, 491]]);

// OCR 未能给出“当前/容量”时必须关闭弹窗并返回失败，不能点击任何“获取”。
currentFraction = "594660";
assert.strictEqual(runOnce(), "failed");
assert.deepStrictEqual(clicks, [[78, 200], [972, 491]]);
assert.ok(logs[0].indexOf("无法识别") >= 0);

// 冷却分支在进入游戏工具、截图和 OCR 之前直接返回。
currentFraction = "660/660";
assert.strictEqual(runOnce({ lastCompletedAt: Date.now() }), "cooldown");
assert.strictEqual(detectCount, 0);
assert.deepStrictEqual(clicks, []);

// 不在主界面时，任务必须先提示并安全跳过；不能截图、OCR 或点击资源入口等固定坐标。
isInMainScene = false;
assert.strictEqual(runOnce(), "failed");
assert.strictEqual(detectCount, 0);
assert.deepStrictEqual(clicks, []);
assert.deepStrictEqual(toastMessages, ["[打捞资源] 未在游戏主界面，已跳过本轮"]);
assert.ok(logs.some(function(message) { return message.indexOf("未在游戏主界面") >= 0; }));
isInMainScene = true;

// 不限时时，低库存的拾荒/打捞必须只记录跳过，不能进入地图或点击采集入口。
rowFractions = ["660/660", "593/660", "660/660", "660/660", "660/660", "660/660", "660/660"];
assert.strictEqual(runOnce({ durationMinutes: null }), "completed");
assert.deepStrictEqual(clicks, [[78, 200], [972, 491]]);
assert.ok(logs.some(function(message) { return message.indexOf("不限时时跳过“拾荒”") >= 0; }));
rowFractions = null;

// 阈值以下但尚未裁取原始设备模板时，应安全失败且不进入采集场景。
currentFraction = "593/660";
assert.strictEqual(runOnce(), "failed");
assert.deepStrictEqual(clicks, [[78, 200], [972, 491]]);
assert.ok(logs.some(function(message) { return message.indexOf("缺少“钓鱼”") >= 0; }));

// 钓鱼入口短暂缺失时，必须先缩小两次、框选并点击识别到的设施；入口仍未出现才报告入口缺位。
var fishingActionImage = {
    name: "钓鱼入口",
    getWidth: function() { return 178; },
    getHeight: function() { return 195; }
};
var fishingFacilityImage = {
    name: "钓鱼设施",
    getWidth: function() { return 190; },
    getHeight: function() { return 210; }
};
var fishingCastImage = {
    name: "甩杆",
    getWidth: function() { return 180; },
    getHeight: function() { return 180; }
};
var warningMessages = [];
facilityImage = fishingFacilityImage;
facilityMatchPoint = { x: 500, y: 680 };
actionImage = fishingActionImage;
actionMatchPoint = null;
/**
 * 模拟调度器的普通业务日志回调。
 * @param {string} message 本轮输出的普通日志。
 */
function warningLog(message) { logs.push(message); }
/**
 * 模拟 main.js 附加到调度日志上的结构化告警通道。
 * @param {string} message 需要保存现场证据的告警文本。
 */
function appendStructuredWarning(message) { warningMessages.push(message); }
warningLog.appendWarning = appendStructuredWarning;
assert.strictEqual(runOnce({}, {
    baseIcon: mainSceneIcon,
    gatherFishing: fishingActionImage,
    gatherFishingFacility: fishingFacilityImage,
    gatherCast: fishingCastImage
}, warningLog), "unconfirmed");
// 首个低库存分类直接使用 OCR 后仍打开的资源窗，因此点击“获取”前不应出现关闭再重开的固定坐标。
assert.deepStrictEqual(clicks, [[78, 200], [902, 671], [898, 1068], [595, 785]]);
assert.strictEqual(pinchCalls, 1, "前往后必须通过导航模块连续缩小两次地图");
assert.deepStrictEqual(toastMessages, []);
assert.deepStrictEqual(warningMessages, ["[打捞资源] 未识别到必要位置“钓鱼入口”，本轮已停止操作"]);
assert.ok(
    logs.some(function(message) {
        return message.indexOf("模板: 钓鱼设施；相似度: 0.990；中心: 595,785") >= 0;
    }),
    "设施点击日志必须记录模板、相似度和实际中心点，便于下次现场核对"
);
assert.deepStrictEqual(overlayCalls, [{ point: { x: 500, y: 680 }, image: fishingFacilityImage }]);
assert.deepStrictEqual(
    interactionEvents.slice(-2),
    [["overlay", 500, 680], ["click", 595, 785]],
    "必须先绘制设施识别框，再点击同一模板的中心"
);

// 设施模板缺失时只报告明确的设施位置，不能退回到白色手势或固定地图点击。
facilityMatchPoint = null;
warningMessages = [];
assert.strictEqual(runOnce({}, {
    baseIcon: mainSceneIcon,
    gatherFishing: fishingActionImage,
    gatherFishingFacility: fishingFacilityImage,
    gatherCast: fishingCastImage
}, warningLog), "failed");
assert.deepStrictEqual(clicks, [[78, 200], [902, 671], [898, 1068]]);
assert.strictEqual(pinchCalls, 1);
assert.deepStrictEqual(overlayCalls, []);
assert.deepStrictEqual(warningMessages, ["[打捞资源] 未识别到必要位置“钓鱼设施”，本轮已停止操作"]);

console.log("resourceGather tests passed");
