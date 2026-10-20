// weapon-return-main.test.js — 验证锻造任务结束后返回基地，且能恢复上轮遗留的锻造页

var assert = require("assert");
var Module = require("module");
var originalLoad = Module._load;
var clicks = [];
var logs = [];
var scene = "base";
var startAvailable = true;
var doneVisible = false;

/**
 * 构造具有 AutoJs6 图片尺寸接口的模板桩，供锻造模块计算点击中心。
 * @param {string} name 模板的业务名称。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} 图片模板桩。
 */
function createTemplate(name) {
    return {
        name: name,
        getWidth: function() { return 20; },
        getHeight: function() { return 20; }
    };
}

var imgs = {
    baseIcon: createTemplate("基地图标"),
    worldIcon: createTemplate("世界图标"),
    forgeHouse: createTemplate("锻造屋"),
    forgeBack: createTemplate("锻造屋返回"),
    duanzao: createTemplate("开始锻造"),
    duanzaoDone: createTemplate("锻造完成")
};

/**
 * 按模拟页面返回模板位置；锻造页不暴露世界/基地导航图标，从而复现真实 detectScene 的 unknown 状态。
 * @param {Object} image 正在查找的图片模板。
 * @returns {{x: number, y: number}|null} 模板左上角，或当前页面不存在该模板时的 null。
 */
function findTemplate(image) {
    if (image === imgs.forgeHouse && scene === "base") return { x: 100, y: 100 };
    if (image === imgs.duanzao && scene === "forge" && startAvailable) return { x: 200, y: 200 };
    if (image === imgs.duanzaoDone && scene === "forge" && doneVisible) return { x: 500, y: 500 };
    if (image === imgs.forgeBack && scene === "forge") return { x: 300, y: 300 };
    if (image === imgs.worldIcon && scene === "base") return { x: 400, y: 400 };
    return null;
}

// 仅替换锻造模块的两项 AutoJs6 依赖，测试不触发真实截图或触控。
Module._load = function(request, parent, isMain) {
    if (request === "./gameHelper.js") return { findFirst: findTemplate };
    if (request === "./navigate.js") {
        return {
            /**
             * 按当前测试页面模拟导航模块的场景识别结果。
             * @returns {"base"|"unknown"} 可被锻造任务识别的场景名称。
             */
            detectScene: function() { return scene === "base" ? "base" : "unknown"; }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

// 点击坐标由每个模板的固定位置区分，以验证实际页面切换而非只检查日志。
global.click = function(x, y) {
    if (x === 110 && y === 110) {
        scene = "forge";
        clicks.push("enterForge");
    } else if (x === 210 && y === 210) {
        clicks.push("startForge");
    } else if (x === 310 && y === 310) {
        scene = "base";
        clicks.push("returnBase");
    } else if (x === 100 && y === 2320) {
        // 锻造完成弹窗关闭后才应继续识别开始锻造按钮。
        doneVisible = false;
        clicks.push("closeDone");
    } else {
        clicks.push("other");
    }
};
global.sleep = function() {};
global.random = function(minimum) { return minimum; };
global.context = {
    getResources: function() {
        return { getDisplayMetrics: function() { return { widthPixels: 1080, heightPixels: 2400 }; } };
    }
};

var weapon = require("../modules/weapon.js");

// 从基地启动锻造后，模块必须在本轮结束前重新回到基地。
assert.strictEqual(weapon.runOnce(imgs, "枪械", "蓝级", function(message) { logs.push(message); }, function() { return false; }), true);
assert.deepStrictEqual(clicks, ["enterForge", "startForge", "returnBase"]);
assert.ok(logs.indexOf("锻造任务结束，已返回主界面") >= 0);

// 正在锻造时没有“开始锻造”按钮，本轮仍须关闭详情页，供其他任务使用主界面。
scene = "base";
startAvailable = false;
clicks.length = 0;
assert.strictEqual(weapon.runOnce(imgs, "枪械", "蓝级", function() {}, function() { return false; }), false);
assert.deepStrictEqual(clicks, ["enterForge", "returnBase"]);

// 锻造完成提示关闭后重新开工，也必须在同一轮结束前退出锻造详情页。
scene = "base";
startAvailable = true;
doneVisible = true;
clicks.length = 0;
assert.strictEqual(weapon.runOnce(imgs, "枪械", "蓝级", function() {}, function() { return false; }), true);
assert.deepStrictEqual(clicks, ["enterForge", "closeDone", "startForge", "returnBase"]);

// 上轮未退出时首先看到的是锻造页；本轮必须先恢复页面，再正常执行并再次退出。
scene = "forge";
doneVisible = false;
clicks.length = 0;
assert.strictEqual(weapon.runOnce(imgs, "枪械", "蓝级", function() {}, function() { return false; }), true);
assert.deepStrictEqual(clicks, ["returnBase", "enterForge", "startForge", "returnBase"]);

Module._load = originalLoad;
console.log("weapon return-main test passed");
