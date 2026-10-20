// weapon.js — 锻造任务：检测开始锻造按钮，检测锻造完成关闭弹窗

var weapon = {};

var gh = require("./gameHelper.js");

/**
 * 执行一次锻造检查与点击，供总调度器在普通任务轮次中调用。
 * @param {Object} loadedImages 已加载的锻造和导航图片。
 * @param {string} weaponType 用户选择的锻造种类。
 * @param {string} weaponLevel 用户选择的锻造等级。
 * @param {Function} uiLog 调度器日志回调。
 * @param {Function} shouldStop 是否收到停止请求。
 * @returns {boolean} 本轮是否已启动锻造并确认返回主界面。
 */
weapon.runOnce = function(loadedImages, weaponType, weaponLevel, uiLog, shouldStop) {
    var _log = uiLog || function() { console.log.apply(null, arguments); };
    if (!loadedImages) { _log("资源未加载，请先启动游戏"); return; }
    var targetImg = loadedImages.duanzao;
    var doneImg = loadedImages.duanzaoDone;
    if (!targetImg) { _log("锻造图片未加载"); return; }
    var dm = context.getResources().getDisplayMetrics();
    var sw = dm.widthPixels, sh = dm.heightPixels;
    _log("执行一次锻造检查");

    // 锻造类型/级别图片映射
    var typeImgMap = { "枪械": loadedImages.forgeTypeGun, "防具": loadedImages.forgeTypeArmor, "兵刃": loadedImages.forgeTypeBlade };
    var levelImgMap = { "蓝级": loadedImages.forgeLevelBlue, "紫级": loadedImages.forgeLevelPurple, "橙级": loadedImages.forgeLevelOrange };

    /**
     * 关闭锻造屋并确认回到基地，避免总调度下一轮把锻造详情页误判为未知界面。
     * @param {Object|null} knownBackPos 已识别的返回按钮位置；未提供时会重新识图。
     * @returns {boolean} 是否已确认回到基地。
     */
    function returnToBase(knownBackPos) {
        var backImg = loadedImages.forgeBack;
        if (!backImg) {
            gh.notifyRequiredPositionMissing("锻造", "锻造屋返回模板", _log);
            return false;
        }
        var backPos = knownBackPos || gh.findFirst(backImg, 0.7, "锻造屋返回");
        if (!backPos) {
            gh.notifyRequiredPositionMissing("锻造", "锻造屋返回", _log);
            return false;
        }
        click(backPos.x + backImg.getWidth() / 2, backPos.y + backImg.getHeight() / 2);
        _log("点击锻造屋返回");
        sleep(1500);

        // 返回按钮可能被动画或提示层吞掉，必须重新识别基地而不是仅凭点击判定成功。
        var scene = require("./navigate.js").detectScene(loadedImages);
        if (scene !== "base") {
            gh.notifyRequiredPositionMissing("锻造", "基地主界面确认", _log);
            return false;
        }
        _log("锻造任务结束，已返回主界面");
        return true;
    }

    /**
     * 将世界界面切回基地，确保锻造屋与开始锻造模板处于可识别场景。
     * @returns {boolean} 是否已处于或成功切换到基地。
     */
    function ensureBaseScene() {
        var navigate = require("./navigate.js");
        var scene = navigate.detectScene(loadedImages);
        if (scene === "base") return true;
        if (scene === "unknown") {
            // 上一轮若停在锻造详情页，先沿唯一的已知返回按钮恢复，再继续本轮锻造。
            var staleForgeBack = loadedImages.forgeBack && gh.findFirst(loadedImages.forgeBack, 0.7, "锻造屋返回");
            if (staleForgeBack) {
                _log("检测到仍在锻造屋，先返回主界面");
                return returnToBase(staleForgeBack);
            }
            return gh.notifyRequiredPositionMissing("锻造", "游戏主界面", _log);
        }
        var basePos = gh.findFirst(loadedImages.baseIcon, 0.7, "基地图标");
        if (!basePos) return gh.notifyRequiredPositionMissing("锻造", "基地入口", _log);
        click(basePos.x + loadedImages.baseIcon.getWidth() / 2, basePos.y + loadedImages.baseIcon.getHeight() / 2);
        _log("切换到基地");
        sleep(3000);
        return true;
    }

    /**
     * 打开锻造屋，以便按用户选项选择种类和等级。
     * @returns {boolean} 是否已找到并点击锻造屋。
     */
    function enterForge() {
        var forgePos = gh.findFirst(loadedImages.forgeHouse, 0.7, "锻造屋");
        if (!forgePos) {
            return gh.notifyRequiredPositionMissing("锻造", "锻造屋", _log);
        }
        click(forgePos.x + loadedImages.forgeHouse.getWidth() / 2, forgePos.y + loadedImages.forgeHouse.getHeight() / 2);
        _log("进入锻造屋");
        sleep(2000);
        return true;
    }

    /**
     * 仅在模板显示未选中时切换锻造类型和级别，避免重复点击已选配置。
     */
    function selectTypeAndLevel() {
        // 选择锻造种类
        var typeImg = typeImgMap[weaponType];
        if (typeImg) {
            var pos = gh.findFirst(typeImg, 0.8, weaponType + "未选中");
            if (pos) {
                click(pos.x + typeImg.getWidth() / 2, pos.y + typeImg.getHeight() / 2);
                _log("切换到 " + weaponType);
                sleep(1500);
            }
        }
        // 选择锻造级别
        var levelImg = levelImgMap[weaponLevel];
        if (levelImg) {
            var lpos = gh.findFirst(levelImg, 0.8, weaponLevel);
            if (lpos) {
                click(lpos.x + levelImg.getWidth() / 2, lpos.y + levelImg.getHeight() / 2);
                _log("选择 " + weaponLevel);
                sleep(1500);
            }
        }
    }

    // 每次动作都重新确认锻造屋和配置，避免限时任务切场景后点击到错误界面。
    if (!ensureBaseScene()) return false;
    if (!enterForge()) return false;
    selectTypeAndLevel();
    if (shouldStop()) {
        returnToBase();
        return false;
    }

    // 检测锻造完成弹窗，点击底部关闭
    if (doneImg) {
        var donePos = gh.findFirst(doneImg, 0.7, "锻造完成");
        if (donePos) {
            click(random(100, sw - 100), sh - random(80, 200));
            _log("锻造完成，点击底部关闭");
            sleep(2000);
        }
    }
    if (shouldStop()) {
        returnToBase();
        return false;
    }
    // 检测开始锻造
    var pos = gh.findFirst(targetImg, 0.7, "开始锻造");
    if (!pos) {
        _log("未找到开始锻造，本轮结束并返回主界面");
        returnToBase();
        return false;
    }
    click(pos.x + targetImg.getWidth() / 2, pos.y + targetImg.getHeight() / 2);
    _log("点击开始锻造: (" + pos.x + ", " + pos.y + ")");
    return returnToBase();
};

module.exports = weapon;
