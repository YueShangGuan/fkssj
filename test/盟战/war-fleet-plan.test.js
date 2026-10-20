// war-fleet-plan.test.js — 覆盖城战逐舰队计划、目标回退、独占选择与单段加速边界。

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var warPath = path.resolve(__dirname, "../../modules/war.js");
var gameHelperPath = path.resolve(__dirname, "../../modules/gameHelper.js");
var source = fs.readFileSync(warPath, "utf8") + [
    "module.exports._test = {",
    "normalizeCityTarget: normalizeCityTarget,",
    "readPlan: readPlan,",
    "chooseCity: chooseCity,",
    "selectOnlyFleet: selectOnlyFleet,",
    "closeFleetDialog: closeFleetDialog,",
    "processFleet: processFleet,",
    "readSpeedDialog: readSpeedDialog,",
    "useSpeedUpOnce: useSpeedUpOnce,",
    "resetAcceleratedSegments: resetAcceleratedSegments,",
    "segments: acceleratedSegments,",
    "parseSeconds: parseSeconds",
    "};"
].join("\n");

/**
 * 构造仅带尺寸和身份的 AutoJs 图片替身。
 * @param {string} name 模板名称。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} 图片替身。
 */
function image(name) {
    return {
        name: name,
        getWidth: function() { return 10; },
        getHeight: function() { return 10; }
    };
}

/**
 * 在隔离 VM 内加载城战模块，以最小桩模拟识图、OCR 与触控。
 * @param {Object} overrides 覆盖的 AutoJs 依赖。
 * @returns {{api: Object, context: Object}} 城战模块及其沙箱。
 */
function loadWar(overrides) {
    overrides = overrides || {};
    var helper = overrides.helper || {
        findAll: function() { return []; },
        findFirst: function() { return null; },
        findFirstInRegion: function() { return null; },
        notifyRequiredPositionMissing: function() { return false; }
    };
    var context = {
        module: { exports: {} },
        exports: {},
        require: overrides.require || function(request) {
            if (request === "./gameHelper.js") return helper;
            throw new Error("Unexpected require: " + request);
        },
        click: overrides.click || function() {},
        sleep: overrides.sleep || function() {},
        random: function(min) { return min; },
        log: function() {},
        context: { getResources: function() { return { getDisplayMetrics: function() { return { widthPixels: 1080, heightPixels: 2400 }; } }; } },
        captureScreen: overrides.captureScreen || function() { return { recycle: function() {} }; },
        ocr: overrides.ocr || { mlkit: { detect: function() { return []; } } },
        console: console
    };
    vm.runInNewContext(source, context, { filename: warPath });
    return { api: context.module.exports, context: context };
}

/**
 * 提供普通攻防城镇与集结入口的测试模板，并允许单例测试按需覆写各列表的匹配点。
 * @param {Function} detect OCR 识别桩。
 * @param {{attackPoints?: Array<Object>, defendPoints?: Array<Object>, rallyPoint?: Object}} options 可选的城镇和集结入口匹配点。
 * @returns {{loaded: Object, imgs: Object}} 城战测试环境。
 */
function createCityHarness(detect, options) {
    options = options || {};
    var fortAttack = image("fortAttack");
    var fortDefend = image("fortDefend");
    var fortRally = image("fortRally");
    var cityLookups = 0;
    var helper = {
        findAll: function(target) {
            cityLookups++;
            if (target === fortAttack) return options.attackPoints || [{ x: 20, y: 100 }, { x: 20, y: 300 }];
            if (target === fortDefend) return options.defendPoints || [];
            return [];
        },
        findFirst: function(target) { return target === fortRally ? (options.rallyPoint || null) : null; },
        findFirstInRegion: function() { return null; },
        notifyRequiredPositionMissing: function() { return false; }
    };
    var loaded = loadWar({
        helper: helper,
        ocr: { mlkit: { detect: detect } }
    });
    return {
        loaded: loaded,
        imgs: { fortAttack: fortAttack, fortDefend: fortDefend, fortRally: fortRally },
        getCityLookups: function() { return cityLookups; }
    };
}

/**
 * 验证目标格式、独立模式和非法非空坐标均由新结构处理，不读取旧全局模式。
 */
function testPlanValidation() {
    var loaded = loadWar();
    assert.strictEqual(loaded.api._test.normalizeCityTarget(" f6 "), "F6");
    assert.strictEqual(loaded.api._test.normalizeCityTarget("F-6"), "");
    assert.strictEqual(loaded.api._test.readPlan([{ mode: "defend", target: "e8", repairAccelerate: true, marchAccelerate: false }], 0).target, "E8");
    assert.strictEqual(loaded.api._test.readPlan([{ mode: "rally", target: "", repairAccelerate: false, marchAccelerate: false }], 0).mode, "rally");
    assert.strictEqual(loaded.api._test.readPlan([{ mode: "invalid", target: "", repairAccelerate: false, marchAccelerate: false }], 0), null);
    assert.strictEqual(loaded.api._test.readPlan([{ mode: "attack", target: "bad", repairAccelerate: false, marchAccelerate: false }], 0), null);
}

/**
 * 验证集结模板与逐舰队集结模式同时被加载，避免页面虽可选择却在运行时缺少入口模板。
 */
function testRallyTemplateIsLoaded() {
    var helperSource = fs.readFileSync(gameHelperPath, "utf8");
    assert.ok(helperSource.indexOf('fortRally: images.read("./img/盟战/集结.png")') >= 0, "城战必须加载集结入口模板");
}

/**
 * 验证空目标不触发 OCR，并稳定选择列表首个同类城镇。
 */
function testEmptyTargetUsesFirstCity() {
    var calls = 0;
    var harness = createCityHarness(function() { calls++; return []; });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "attack", target: "" }, function() {});
    assert.strictEqual(result.status, "selected");
    assert.strictEqual(result.point.y, 100);
    assert.strictEqual(calls, 0, "空目标无需 OCR，直接沿用首个城镇逻辑");
}

/**
 * 验证已设置目标时扫描所有同类城镇，并只选择 OCR 确认的目标城镇。
 */
function testConfiguredTargetSelectsExactCity() {
    var harness = createCityHarness(function(screen, region) {
        return [{ label: region[1] < 100 ? "进攻要塞E7" : "进攻要塞F6", bounds: { top: 0, left: 0 } }];
    });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "attack", target: "F6" }, function() {});
    assert.strictEqual(result.status, "selected");
    assert.strictEqual(result.point.y, 300);
}

/**
 * 验证目标确实不在已完整 OCR 扫描的列表时才回退首个同类城镇。
 */
function testMissingConfiguredTargetFallsBackAfterScan() {
    var logs = [];
    var harness = createCityHarness(function(screen, region) {
        return [{ label: region[1] < 100 ? "进攻要塞E7" : "进攻要塞F6", bounds: { top: 0, left: 0 } }];
    });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "attack", target: "G9" }, function(message) { logs.push(message); });
    assert.strictEqual(result.status, "selected");
    assert.strictEqual(result.point.y, 100);
    assert.ok(logs.some(function(message) { return message.indexOf("回退到首个可用城镇") >= 0; }));
}

/**
 * 验证 OCR 不能确认某个列表坐标时直接安全失败，绝不把“不确定”当作“目标不存在”。
 */
function testUnreadableTargetDoesNotFallback() {
    var harness = createCityHarness(function() { return []; });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "attack", target: "F6" }, function() {});
    assert.strictEqual(result.status, "failed");
}

/**
 * 验证集结入口存在时直接沿用原集结派遣链路，不扫描普通攻防城镇。
 */
function testRallyUsesRallyEntryBeforeCityLists() {
    var harness = createCityHarness(function() { return []; }, { rallyPoint: { x: 40, y: 80 } });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "rally", target: "F6" }, function() {});
    assert.strictEqual(result.status, "selected");
    assert.strictEqual(result.descriptor.label, "集结");
    assert.strictEqual(harness.getCityLookups(), 0, "找到集结入口后不得查询普通城镇列表");
}

/**
 * 验证集结入口缺失且未设坐标时，按固定顺序选择首个进攻城镇。
 */
function testRallyWithoutTargetFallsBackToAttack() {
    var harness = createCityHarness(function() { throw new Error("空目标不应 OCR"); });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "rally", target: "" }, function() {});
    assert.strictEqual(result.status, "selected");
    assert.strictEqual(result.descriptor.label, "进攻");
    assert.strictEqual(result.point.y, 100);
}

/**
 * 验证集结入口缺失时会先完整扫描进攻列表，再选择 OCR 确认的防守目标。
 */
function testRallyTargetCanSelectDefenseAfterAttackScan() {
    var harness = createCityHarness(function(screen, region) {
        return [{ label: region[1] < 400 ? "进攻要塞E7" : "防守要塞F6", bounds: { top: 0, left: 0 } }];
    }, {
        attackPoints: [{ x: 20, y: 100 }],
        defendPoints: [{ x: 20, y: 500 }]
    });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "rally", target: "F6" }, function() {});
    assert.strictEqual(result.status, "selected");
    assert.strictEqual(result.descriptor.label, "防守");
    assert.strictEqual(result.point.y, 500);
}

/**
 * 验证集结入口缺失且两个列表均确认没有目标后，按优先级回退首个进攻城镇。
 */
function testRallyMissingTargetFallsBackAfterBothLists() {
    var harness = createCityHarness(function() {
        return [{ label: "城镇E7", bounds: { top: 0, left: 0 } }];
    }, {
        attackPoints: [{ x: 20, y: 100 }],
        defendPoints: [{ x: 20, y: 500 }]
    });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "rally", target: "F6" }, function() {});
    assert.strictEqual(result.status, "selected");
    assert.strictEqual(result.descriptor.label, "进攻");
    assert.strictEqual(result.point.y, 100);
}

/**
 * 验证集结入口缺失时，任何一个攻防列表坐标无法 OCR 确认都必须安全失败。
 */
function testRallyUnreadableTargetDoesNotFallback() {
    var harness = createCityHarness(function() { return []; }, {
        attackPoints: [{ x: 20, y: 100 }],
        defendPoints: [{ x: 20, y: 500 }]
    });
    var result = harness.loaded.api._test.chooseCity(harness.imgs, { mode: "rally", target: "F6" }, function() {});
    assert.strictEqual(result.status, "failed");
}

/**
 * 验证选择目标舰队前会取消其他默认勾选，最终仅保留当前舰队。
 */
function testSelectOnlyFleet() {
    var checkedImage = image("checked");
    var uncheckedImage = image("unchecked");
    var states = [true, true, false];
    var clicks = [];
    var helper = {
        findAll: function(target) {
            var points = [];
            for (var i = 0; i < states.length; i++) {
                if ((target === checkedImage && states[i]) || (target === uncheckedImage && !states[i])) points.push({ x: 10, y: 100 + i * 100 });
            }
            return points;
        },
        findFirst: function() { return null; },
        findFirstInRegion: function() { return null; },
        notifyRequiredPositionMissing: function() { return false; }
    };
    var loaded = loadWar({
        helper: helper,
        click: function(x, y) {
            var index = Math.round((y - 105) / 100);
            states[index] = !states[index];
            clicks.push(index);
        }
    });
    var rows = [
        { x: 10, y: 100, checked: true, image: checkedImage },
        { x: 10, y: 200, checked: true, image: checkedImage },
        { x: 10, y: 300, checked: false, image: uncheckedImage }
    ];
    assert.strictEqual(loaded.api._test.selectOnlyFleet({ fleetChecked: checkedImage, fleetUnchecked: uncheckedImage }, rows, 2, function() {}), true);
    assert.deepStrictEqual(states, [false, false, true]);
    assert.deepStrictEqual(clicks, [0, 1, 2]);
}

/**
 * 验证每次舰队处理后仅在标题仍存在时点击关闭，并重新识别标题确认已回到地图。
 */
function testCloseFleetDialog() {
    var title = image("dialogTitle");
    var close = image("dialogClose");
    var open = true;
    var clicks = 0;
    var helper = {
        findAll: function() { return []; },
        findFirst: function(target) {
            if (target === title && open) return { x: 20, y: 20 };
            if (target === close && open) return { x: 50, y: 20 };
            return null;
        },
        findFirstInRegion: function() { return null; },
        notifyRequiredPositionMissing: function() { return false; }
    };
    var loaded = loadWar({
        helper: helper,
        click: function() { clicks++; open = false; }
    });
    assert.strictEqual(loaded.api._test.closeFleetDialog({ warFleetDialogTitle: title, warFleetDialogClose: close }, function() {}), true);
    assert.strictEqual(clicks, 1);
    assert.strictEqual(loaded.api._test.closeFleetDialog({ warFleetDialogTitle: title, warFleetDialogClose: close }, function() {}), true);
    assert.strictEqual(clicks, 1, "已关闭的弹窗不得再次点击");
}

/**
 * 验证已在地图底部确认维修或行军、且对应加速关闭的舰队直接跳过，不打开城镇或舰队选择页。
 */
function testBusyFleetStatusSkipsWithoutOpeningCity() {
    var repair = image("repairing");
    var march = image("marching");
    var cityLookups = 0;
    var activeStatus = repair;
    var helper = {
        findAll: function() { cityLookups++; return []; },
        findFirst: function() { return null; },
        findFirstInRegion: function(target) {
            if (target === activeStatus) return { x: 20, y: 2060 };
            return null;
        },
        notifyRequiredPositionMissing: function() { return false; }
    };
    var loaded = loadWar({ helper: helper });
    var imgs = { warFleetRepairing: repair, warFleetMarching: march };
    assert.strictEqual(loaded.api._test.processFleet(imgs, { mode: "attack", target: "", repairAccelerate: false, marchAccelerate: false }, 0, function() {}).status, "skip");
    activeStatus = march;
    assert.strictEqual(loaded.api._test.processFleet(imgs, { mode: "defend", target: "", repairAccelerate: false, marchAccelerate: false }, 1, function() {}).status, "skip");
    assert.strictEqual(cityLookups, 0, "已确认忙碌且未启用加速时不得点击城镇");
}

/**
 * 验证维修加速没有标题模板时，仍必须由 OCR 同时确认“维修加速”和倒计时，不能只凭速度x2按钮扣钻石。
 */
function testRepairSpeedDialogRequiresOcrTitle() {
    var speed = image("speed");
    var title = "其他弹窗";
    var helper = {
        findAll: function() { return []; },
        findFirst: function(target) { return target === speed ? { x: 100, y: 100 } : null; },
        findFirstInRegion: function() { return null; },
        notifyRequiredPositionMissing: function() { return false; }
    };
    var loaded = loadWar({
        helper: helper,
        ocr: {
            mlkit: {
                detect: function(screen, region) {
                    if (region[1] === 800) return [{ label: title }];
                    if (region[1] === 1000) return [{ label: "00:00:57" }];
                    return [];
                }
            }
        }
    });
    var imgs = { warSpeedUpX2: speed };
    assert.strictEqual(loaded.api._test.readSpeedDialog(imgs, "repair", function() {}).ok, false);
    title = "维修加速";
    assert.strictEqual(loaded.api._test.readSpeedDialog(imgs, "repair", function() {}).ok, true);
}

/**
 * 验证同一段行军倒计时只点击一次速度x2，重新确认空闲后才允许下一段再次加速。
 */
function testSpeedUpOncePerSegmentAndResetOnIdle() {
    var title = image("marchTitle");
    var speed = image("speed");
    var close = image("speedClose");
    var clicks = 0;
    var speedClicks = 0;
    var closeClicks = 0;
    var dialogOpen = true;
    var remaining = 57;
    var helper = {
        findAll: function() { return []; },
        findFirst: function(target) {
            if (target === title && dialogOpen) return { x: 20, y: 20 };
            if (target === speed && dialogOpen) return { x: 100, y: 100 };
            if (target === close && dialogOpen) return { x: 200, y: 100 };
            return null;
        },
        findFirstInRegion: function() { return null; },
        notifyRequiredPositionMissing: function() { return false; }
    };
    var loaded = loadWar({
        helper: helper,
        click: function(x) {
            clicks++;
            if (x === 105) {
                speedClicks++;
                remaining = 20;
            } else if (x === 205) {
                closeClicks++;
                dialogOpen = false;
            }
        },
        ocr: {
            mlkit: {
                detect: function(screen, region) {
                    if (region[1] === 800) return dialogOpen ? [{ label: "加速行军" }] : [];
                    if (region[1] === 1000) return [{ label: "00:00:" + (remaining < 10 ? "0" : "") + remaining }];
                    return [];
                }
            }
        }
    });
    var imgs = { warMarchSpeedUpTitle: title, warSpeedUpX2: speed, warSpeedDialogClose: close };
    assert.strictEqual(loaded.api._test.useSpeedUpOnce(imgs, "march", 1, function() {}), true);
    assert.strictEqual(loaded.api._test.useSpeedUpOnce(imgs, "march", 1, function() {}), false);
    assert.strictEqual(clicks, 2, "速度x2后只允许额外点击一次关闭弹窗");
    assert.strictEqual(speedClicks, 1, "同一行军段不得重复点击速度x2");
    assert.strictEqual(closeClicks, 1, "确认加速后仅关闭一次共用弹窗");
    loaded.api._test.segments.repair[1] = true;
    loaded.api._test.resetAcceleratedSegments(1);
    assert.strictEqual(loaded.api._test.segments.repair[1], false);
    assert.strictEqual(loaded.api._test.segments.march[1], false);
}

testPlanValidation();
testRallyTemplateIsLoaded();
testEmptyTargetUsesFirstCity();
testConfiguredTargetSelectsExactCity();
testMissingConfiguredTargetFallsBackAfterScan();
testUnreadableTargetDoesNotFallback();
testRallyUsesRallyEntryBeforeCityLists();
testRallyWithoutTargetFallsBackToAttack();
testRallyTargetCanSelectDefenseAfterAttackScan();
testRallyMissingTargetFallsBackAfterBothLists();
testRallyUnreadableTargetDoesNotFallback();
testSelectOnlyFleet();
testCloseFleetDialog();
testBusyFleetStatusSkipsWithoutOpeningCity();
testRepairSpeedDialogRequiresOcrTitle();
testSpeedUpOncePerSegmentAndResetOnIdle();
console.log("war fleet plan test passed");
