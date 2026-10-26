// game-helper-resident-demand-assets.test.js — 避免 AutoJs JSX 整文件解析，静态验证居民需求模板加载契约

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var helperPath = path.resolve(__dirname, "../../modules/gameHelper.js");
var helperSource = fs.readFileSync(helperPath, "utf8");
var residentDemandPath = path.resolve(__dirname, "../../modules/residentDemand.js");
var residentDemandSource = fs.readFileSync(residentDemandPath, "utf8");
var assetDir = path.resolve(__dirname, "../../img/居民需求");

/**
 * 验证入口不再依赖单一居民头像，而是复用贸易港口的稳定上半部作为锚点。
 * 当前首位居民头像会变化；只有港口模板命中后才允许点击其下方固定居民槽位。
 * @param {string} helper 游戏公共工具源码。
 * @param {string} residentDemand 居民需求模块源码。
 */
function assertResidentDemandEntryUsesTradePortAnchor(helper, residentDemand) {
    assert.ok(helper.indexOf('tradePortEntry: images.read("./img/贸易港口/入口.png")') >= 0, "gameHelper 必须加载居民需求复用的贸易港口锚点模板");
    assert.ok(residentDemand.indexOf('"tradePortEntry"') >= 0, "居民需求必须将贸易港口模板视为必需资源");
    assert.ok(residentDemand.indexOf("RESIDENT_ENTRY_CLICK_OFFSET_FROM_TRADE_PORT = [40, 152]") >= 0, "居民入口必须使用已校准的贸易港口相对点击点");
    assert.ok(residentDemand.indexOf("findResidentDemandEntryPoint") >= 0, "居民需求必须通过港口锚点计算入口，而非识别单一头像");
    assert.strictEqual(helper.indexOf('residentDemandEntry: images.read("./img/居民需求/入口.png")') >= 0, false, "运行时不得继续加载单一居民头像模板");
}

/**
 * 验证 gameHelper 统一加载所有居民需求状态模板，且仓库内存在非空的对应素材。
 * @param {string} source gameHelper 源码。
 * @param {string} directory 居民需求素材目录。
 */
function assertResidentDemandAssetContract(source, directory) {
    var assets = [
        ["residentDemandPanel", "面板标识.png"],
        ["residentDemandSatisfy", "满足TA.png"],
        ["residentDemandRefresh", "刷新.png"],
        ["residentDemandImmediateComplete", "立即完成.png"],
        ["residentDemandBack", "返回.png"]
    ];
    assets.forEach(function(item) {
        assert.ok(source.indexOf(item[0] + ': images.read("./img/居民需求/' + item[1] + '")') >= 0, "gameHelper 必须加载 " + item[0]);
        var assetPath = path.join(directory, item[1]);
        assert.ok(fs.existsSync(assetPath), "模板文件必须存在: " + item[1]);
        assert.ok(fs.statSync(assetPath).size > 0, "模板文件不能为空: " + item[1]);
    });
}

assertResidentDemandAssetContract(helperSource, assetDir);
assertResidentDemandEntryUsesTradePortAnchor(helperSource, residentDemandSource);
console.log("game helper resident demand asset contract test passed");
