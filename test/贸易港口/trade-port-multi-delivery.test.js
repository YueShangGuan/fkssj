// Node 回归测试：验证贸易港口同屏多条“全部交货”不会因其中一条材料不足而中断。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/**
 * 创建仅含尺寸和名称的模板替身，满足贸易港口模块的模板中心点击计算。
 * @param {string} name 模板名称。
 * @param {number} [width=100] 模板宽度。
 * @param {number} [height=100] 模板高度。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} 模板替身。
 */
function makeImage(name, width, height) {
    return {
        name: name,
        getWidth: function() { return width || 100; },
        getHeight: function() { return height || 100; }
    };
}

const imgs = {
    baseIcon: makeImage("baseIcon"),
    tradePortEntry: makeImage("entry"),
    tradePortReceive: makeImage("receive"),
    tradePortRewardTitle: makeImage("rewardTitle"),
    rewardDismissHint: makeImage("rewardDismissHint"),
    tradePortAllDeliver: makeImage("allDeliver"),
    tradePortInsufficient: makeImage("insufficient"),
    tradePortInsufficientClose: makeImage("insufficientClose"),
    tradePortClose: makeImage("portClose")
};
// 完整入口模板会被绿色勾覆盖而失配；测试只让模块裁出的稳定主体命中。
const stableTradePortEntry = makeImage("stableEntry", 100, 48);
const logs = [];
const receiveCenters = [];
const deliveryCenters = [];
const entryClipCalls = [];
let receiveRewardOpen = false;
let receiveRewardCloseClicks = 0;
let rewardTitleChecksSinceReceive = 0;
let insufficientDialogOpen = false;
let insufficientCloseClicks = 0;
let portCloseClicks = 0;
let fullEntrySearches = 0;
let stableEntrySearches = 0;
let stableEntryRecycleCount = 0;
let portEntryClicks = 0;

// 生产代码会在本轮识图结束时释放临时裁图；测试记录释放次数，防止回归为每轮泄漏 Bitmap。
/**
 * 模拟 AutoJs 临时 Bitmap 的回收，并记录调用次数供断言使用。
 * @returns {void}
 */
stableTradePortEntry.recycle = function() {
    stableEntryRecycleCount++;
};

const gh = {
    /**
 * 返回三条乱序的收货或交货按钮，模拟模板匹配结果不保证视觉顺序的情况。
     * @param {Object} image 查询模板。
     * @returns {Array<Object>} 当前匹配坐标。
     */
    findAll: function(image) {
        if (image === imgs.tradePortReceive) {
            return [{ x: 400, y: 700 }, { x: 400, y: 300 }, { x: 400, y: 500 }];
        }
        if (image === imgs.tradePortAllDeliver) {
            return [{ x: 700, y: 1800 }, { x: 700, y: 800 }, { x: 700, y: 1300 }];
        }
        return [];
    },
    /**
     * 完整入口模板模拟被绿色勾遮挡而失配，稳定裁图可命中；收货后模拟两帧结算动画才显示奖励标题，第二条交货后展示材料不足提示。
     * @param {Object} image 查询模板。
     * @returns {Object|null} 当前匹配坐标。
     */
    findFirst: function(image) {
        if (image === imgs.tradePortEntry) {
            fullEntrySearches++;
            return null;
        }
        if (image === stableTradePortEntry) {
            stableEntrySearches++;
            return { x: 100, y: 100 };
        }
        if (image === imgs.tradePortClose) return { x: 950, y: 50 };
        if (image === imgs.tradePortRewardTitle && receiveRewardOpen) {
            rewardTitleChecksSinceReceive++;
            return rewardTitleChecksSinceReceive >= 3 ? { x: 200, y: 900 } : null;
        }
        if (image === imgs.tradePortInsufficient && insufficientDialogOpen) return { x: 400, y: 600 };
        if (image === imgs.tradePortInsufficientClose && insufficientDialogOpen) return { x: 600, y: 700 };
        return null;
    },
    // 收货奖励层已打开时，模拟底部“点击空白区域关闭”提示已经完成入场。
    waitForRewardDismissHint: function(image) {
        return image === imgs.rewardDismissHint && receiveRewardOpen;
    }
};

const fakeImages = {
    /**
     * 记录入口模板裁图参数，并返回不含绿色勾的稳定主体替身。
     * @param {Object} image 原始模板。
     * @param {number} x 裁图起点横坐标。
     * @param {number} y 裁图起点纵坐标。
     * @param {number} width 裁图宽度。
     * @param {number} height 裁图高度。
     * @returns {Object} 稳定入口模板替身。
     */
    clip: function(image, x, y, width, height) {
        entryClipCalls.push({ image: image, x: x, y: y, width: width, height: height });
        return stableTradePortEntry;
    }
};

/**
 * 记录收货、交货及关闭点击；收货均弹出带延迟标题的奖励层，第二条交货弹出材料不足对话框。
 * @param {number} x 点击横坐标。
 * @param {number} y 点击纵坐标。
 */
function fakeClick(x, y) {
    if (x === 150 && y === 150) {
        portEntryClicks++;
        return;
    }
    if (x === 450 && (y === 350 || y === 550 || y === 750)) {
        receiveCenters.push(y);
        receiveRewardOpen = true;
        rewardTitleChecksSinceReceive = 0;
        return;
    }
    if (x === 540 && y === 1800) {
        receiveRewardOpen = false;
        receiveRewardCloseClicks++;
        return;
    }
    if (x === 750 && (y === 850 || y === 1350 || y === 1850)) {
        deliveryCenters.push(y);
        // 用户当前画面中第二条订单材料不足，其他订单应继续尝试。
        insufficientDialogOpen = y === 1350;
        return;
    }
    if (x === 650 && y === 750) {
        insufficientDialogOpen = false;
        insufficientCloseClicks++;
        return;
    }
    if (x === 1000 && y === 100) portCloseClicks++;
}

/**
 * 为被测模块提供仅限本测试的依赖，避免连接 AutoJs 运行环境。
 * @param {string} request 被测模块请求的相对依赖路径。
 * @returns {Object} 对应的测试替身。
 */
function fakeRequire(request) {
    if (request === "./gameHelper.js") return gh;
    if (request === "./navigate.js") return { detectScene: function() { return "base"; } };
    throw new Error("Unexpected require: " + request);
}

const sourcePath = path.join(__dirname, "..", "..", "modules", "tradePort.js");
const context = {
    module: { exports: {} },
    exports: {},
    require: fakeRequire,
    click: fakeClick,
    random: function() { return 0; },
    sleep: function() {},
    log: function(message) { logs.push(message); },
    console: console,
    Date: Date,
    images: fakeImages
};
vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });

let completedAt = 0;
const result = context.module.exports.runOnce(
    imgs,
    10,
    0,
    function(message) { logs.push(message); },
    function() { return false; },
    function(value) { completedAt = value; }
);

assert.strictEqual(fullEntrySearches, 0, "绿色勾出现时不能继续使用会被遮挡的完整入口模板");
assert.strictEqual(stableEntrySearches, 1, "应使用不含绿色勾的入口稳定主体定位");
assert.strictEqual(entryClipCalls.length, 1, "每次港口检查只应创建一次入口稳定裁图");
assert.strictEqual(entryClipCalls[0].image, imgs.tradePortEntry, "稳定裁图必须来自贸易港口入口模板");
assert.deepStrictEqual(
    [entryClipCalls[0].x, entryClipCalls[0].y, entryClipCalls[0].width, entryClipCalls[0].height],
    [0, 0, 100, 48],
    "稳定裁图应只保留未被绿色勾覆盖的入口上半部"
);
assert.strictEqual(stableEntryRecycleCount, 1, "入口稳定裁图在识别后必须释放");
assert.strictEqual(portEntryClicks, 1, "识别稳定主体后仍应点击完整入口的中心");
assert.deepStrictEqual(deliveryCenters, [850, 1350, 1850], "三条交货必须按从上到下全部点击");
assert.deepStrictEqual(receiveCenters, [350, 550, 750], "三条收货必须按从上到下全部点击");
assert.strictEqual(rewardTitleChecksSinceReceive, 3, "每条收货应等待结算动画后的奖励标题，而不是单次识图就判定无奖励");
assert.strictEqual(receiveRewardCloseClicks, 3, "每条收货的奖励层都应被安全关闭");
assert.strictEqual(insufficientCloseClicks, 1, "只有材料不足的第二条应关闭提示");
assert.strictEqual(portCloseClicks, 1, "完成后应关闭贸易港口弹窗");
assert.ok(logs.some(function(message) { return message.indexOf("全部交货失败：所需产品不足") >= 0; }), "应记录材料不足");
assert.strictEqual(logs.filter(function(message) { return message.indexOf("未见已知失败提示") >= 0; }).length, 2, "其他两条不应被误判为材料不足");
assert.strictEqual(result.completed, true, "关闭港口弹窗后应记为完成");
assert.ok(completedAt > 0, "完成时间必须写回持久化回调");
console.log("trade-port multi-delivery test passed");
