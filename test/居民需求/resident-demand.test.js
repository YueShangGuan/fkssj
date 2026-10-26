// resident-demand.test.js — 以 Node VM 覆盖居民需求的冷却、动态标签、OCR/颜色守卫与安全返回

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var sourcePath = path.join(__dirname, "..", "..", "modules", "residentDemand.js");
var source = fs.readFileSync(sourcePath, "utf8") + [
    "module.exports._test = {",
    "getLocalDateKey: getLocalDateKey,",
    "isSameLocalDate: isSameLocalDate,",
    "isLocalDateKey: isLocalDateKey,",
    "isCompletedOnCurrentDate: isCompletedOnCurrentDate,",
    "isInCooldown: isInCooldown,",
    "scanResidentTabs: scanResidentTabs,",
    "getNextResidentTab: getNextResidentTab,",
    "parseRewardValue: parseRewardValue",
    "};"
].join("\n");

/**
 * 构造带有固定尺寸的模板替身，使 VM 测试只验证状态机而不依赖真实 AutoJs 图片对象。
 * @param {string} name 逻辑模板名称。
 * @returns {{name:string,getWidth:Function,getHeight:Function}} 模板替身。
 */
function makeImage(name) {
    return {
        name: name,
        getWidth: function() { return 20; },
        getHeight: function() { return 20; }
    };
}

/**
 * 构造居民需求模块的完整模板集合；缺图用例会主动删除其中某一项。
 * @returns {Object} 模板键到替身图片的映射。
 */
function makeImages() {
    var names = [
        "baseIcon", "worldIcon", "tradePortEntry", "residentDemandPanel",
        "residentDemandSatisfy", "residentDemandRefresh", "residentDemandImmediateComplete", "residentDemandBack"
    ];
    var imgs = {};
    names.forEach(function(name) { imgs[name] = makeImage(name); });
    return imgs;
}

/**
 * 为 VM 提供可控的设备本地时间。构造函数仍返回真实 Date 实例，因而模块使用 getFullYear/getDate 时与生产一致。
 * @param {number|number[]} now 固定毫秒时间戳，或按 Date.now 调用顺序返回的时间序列。
 * @returns {Function} 可作为全局 Date 注入的构造函数。
 */
function makeDate(now) {
    var values = Array.isArray(now) ? now.slice() : [now];
    var latest = values.length ? values[values.length - 1] : 0;
    /**
     * 返回下一次虚拟当前时间；序列耗尽后保持最后一个时刻，模拟真实时钟持续向前后的稳定读取。
     * @returns {number} 当前虚拟毫秒时间戳。
     */
    function getNow() {
        if (values.length) latest = values.shift();
        return latest;
    }
    function FakeDate(value) {
        if (arguments.length === 0) return new Date(getNow());
        // 居民完成日期会用 new Date(year, month, day) 验证真实日历日；替身必须转发多参数构造，不能把年份误当 1970 起的毫秒数。
        if (arguments.length === 1) return new Date(value);
        if (arguments.length === 2) return new Date(arguments[0], arguments[1]);
        if (arguments.length === 3) return new Date(arguments[0], arguments[1], arguments[2]);
        if (arguments.length === 4) return new Date(arguments[0], arguments[1], arguments[2], arguments[3]);
        if (arguments.length === 5) return new Date(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4]);
        if (arguments.length === 6) return new Date(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]);
        return new Date(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], arguments[5], arguments[6]);
    }
    FakeDate.now = function() { return getNow(); };
    FakeDate.parse = Date.parse;
    FakeDate.UTC = Date.UTC;
    return FakeDate;
}

/**
 * 在隔离 VM 中加载居民需求模块。
 * @param {Object} overrides AutoJs6 全局 API、require 或当前时间替身。
 * @returns {{api:Object,context:Object}} 模块与 VM 上下文。
 */
function loadResidentDemand(overrides) {
    overrides = overrides || {};
    var context = {
        module: { exports: {} },
        exports: {},
        require: overrides.require || function() { throw new Error("Unexpected require"); },
        click: overrides.click || function() {},
        sleep: overrides.sleep || function() {},
        log: overrides.log || function() {},
        captureScreen: overrides.captureScreen || function() { return { getWidth: function() { return 1080; }, getHeight: function() { return 2400; }, recycle: function() {} }; },
        images: overrides.images || { pixel: function() { return 0xFF2D3280; } },
        ocr: overrides.ocr || { rapid: { detect: function() { return []; } } },
        Date: overrides.Date || Date,
        console: console
    };
    vm.runInNewContext(source, context, { filename: sourcePath });
    return { api: context.module.exports, context: context };
}

/**
 * 将槽位序号对应到居民标签中心，便于 click 替身确认自动化只点击已确认标签。
 * @param {number} x 点击横坐标。
 * @returns {number|null} 命中的标签序号。
 */
function getTabIndexByX(x) {
    var centers = [180, 420, 660, 900];
    for (var i = 0; i < centers.length; i++) {
        // 标签主体宽约 180 像素；扫描会覆盖头像和姓名多个采样点，不能只识别中心 30 像素。
        if (Math.abs(x - centers[i]) <= 100) return i;
    }
    return null;
}

/**
 * 将物资数量栏的横坐标映射到左、中、右三个固定槽位，以便 VM 夹具精确复现仅一项物资变红的画面。
 * @param {number} x 像素横坐标。
 * @returns {number|null} 物资栏索引；不在数值区时返回 null。
 */
function getMaterialNumberIndexByX(x) {
    var ranges = [[220, 350], [460, 590], [710, 840]];
    for (var i = 0; i < ranges.length; i++) {
        if (x >= ranges[i][0] && x <= ranges[i][1]) return i;
    }
    return null;
}

/**
 * 创建可驱动完整 runOnce 流程的面板状态机。标签数组只包含实际存在的槽位，
 * 因此同一测试可验证 4→3→2→1 与最后一位协商中的不同状态。
 * @param {Object} input 场景初始状态。
 * @returns {{loaded:Object,imgs:Object,state:Object,clicks:Array,callbacks:Array}} 可执行测试夹具。
 */
function createScenario(input) {
    var now = input.now;
    var imgs = makeImages();
    var state = {
        page: "base",
        mode: input.mode || "normal",
        tabs: (input.tabs || [0]).slice(),
        selected: input.selected === undefined ? (input.tabs && input.tabs.length ? input.tabs[0] : null) : input.selected,
        experience: input.experience,
        gold: input.gold,
        materialRedIndices: Array.isArray(input.redMaterialIndices) ? input.redMaterialIndices.slice() : (input.materialRed ? [0] : []),
        materialRed: !!input.materialRed || (Array.isArray(input.redMaterialIndices) && input.redMaterialIndices.length > 0),
        // 现场物资不足时游戏会将“满足TA”替换为“获取物品”；默认与红字库存同步，测试可显式构造矛盾状态。
        getItemsInsteadOfSatisfy: input.getItemsInsteadOfSatisfy === undefined ?
            (!!input.materialRed || (Array.isArray(input.redMaterialIndices) && input.redMaterialIndices.length > 0)) :
            !!input.getItemsInsteadOfSatisfy,
        experienceOcrFailure: !!input.ocrFailure || !!input.experienceOcrFailure,
        goldOcrFailure: !!input.ocrFailure || !!input.goldOcrFailure,
        // Rapid OCR 仍可能将描边数字拆成多个片段；夹具可传入原始片段复现严格合并分支。
        experienceOcrResults: input.experienceOcrResults || null,
        goldOcrResults: input.goldOcrResults || null,
        experienceOcrThrows: !!input.experienceOcrThrows,
        goldOcrThrows: !!input.goldOcrThrows,
        ocrRegions: [],
        backHiddenLookups: Math.max(0, Number(input.backHiddenLookups) || 0),
        satisfyRemovesAll: input.satisfyRemovesAll !== false,
        refreshSelectedIndex: input.refreshSelectedIndex === undefined ? null : input.refreshSelectedIndex,
        tradePortAnchorMissing: !!input.tradePortAnchorMissing
    };
    var clicks = [];
    var callbacks = [];
    var logs = [];
    var findFirstCalls = [];
    var gameHelper = {
        findFirst: function(image, threshold, name, silent) {
            findFirstCalls.push({ image: image, threshold: threshold, name: name, silent: silent });
            if (image && image.source === imgs.tradePortEntry) {
                return state.page === "base" && !state.tradePortAnchorMissing ? { x: 18, y: 1590 } : null;
            }
            if (image === imgs.residentDemandPanel) return state.page === "panel" ? { x: 10, y: 1200 } : null;
            if (image === imgs.residentDemandSatisfy) return state.page === "panel" && state.mode === "normal" && !state.getItemsInsteadOfSatisfy ? { x: 400, y: 2160 } : null;
            if (image === imgs.residentDemandRefresh) return state.page === "panel" && state.mode === "normal" ? { x: 900, y: 2160 } : null;
            if (image === imgs.residentDemandImmediateComplete) return state.page === "panel" && state.mode === "negotiating" ? { x: 400, y: 2160 } : null;
            if (image === imgs.residentDemandBack) {
                if (state.backHiddenLookups > 0) {
                    state.backHiddenLookups--;
                    return null;
                }
                return state.page === "panel" ? { x: 10, y: 2160 } : null;
            }
            return null;
        },
        notifyRequiredPositionMissing: function() { state.missingReported = true; return false; }
    };
    var navigate = {
        detectScene: function() { return state.page === "base" ? "base" : "unknown"; }
    };
    var loaded = loadResidentDemand({
        Date: makeDate(now),
        require: function(name) {
            if (name === "./gameHelper.js") return gameHelper;
            if (name === "./navigate.js") return navigate;
            throw new Error("Unexpected require: " + name);
        },
        click: function(x, y) {
            clicks.push({ x: x, y: y });
            if (x === 58 && y === 1742 && state.page === "base") {
                state.page = "panel";
                return;
            }
            if (x === 410 && y === 2170 && state.page === "panel" && state.mode === "normal") {
                state.tabs = state.satisfyRemovesAll ? [] : state.tabs;
                state.selected = state.tabs.length ? state.tabs[0] : null;
                state.mode = state.tabs.length ? "normal" : "terminal";
                return;
            }
            if (x === 910 && y === 2170 && state.page === "panel" && state.mode === "normal") {
                var nextIndex = state.tabs.indexOf(state.selected) + 1;
                // 刷新由游戏自动选中下一位；若当前已是最后一位，保持当前标签并展示协商中。
                // 此钩子刻意模拟异常的跨标签跳转，用于验证模块会安全失败而非继续操作。
                if (state.refreshSelectedIndex !== null) state.selected = state.refreshSelectedIndex;
                else if (nextIndex > 0 && nextIndex < state.tabs.length) state.selected = state.tabs[nextIndex];
                state.mode = "negotiating";
                return;
            }
            if (x === 20 && y === 2170 && state.page === "panel") {
                state.page = "base";
                return;
            }
            if (y === 1410 && state.page === "panel") {
                var tab = getTabIndexByX(x);
                if (tab !== null && state.tabs.indexOf(tab) >= 0) state.selected = tab;
            }
        },
        captureScreen: function() {
            return {
                isScenarioScreen: true,
                getWidth: function() { return 1080; },
                getHeight: function() { return 2400; },
                recycle: function() {}
            };
        },
        images: {
            // 入口仍需裁取贸易港口上半部；奖励 OCR 已改由 Rapid 直接读取整张截图的固定区域。
            clip: function(image) {
                return {
                    source: image,
                    getWidth: function() { return image.getWidth(); },
                    getHeight: function() { return Math.max(1, Math.floor(image.getHeight() * 0.48)); },
                    recycle: function() {}
                };
            },
            pixel: function(screen, x, y) {
                var tab = getTabIndexByX(x);
                if (y >= 1330 && y <= 1510) {
                    return tab !== null && state.tabs.indexOf(tab) >= 0 ? 0xFFE3E6F7 : 0xFF2D3280;
                }
                if (y >= 1300 && y <= 1335) {
                    return tab !== null && tab === state.selected ? 0xFFE3E6F7 : 0xFF2D3280;
                }
                if (y >= 1980 && y <= 2120) {
                    var materialIndex = getMaterialNumberIndexByX(x);
                    return materialIndex !== null && state.materialRedIndices.indexOf(materialIndex) >= 0 ? 0xFFFF2020 : 0xFF101010;
                }
                return 0xFF2D3280;
            }
        },
        ocr: {
            rapid: {
                detect: function(image, region) {
                    if (!image || !image.isScenarioScreen || !region) throw new Error("expected original screen and reward region");
                    state.ocrRegions.push(region.slice());
                    // 模块以独立金币区域读周四奖励；夹具据此验证不会错误沿用经验 OCR。
                    var isGoldRegion = region[0] >= 850;
                    if (isGoldRegion) {
                        if (state.goldOcrThrows) throw new Error("gold ocr failed");
                        if (state.goldOcrResults) return state.goldOcrResults;
                        return state.goldOcrFailure ? [] : [{ label: String(state.gold) }];
                    }
                    if (state.experienceOcrThrows) throw new Error("experience ocr failed");
                    if (state.experienceOcrResults) return state.experienceOcrResults;
                    return state.experienceOcrFailure ? [] : [{ label: String(state.experience) }];
                }
            }
        }
    });
    return {
        loaded: loaded,
        imgs: imgs,
        state: state,
        clicks: clicks,
        callbacks: callbacks,
        logs: logs,
        findFirstCalls: findFirstCalls,
        run: function(options) {
            options = options || {};
            return loaded.api.runOnce(imgs, {
                intervalMinutes: options.intervalMinutes || 10,
                lastCheckedAt: options.lastCheckedAt || 0,
                completedDate: options.completedDate || "",
                experienceThreshold: options.experienceThreshold === undefined ? 500 : options.experienceThreshold,
                thursdayGoldEnabled: options.thursdayGoldEnabled === undefined ? false : options.thursdayGoldEnabled,
                goldThreshold: options.goldThreshold === undefined ? 2000 : options.goldThreshold
            }, options.shouldStop || function() { return false; }, function(message) {
                logs.push(message);
            }, function(value) {
                callbacks.push(value);
            });
        }
    };
}

var dayOne = new Date(2026, 9, 21, 10, 0, 0).getTime();
var dayTwo = new Date(2026, 9, 22, 0, 1, 0).getTime();
var thursday = new Date(2026, 9, 22, 10, 0, 0).getTime();
var saturday = new Date(2026, 9, 24, 10, 0, 0).getTime();

/**
 * 将测试时间戳转换为与设备逻辑相同的本地日期键，避免测试把完成日期重新退回为时间戳。
 * @param {number} timestamp 毫秒级时间戳。
 * @returns {string} 本地日期键。
 */
function dateKey(timestamp) {
    var date = new Date(timestamp);
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return date.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
}

/**
 * 验证同日每日完成和分钟冷却均在加载依赖、截图或点击前直接返回。
 */
function testTodayCompletedAndCooldownSkipAllIo() {
    var requireCalls = 0;
    var captureCalls = 0;
    var clickCalls = 0;
    var loaded = loadResidentDemand({
        Date: makeDate(dayOne),
        require: function() { requireCalls++; throw new Error("直接返回不应加载模块"); },
        captureScreen: function() { captureCalls++; throw new Error("直接返回不应截图"); },
        click: function() { clickCalls++; }
    });
    assert.strictEqual(loaded.api.runOnce({}, { intervalMinutes: 10, lastCheckedAt: 0, completedDate: dateKey(dayOne) }, function() { return false; }, function() {}, function() {}).status, "dailyCompleted");
    assert.strictEqual(loaded.api.runOnce({}, { intervalMinutes: 10, lastCheckedAt: dayOne - 60 * 1000, completedDate: "" }, function() { return false; }, function() {}, function() {}).status, "cooldown");
    assert.strictEqual(requireCalls, 0);
    assert.strictEqual(captureCalls, 0);
    assert.strictEqual(clickCalls, 0);
}

/**
 * 验证完成状态只接受精确的本地日期键；旧时间戳、坏日期或昨天日期都不能短路今天的巡检。
 */
function testCompletedDateRequiresExactCurrentDateKey() {
    var loaded = loadResidentDemand({ Date: makeDate(dayTwo) });
    assert.strictEqual(loaded.api._test.isLocalDateKey(dateKey(dayTwo)), true);
    assert.strictEqual(loaded.api._test.isLocalDateKey("2026-02-30"), false);
    assert.strictEqual(loaded.api._test.isCompletedOnCurrentDate(dateKey(dayOne), dayTwo), false);
    assert.strictEqual(loaded.api._test.isCompletedOnCurrentDate(String(dayTwo), dayTwo), false, "旧时间戳格式不能被当作完成日期");
    assert.strictEqual(loaded.api._test.isCompletedOnCurrentDate(dateKey(dayTwo), dayTwo), true);
}

/**
 * 验证跨零点不会继承昨日的巡检冷却或完成日期，并会立刻进入居民需求流程。
 */
function testCrossMidnightRunsImmediately() {
    var scenario = createScenario({ now: dayTwo, tabs: [], mode: "terminal" });
    var result = scenario.run({ lastCheckedAt: dayOne, completedDate: dateKey(dayOne) });
    assert.strictEqual(result.status, "dailyCompleted");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 58 && item.y === 1742; }), "跨日必须通过贸易港口锚点点击居民入口");
    assert.strictEqual(scenario.callbacks.length, 1);
    assert.strictEqual(scenario.callbacks[0].completedDate, dateKey(dayTwo), "新日终态必须写入新日完成日期");
}

/**
 * 验证入口不依赖当前首位居民的头像，而是通过贸易港口稳定上半部计算居民槽位。
 * 夹具不提供任何居民头像模板，确保后续居民换脸时仍能进入并以面板状态继续校验。
 */
function testTradePortAnchorEntersChangingResidentPortrait() {
    var scenario = createScenario({ now: dayOne, tabs: [], mode: "terminal" });
    var result = scenario.run();
    assert.strictEqual(result.status, "dailyCompleted");
    assert.ok(scenario.findFirstCalls.some(function(call) {
        return call.image && call.image.source === scenario.imgs.tradePortEntry && call.silent === true;
    }), "必须静默识别贸易港口稳定锚点");
    assert.ok(scenario.clicks.some(function(item) {
        return item.x === 58 && item.y === 1742;
    }), "必须点击贸易港口下方已校准的居民槽位");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(scenario.imgs, "residentDemandEntry"), false, "入口不能依赖单一居民头像模板");
}

/**
 * 验证港口锚点缺失时不会退回到旧头像模板或绝对坐标点击。
 * 入口位置无法确认就结束本轮，不能为追求识别率误点地图建筑或居民以外的槽位。
 */
function testMissingTradePortAnchorDoesNotClickOrPersist() {
    var scenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 9999, tradePortAnchorMissing: true });
    assert.strictEqual(scenario.run().status, "failed");
    assert.strictEqual(scenario.clicks.length, 0, "港口锚点缺失时不得点击任何居民入口或面板控件");
    assert.strictEqual(scenario.callbacks.length, 0, "入口未确认时不得写入巡检或每日完成状态");
}

/**
 * 验证跨零点后才确认终态时，仍保存巡检开始日的完成日期，避免新一天被错误短路。
 */
function testTerminalStateCrossingMidnightKeepsRunStartDate() {
    var observedAt = new Date(2026, 9, 21, 23, 59, 59, 500).getTime();
    var returnedAt = new Date(2026, 9, 22, 0, 0, 1).getTime();
    var scenario = createScenario({ now: [observedAt, returnedAt], tabs: [], mode: "terminal" });
    assert.strictEqual(scenario.run().status, "dailyCompleted");
    assert.strictEqual(scenario.callbacks.length, 1);
    assert.strictEqual(scenario.callbacks[0].lastCheckedAt, observedAt);
    assert.strictEqual(scenario.callbacks[0].completedDate, dateKey(observedAt));

    var entryClicksBefore = scenario.clicks.filter(function(item) { return item.x === 58 && item.y === 1742; }).length;
    var nextDayResult = scenario.run({
        lastCheckedAt: scenario.callbacks[0].lastCheckedAt,
        completedDate: scenario.callbacks[0].completedDate
    });
    assert.strictEqual(nextDayResult.status, "dailyCompleted");
    assert.strictEqual(scenario.clicks.filter(function(item) { return item.x === 58 && item.y === 1742; }).length, entryClicksBefore + 1, "跨日后的旧日状态不能直接短路新巡检");
}

/**
 * 验证互斥的三个居民动作按钮均以静默模式探测，正常状态缺失不应反复写错误日志。
 */
function testActionButtonLookupsAreSilent() {
    var scenario = createScenario({ now: dayOne, tabs: [], mode: "terminal" });
    assert.strictEqual(scenario.run().status, "dailyCompleted");
    var actionImages = [
        scenario.imgs.residentDemandSatisfy,
        scenario.imgs.residentDemandRefresh,
        scenario.imgs.residentDemandImmediateComplete
    ];
    var actionLookups = scenario.findFirstCalls.filter(function(call) {
        return actionImages.indexOf(call.image) >= 0;
    });
    assert.ok(actionLookups.length >= 3, "终态确认必须探测三个互斥动作按钮");
    assert.ok(actionLookups.every(function(call) { return call.silent === true; }), "互斥动作按钮必须静默探测");
}

/**
 * 验证 500 经验会刷新而非满足；刷新后自动切换下一位，最后一位协商中时不点击“立即完成”。
 */
function testFiveHundredRefreshesAndLastNegotiatingReturnsSafely() {
    var scenario = createScenario({ now: dayOne, tabs: [0, 1, 2], selected: 0, experience: 500 });
    var result = scenario.run();
    assert.strictEqual(result.status, "checked");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 910 && item.y === 2170; }), "经验 500 必须点击刷新");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 660 && item.y === 1410; }), "协商中必须切到下一位居民");
    assert.strictEqual(scenario.clicks.filter(function(item) { return item.x === 410 && item.y === 2170; }).length, 0, "不能点击立即完成或满足TA");
    assert.strictEqual(scenario.callbacks.length, 1);
    assert.strictEqual(scenario.callbacks[0].completedDate, undefined, "最后一位协商中不能写今日完成日期");
}

/**
 * 验证最后一位点击刷新后不会再切标签，而是原地进入协商倒计时；
 * 该画面只允许安全返回，严禁点击“立即完成”或误写当日完成。
 */
function testRefreshOnLastResidentReturnsSafely() {
    var scenario = createScenario({ now: dayOne, tabs: [0, 1, 2], selected: 2, experience: 500 });
    var result = scenario.run();
    assert.strictEqual(result.status, "checked");
    assert.strictEqual(scenario.clicks.filter(function(item) { return item.x === 910 && item.y === 2170; }).length, 1, "最后一位低经验需求仍需刷新一次");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.y === 1410; }), false, "最后一位刷新后不得猜测点击其他居民标签");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), false, "协商中的立即完成不得被点击");
    assert.strictEqual(scenario.callbacks.length, 1);
    assert.strictEqual(scenario.callbacks[0].completedDate, undefined, "协商倒计时不是当日全部完成");
}

/**
 * 验证刷新后若游戏跳过了紧邻下一位居民，任务会安全失败，不会继续处理错误的居民。
 */
function testRefreshMustAutoSwitchToImmediateNextResident() {
    var scenario = createScenario({
        now: dayOne,
        tabs: [0, 1, 2],
        selected: 0,
        experience: 500,
        refreshSelectedIndex: 2
    });
    assert.strictEqual(scenario.run().status, "failed");
    assert.strictEqual(scenario.callbacks.length, 0, "异常跳过居民不能写安全巡检状态");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.y === 1410; }), false, "异常跳转后不能继续点击居民标签");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), false, "异常跳转后不能提交其他居民需求");
}

/**
 * 验证高于 500 且两项物资均未变红时才满足，并在确认终态和返回基地后写每日完成。
 */
function testFiveHundredOneWithMaterialsSatisfies() {
    var scenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 501, materialRed: false });
    var result = scenario.run();
    assert.strictEqual(result.status, "dailyCompleted");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), "经验 501 且物资足够必须满足TA");
    assert.strictEqual(scenario.callbacks.length, 1);
    assert.strictEqual(scenario.callbacks[0].completedDate, dateKey(dayOne));
}

/**
 * 验证经验阈值由配置控制，而不是继续固定为 500；奖励值必须严格大于阈值才可提交。
 */
function testCustomExperienceThresholdUsesStrictComparison() {
    var equalScenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 700, gold: 9999 });
    assert.strictEqual(equalScenario.run({ experienceThreshold: 700 }).status, "checked");
    assert.ok(equalScenario.clicks.some(function(item) { return item.x === 910 && item.y === 2170; }), "经验等于自定义阈值必须刷新");
    assert.strictEqual(equalScenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), false);

    var aboveScenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 701, gold: 1, materialRed: false });
    assert.strictEqual(aboveScenario.run({ experienceThreshold: 700 }).status, "dailyCompleted");
    assert.ok(aboveScenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), "经验高于自定义阈值必须满足TA");
}

/**
 * 验证描边奖励数字被 Rapid OCR 分成多个相邻片段时，只有同一行、紧邻且无重叠的片段才会合并。
 * 该规则修复现场的数字分片，同时拒绝把两个独立 OCR 数值误拼为一个高价值奖励。
 */
function testSplitRewardDigitsMergeOnlyWhenSpatiallyCertain() {
    var parser = loadResidentDemand().api._test.parseRewardValue;
    assert.strictEqual(parser([
        { label: "14", bounds: { left: 43, top: 20, right: 71, bottom: 46 } },
        { label: "3", bounds: { left: 25, top: 20, right: 39, bottom: 46 } }
    ]), 314, "从左到右的相邻同一行数字片段必须合并");
    assert.strictEqual(parser([
        { label: "3", bounds: { left: 25, top: 20, right: 39, bottom: 46 } },
        { label: "14", bounds: { left: 96, top: 20, right: 124, bottom: 46 } }
    ]), null, "横向间隔过大的独立数字不得合并");
    assert.strictEqual(parser([
        { label: "3", bounds: { left: 25, top: 20, right: 39, bottom: 46 } },
        { label: "14", bounds: { left: 43, top: 80, right: 71, bottom: 106 } }
    ]), null, "不在同一行的独立数字不得合并");
    assert.strictEqual(parser([{ label: "3" }, { label: "14" }]), null, "缺少位置的多个数字片段不得猜测合并");
}

/**
 * 验证实际状态机会使用已严格确认的分片经验值，而不是因片段数量大于一直接安全失败。
 */
function testSplitExperienceDigitsCanSatisfy() {
    var scenario = createScenario({
        now: dayOne,
        tabs: [0],
        selected: 0,
        experienceOcrResults: [
            { label: "5", bounds: { left: 25, top: 20, right: 39, bottom: 46 } },
            { label: "01", bounds: { left: 43, top: 20, right: 71, bottom: 46 } }
        ],
        materialRed: false
    });
    assert.strictEqual(scenario.run().status, "dailyCompleted");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), "分片经验 501 且物资足够必须满足TA");
    assert.strictEqual(scenario.callbacks.length, 1);
}

/**
 * 验证 OCR 空结果或异常仍不点击、不落库，并将原始结果或异常写入任务日志供后续现场取证。
 */
function testRewardOcrFailureLogsDiagnosticsWithoutActing() {
    var emptyScenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 501, experienceOcrFailure: true });
    assert.strictEqual(emptyScenario.run().status, "failed");
    assert.strictEqual(emptyScenario.callbacks.length, 0);
    assert.strictEqual(emptyScenario.clicks.some(function(item) { return item.x === 410 || item.x === 910; }), false, "空 OCR 结果不能点击满足或刷新");
    assert.ok(emptyScenario.logs.some(function(message) { return message.indexOf("Rapid 奖励 OCR 未确认") >= 0 && message.indexOf("原始结果=[]") >= 0; }), "空 OCR 必须记录可诊断的原始结果");

    var exceptionScenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 501, experienceOcrThrows: true });
    assert.strictEqual(exceptionScenario.run().status, "failed");
    assert.strictEqual(exceptionScenario.callbacks.length, 0);
    assert.strictEqual(exceptionScenario.clicks.some(function(item) { return item.x === 410 || item.x === 910; }), false, "OCR 异常不能点击满足或刷新");
    assert.ok(exceptionScenario.logs.some(function(message) { return message.indexOf("Rapid 奖励 OCR 异常：experience ocr failed") >= 0; }), "OCR 异常必须保留异常原因");
}

/**
 * 验证关闭周四金币模式时，即便设备本地为周四仍读取经验区域。
 */
function testThursdayGoldDisabledStillUsesExperience() {
    var scenario = createScenario({ now: thursday, tabs: [0], selected: 0, experience: 501, gold: 1, materialRed: false });
    assert.strictEqual(scenario.run({ thursdayGoldEnabled: false }).status, "dailyCompleted");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), "关闭开关的周四仍应按经验满足");
    assert.strictEqual(scenario.state.ocrRegions[0].join(","), "760,1680,110,112", "关闭开关的周四必须只读取经验奖励区域");
}

/**
 * 验证开启周四金币模式后金币等于 2000 刷新、2001 满足，并只读取金币区域。
 */
function testThursdayGoldModeUsesGoldThreshold() {
    var equalScenario = createScenario({ now: thursday, tabs: [0], selected: 0, experience: 9999, gold: 2000 });
    assert.strictEqual(equalScenario.run({ thursdayGoldEnabled: true, goldThreshold: 2000 }).status, "checked");
    assert.ok(equalScenario.clicks.some(function(item) { return item.x === 910 && item.y === 2170; }), "金币等于阈值必须刷新");
    assert.strictEqual(equalScenario.state.ocrRegions[0].join(","), "860,1696,132,100", "周四金币模式必须只读取金币奖励区域");

    var aboveScenario = createScenario({ now: thursday, tabs: [0], selected: 0, experience: 1, gold: 2001, materialRed: false });
    assert.strictEqual(aboveScenario.run({ thursdayGoldEnabled: true, goldThreshold: 2000 }).status, "dailyCompleted");
    assert.ok(aboveScenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), "金币高于阈值必须满足TA");
    assert.strictEqual(aboveScenario.state.ocrRegions[0].join(","), "860,1696,132,100", "金币提交也必须来自金币奖励区域");
}

/**
 * 验证周四金币模式在周末不生效，仍按经验读取和判断。
 */
function testWeekendKeepsExperienceWhenGoldModeEnabled() {
    var scenario = createScenario({ now: saturday, tabs: [0], selected: 0, experience: 501, gold: 1, materialRed: false });
    assert.strictEqual(scenario.run({ thursdayGoldEnabled: true, goldThreshold: 2000 }).status, "dailyCompleted");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }));
    assert.strictEqual(scenario.state.ocrRegions[0].join(","), "760,1680,110,112", "周末必须继续读取经验奖励区域");
}

/**
 * 验证周四金币 OCR 失败时不提交、不刷新，也不写任何安全状态。
 */
function testGoldOcrFailureDoesNotActOrPersist() {
    var scenario = createScenario({ now: thursday, tabs: [0], selected: 0, experience: 9999, gold: 2001, goldOcrFailure: true });
    assert.strictEqual(scenario.run({ thursdayGoldEnabled: true, goldThreshold: 2000 }).status, "failed");
    assert.strictEqual(scenario.callbacks.length, 0);
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 || item.x === 910; }), false, "金币 OCR 失败不能点击满足或刷新");
}

/**
 * 验证奖励阈值不是正整数时会在进入页面前安全退出，不能用默认值擅自继续执行。
 */
function testInvalidRewardThresholdDoesNotActOrPersist() {
    var scenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 9999, gold: 9999 });
    assert.strictEqual(scenario.run({ experienceThreshold: 0 }).status, "failed");
    assert.strictEqual(scenario.callbacks.length, 0);
    assert.strictEqual(scenario.clicks.length, 0, "阈值无效时不得进入居民需求页或点击任意操作");
    assert.strictEqual(scenario.state.ocrRegions.length, 0, "阈值无效时不得读取奖励 OCR");

    var goldScenario = createScenario({ now: thursday, tabs: [0], selected: 0, experience: 9999, gold: 9999 });
    assert.strictEqual(goldScenario.run({ thursdayGoldEnabled: true, goldThreshold: 0 }).status, "failed");
    assert.strictEqual(goldScenario.callbacks.length, 0);
    assert.strictEqual(goldScenario.clicks.length, 0, "周四金币阈值无效时也不得触屏");
}

/**
 * 验证高经验但任一物资数量变红、主按钮替换为“获取物品”时只切换下一位，不提交也不刷新。
 */
function testRedMaterialSkipsResident() {
    var scenario = createScenario({ now: dayOne, tabs: [0, 1], selected: 0, experience: 501, materialRed: true });
    var result = scenario.run();
    assert.strictEqual(result.status, "checked");
    assert.strictEqual(scenario.state.getItemsInsteadOfSatisfy, true, "红字库存场景必须模拟游戏将满足按钮替换为获取物品");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 420 && item.y === 1410; }), "物资不足必须切换下一位");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), false, "物资不足不能满足TA");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 910 && item.y === 2170; }), false, "高经验物资不足不能刷新");
}

/**
 * 验证仅最右侧第三个物资数量变红时也会被检测并跳过，防止旧的双区域坐标漏掉实际缺料。
 */
function testThirdMaterialRedSkipsResident() {
    var scenario = createScenario({
        now: dayOne,
        tabs: [0, 1],
        selected: 0,
        experience: 501,
        redMaterialIndices: [2]
    });
    assert.strictEqual(scenario.run().status, "checked");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 420 && item.y === 1410; }), "第三栏物资不足也必须切换下一位");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 || item.x === 910; }), false, "第三栏缺料不得提交或刷新");
}

/**
 * 验证低价值需求即使因缺料显示“获取物品”，仍按既定规则优先刷新，不会把按钮替换误判成页面错误。
 */
function testLowValueGetItemsStateStillRefreshes() {
    var scenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 500, materialRed: true });
    assert.strictEqual(scenario.run().status, "checked");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 910 && item.y === 2170; }), "低价值缺料需求仍必须刷新");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), false, "获取物品状态不得点击满足TA");
}

/**
 * 验证“获取物品”却没有红色物资数量时安全停止，避免把未知按钮变体当成可跳过的正常状态。
 */
function testGetItemsWithoutRedMaterialStopsSafely() {
    var scenario = createScenario({
        now: dayOne,
        tabs: [0],
        selected: 0,
        experience: 501,
        materialRed: false,
        getItemsInsteadOfSatisfy: true
    });
    assert.strictEqual(scenario.run().status, "failed");
    assert.strictEqual(scenario.callbacks.length, 0, "矛盾的按钮和物资状态不得写巡检结果");
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 || item.x === 910; }), false, "未知获取物品状态不得提交或刷新");
}

/**
 * 验证必要位置告警的 Toast 短暂遮挡返回模板时，任务会有界等待并只点击一次已重新确认的返回按钮。
 */
function testReturnWaitsForToastOccludedBack() {
    var scenario = createScenario({
        now: dayOne,
        tabs: [0],
        selected: 0,
        experience: 501,
        materialRed: false,
        backHiddenLookups: 2
    });
    assert.strictEqual(scenario.run().status, "dailyCompleted");
    assert.strictEqual(scenario.clicks.filter(function(item) { return item.x === 20 && item.y === 2170; }).length, 1, "返回按钮恢复后只能点击一次");
    assert.strictEqual(scenario.callbacks.length, 1, "安全返回基地后才允许写入完成状态");
}

/**
 * 验证协商中只会切换标签；已经是最后一位时直接安全返回而非循环到第一位。
 */
function testNegotiatingNeverClicksImmediateComplete() {
    var scenario = createScenario({ now: dayOne, tabs: [0, 1, 2], selected: 0, mode: "negotiating", experience: 999 });
    var result = scenario.run();
    assert.strictEqual(result.status, "checked");
    assert.ok(scenario.clicks.some(function(item) { return item.x === 420 && item.y === 1410; }));
    assert.ok(scenario.clicks.some(function(item) { return item.x === 660 && item.y === 1410; }));
    assert.strictEqual(scenario.clicks.some(function(item) { return item.x === 410 && item.y === 2170; }), false, "立即完成坐标不得被点击");
}

/**
 * 验证标签扫描不把空槽当居民，支持当天动态剩余 4、3、2、1 位。
 */
function testDynamicResidentTabCounts() {
    [4, 3, 2, 1].forEach(function(count) {
        var tabs = [];
        for (var i = 0; i < count; i++) tabs.push(i);
        var scenario = createScenario({ now: dayOne, tabs: tabs, selected: 0, mode: "negotiating" });
        var scan = scenario.loaded.api._test.scanResidentTabs();
        assert.strictEqual(scan.valid, true);
        assert.strictEqual(scan.tabs.length, count);
        assert.strictEqual(scan.selectedIndex, 0);
    });
}

/**
 * 验证 OCR、模板缺失与停止都不会写巡检或每日完成状态。
 */
function testFailuresAndStopDoNotPersistCompletion() {
    var ocrScenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 501, ocrFailure: true });
    assert.strictEqual(ocrScenario.run().status, "failed");
    assert.strictEqual(ocrScenario.callbacks.length, 0);

    var missingScenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 501 });
    delete missingScenario.imgs.residentDemandRefresh;
    assert.strictEqual(missingScenario.run().status, "failed");
    assert.strictEqual(missingScenario.callbacks.length, 0);

    var stopScenario = createScenario({ now: dayOne, tabs: [0], selected: 0, experience: 501 });
    assert.strictEqual(stopScenario.run({ shouldStop: function() { return true; } }).status, "interrupted");
    assert.strictEqual(stopScenario.callbacks.length, 0);
}

testTodayCompletedAndCooldownSkipAllIo();
testCompletedDateRequiresExactCurrentDateKey();
testCrossMidnightRunsImmediately();
testTradePortAnchorEntersChangingResidentPortrait();
testMissingTradePortAnchorDoesNotClickOrPersist();
testTerminalStateCrossingMidnightKeepsRunStartDate();
testActionButtonLookupsAreSilent();
testFiveHundredRefreshesAndLastNegotiatingReturnsSafely();
testRefreshOnLastResidentReturnsSafely();
testRefreshMustAutoSwitchToImmediateNextResident();
testFiveHundredOneWithMaterialsSatisfies();
testCustomExperienceThresholdUsesStrictComparison();
testSplitRewardDigitsMergeOnlyWhenSpatiallyCertain();
testSplitExperienceDigitsCanSatisfy();
testRewardOcrFailureLogsDiagnosticsWithoutActing();
testThursdayGoldDisabledStillUsesExperience();
testThursdayGoldModeUsesGoldThreshold();
testWeekendKeepsExperienceWhenGoldModeEnabled();
testGoldOcrFailureDoesNotActOrPersist();
testInvalidRewardThresholdDoesNotActOrPersist();
testRedMaterialSkipsResident();
testThirdMaterialRedSkipsResident();
testLowValueGetItemsStateStillRefreshes();
testGetItemsWithoutRedMaterialStopsSafely();
testReturnWaitsForToastOccludedBack();
testNegotiatingNeverClicksImmediateComplete();
testDynamicResidentTabCounts();
testFailuresAndStopDoNotPersistCompletion();
console.log("resident demand test passed");
