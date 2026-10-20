// find-first-screen-recycle.test.js — 验证公共单图识别不会长期持有截图 Bitmap

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var sourcePath = path.join(__dirname, "..", "..", "modules", "gameHelper.js");

/**
 * 从包含 AutoJs UI JSX 的公共模块中提取一个纯 JavaScript 识图方法，用 Node 验证其截图资源生命周期。
 * @param {string} methodName gameHelper 中待提取的公开方法名。
 * @param {Object} overrides AutoJs 截图与识图 API 的测试替身。
 * @returns {Object} 带有可调用目标方法的公共工具对象。
 */
function loadScreenMatchingMethod(methodName, overrides) {
    var source = fs.readFileSync(sourcePath, "utf8");
    var functionStart = source.indexOf("gameHelper." + methodName + " = function");
    // 源文件保留 Windows CRLF；用可选回车的边界定位下一段 JSDoc，避免测试依赖工作树的换行风格。
    var boundaryMatch = /\r?\n\r?\n\/\*\*/.exec(source.slice(functionStart));
    var functionEnd = boundaryMatch ? functionStart + boundaryMatch.index : -1;
    if (functionStart < 0 || functionEnd < 0) throw new Error("无法从 gameHelper.js 提取 " + methodName);

    var context = {
        module: { exports: {} },
        captureScreen: overrides.captureScreen,
        images: overrides.images,
        log: function() {},
        console: { log: function() {}, error: function() {} }
    };
    vm.runInNewContext("var gameHelper = {};\n" + source.slice(functionStart, functionEnd) + "\nmodule.exports = gameHelper;", context, {
        filename: sourcePath
    });
    return context.module.exports;
}

/**
 * 验证找到模板后返回坐标，同时立即释放本次截图。
 */
function testFindFirstRecyclesScreenAfterSuccess() {
    var recycleCalls = 0;
    var helper = loadScreenMatchingMethod("findFirst", {
        captureScreen: function() {
            return { recycle: function() { recycleCalls++; } };
        },
        images: { findImage: function() { return { x: 12, y: 34 }; } }
    });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(helper.findFirst({}, 0.8, "测试模板"))), { x: 12, y: 34 });
    assert.strictEqual(recycleCalls, 1);
}

/**
 * 验证底层识图抛错时也会释放截图，避免一次异常留下 Bitmap 并累积到下一轮调度。
 */
function testFindFirstRecyclesScreenAfterImageError() {
    var recycleCalls = 0;
    var helper = loadScreenMatchingMethod("findFirst", {
        captureScreen: function() {
            return { recycle: function() { recycleCalls++; } };
        },
        images: { findImage: function() { throw new Error("图像资源已被回收"); } }
    });

    assert.throws(function() { helper.findFirst({}, 0.8, "测试模板"); }, /图像资源已被回收/);
    assert.strictEqual(recycleCalls, 1);
}

testFindFirstRecyclesScreenAfterSuccess();
testFindFirstRecyclesScreenAfterImageError();

/**
 * 验证区域识图在成功和底层异常时都会释放截图。
 */
function testFindFirstInRegionAlwaysRecyclesScreen() {
    var recycleCalls = 0;
    var helper = loadScreenMatchingMethod("findFirstInRegion", {
        captureScreen: function() {
            return { recycle: function() { recycleCalls++; } };
        },
        images: { findImage: function() { return { x: 56, y: 78 }; } }
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(helper.findFirstInRegion({}, 0, 0, 100, 100, 0.8, "区域模板"))), { x: 56, y: 78 });
    assert.strictEqual(recycleCalls, 1);

    recycleCalls = 0;
    helper = loadScreenMatchingMethod("findFirstInRegion", {
        captureScreen: function() {
            return { recycle: function() { recycleCalls++; } };
        },
        images: { findImage: function() { throw new Error("区域识图异常"); } }
    });
    assert.throws(function() { helper.findFirstInRegion({}, 0, 0, 100, 100, 0.8, "区域模板"); }, /区域识图异常/);
    assert.strictEqual(recycleCalls, 1);
}

/**
 * 验证多目标匹配复制坐标后立即释放截图，且异常路径同样不遗留 Bitmap。
 */
function testFindAllAlwaysRecyclesScreen() {
    var recycleCalls = 0;
    var helper = loadScreenMatchingMethod("findAll", {
        captureScreen: function() {
            return { recycle: function() { recycleCalls++; } };
        },
        images: { matchTemplate: function() { return { matches: [{ point: { x: 90, y: 12 }, similarity: 0.95 }] }; } }
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(helper.findAll({}, 0.8, "多目标模板"))), [{ x: 90, y: 12 }]);
    assert.strictEqual(recycleCalls, 1);

    recycleCalls = 0;
    helper = loadScreenMatchingMethod("findAll", {
        captureScreen: function() {
            return { recycle: function() { recycleCalls++; } };
        },
        images: { matchTemplate: function() { throw new Error("多目标识图异常"); } }
    });
    assert.throws(function() { helper.findAll({}, 0.8, "多目标模板"); }, /多目标识图异常/);
    assert.strictEqual(recycleCalls, 1);
}

testFindFirstInRegionAlwaysRecyclesScreen();
testFindAllAlwaysRecyclesScreen();
console.log("findFirst screen recycle tests passed");
