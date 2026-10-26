// resource-gather-category-isolation.test.js — 验证资源行分组和跨类别设施候选隔离

var assert = require("assert");
var fs = require("fs");
var Module = require("module");
var path = require("path");

var sourcePath = path.join(__dirname, "..", "..", "modules", "resourceGather.js");
var moduleSource = fs.readFileSync(sourcePath, "utf8")
    + "\nmodule.exports._RESOURCE_ROWS = RESOURCE_ROWS;"
    + "\nmodule.exports._GROUPS = GROUPS;"
    + "\nmodule.exports._selectGroups = selectGroups;"
    + "\nmodule.exports._findGatherFacility = findGatherFacility;";
var testModule = new Module(sourcePath, module);
testModule.filename = sourcePath;
testModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));

/**
 * 返回可回收的空白截图替身，使设施识图测试不依赖连接中的 AutoJs6 设备。
 * @returns {{recycle: Function}} 可被被测模块安全回收的截图替身。
 */
function captureFakeScreen() {
    return { recycle: function() {} };
}

/**
 * 默认不返回模板候选，测试会按场景替换为带有明确类别关系的匹配函数。
 * @returns {{matches: Array}} 空模板匹配结果。
 */
function matchNothing() {
    return { matches: [] };
}

/**
 * 测试中不等待真实时间，防止有限轮询把单元测试变成耗时的设备模拟。
 */
function skipSleep() {}

global.captureScreen = captureFakeScreen;
global.images = { matchTemplate: matchNothing };
global.sleep = skipSleep;

testModule._compile(moduleSource, sourcePath);

/**
 * 构造具有固定尺寸的模板替身，便于验证同帧候选的实际覆盖范围。
 * @param {string} name 模板名称。
 * @returns {Object} 可用于 images.matchTemplate 替身的图片对象。
 */
function makeImage(name) {
    return {
        name: name,
        getWidth: function() { return 100; },
        getHeight: function() { return 100; }
    };
}

/**
 * 验证第 1、2–4、5–7 行分别固定归属钓鱼、拾荒、深潜，且同类低库存只取该类别的首项“获取”。
 */
function testResourceRowCategories() {
    assert.deepStrictEqual(
        testModule.exports._RESOURCE_ROWS.map(function(row) { return row.group; }),
        ["fishing", "scavenging", "scavenging", "scavenging", "salvage", "salvage", "salvage"]
    );

    var stocks = testModule.exports._RESOURCE_ROWS.map(function(row) {
        return { name: row.name, group: row.group, getButton: row.getButton, percent: 100 };
    });
    stocks[0].percent = 20;
    stocks[2].percent = 30;
    stocks[5].percent = 40;
    assert.deepStrictEqual(
        testModule.exports._selectGroups(stocks, 90).map(function(selection) {
            return [selection.group.key, selection.group.label, selection.stock.name, selection.stock.getButton];
        }),
        [
            ["fishing", "钓鱼", "鱼", [902, 671]],
            ["scavenging", "拾荒", "木材", [902, 1011]],
            ["salvage", "深潜", "玻璃", [902, 1520]]
        ]
    );
}

/**
 * 验证深潜候选与拾荒模板覆盖同一浮台时会被拒绝，避免点击第 5–7 行资源后误触第 2–4 行设施。
 */
function testDiveCandidateRejectsScavengingOverlap() {
    var diveImage = makeImage("下潜设施");
    var scavengingImage = makeImage("拾荒设施");
    global.images.matchTemplate = makeOverlappingMatcher(diveImage, scavengingImage);
    var divingGroup = testModule.exports._GROUPS.filter(function(group) { return group.key === "salvage"; })[0];
    var result = testModule.exports._findGatherFacility({
        gatherSalvageFacility: diveImage,
        gatherScavengingFacilityStateOne: scavengingImage
    }, divingGroup);
    assert.deepStrictEqual(result, {
        rejected: true,
        label: "下潜设施",
        conflictingGroupLabel: "拾荒",
        conflictingFacilityLabel: "拾荒设施-休息"
    });
}

/**
 * 验证不同地点的拾荒模板不影响深潜设施匹配，避免把跨类别守卫变成所有深潜都无法执行的阻断。
 */
function testDiveCandidateAllowsSeparateScavengingFacility() {
    var diveImage = makeImage("下潜设施");
    var scavengingImage = makeImage("拾荒设施");
    global.images.matchTemplate = makeSeparateMatcher(diveImage, scavengingImage);
    var divingGroup = testModule.exports._GROUPS.filter(function(group) { return group.key === "salvage"; })[0];
    assert.deepStrictEqual(
        testModule.exports._findGatherFacility({
            gatherSalvageFacility: diveImage,
            gatherScavengingFacilityStateOne: scavengingImage
        }, divingGroup),
        { point: { x: 100, y: 100 }, image: diveImage, label: "下潜设施", similarity: 0.99 }
    );
}

/**
 * 构造让下潜和拾荒同时命中同一坐标的识图替身，用于覆盖必须安全拒绝的场景。
 * @param {Object} diveImage 下潜设施模板替身。
 * @param {Object} scavengingImage 拾荒设施模板替身。
 * @returns {Function} 图片匹配替身。
 */
function makeOverlappingMatcher(diveImage, scavengingImage) {
    return function matchOverlappingFacilities(screen, image) {
        if (image === diveImage || image === scavengingImage) {
            return { matches: [{ point: { x: 100, y: 100 }, similarity: 0.99 }] };
        }
        return { matches: [] };
    };
}

/**
 * 构造让下潜与拾荒命中不同坐标的识图替身，验证隔离守卫不会误伤独立设施。
 * @param {Object} diveImage 下潜设施模板替身。
 * @param {Object} scavengingImage 拾荒设施模板替身。
 * @returns {Function} 图片匹配替身。
 */
function makeSeparateMatcher(diveImage, scavengingImage) {
    return function matchSeparateFacilities(screen, image) {
        if (image === diveImage) return { matches: [{ point: { x: 100, y: 100 }, similarity: 0.99 }] };
        if (image === scavengingImage) return { matches: [{ point: { x: 400, y: 100 }, similarity: 0.99 }] };
        return { matches: [] };
    };
}

testResourceRowCategories();
testDiveCandidateRejectsScavengingOverlap();
testDiveCandidateAllowsSeparateScavengingFacility();
console.log("resource gather category isolation tests passed");
