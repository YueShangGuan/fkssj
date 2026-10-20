// exhibition.test.js — 以 Node 桩覆盖展区冷却、领奖、地点顺序与派遣安全分支

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var sourcePath = path.join(__dirname, "..", "..", "modules", "exhibition.js");
var source = fs.readFileSync(sourcePath, "utf8") + [
    "module.exports._test = {",
    "normalizeConfiguredSites: normalizeConfiguredSites,",
    "claimCompletedTeams: claimCompletedTeams,",
    "enterTreasurePage: enterTreasurePage,",
    "collectExhibitionBubbles: collectExhibitionBubbles,",
    "selectDurationAndStart: selectDurationAndStart,",
    "tryDispatchSite: tryDispatchSite,",
    "fillIdleTeams: fillIdleTeams,",
    "returnToMainScene: returnToMainScene,",
    "durationPoints: FIXED_POINTS.durationHours",
    "};"
].join("\n");

/**
 * 构造只带尺寸与名称的模板替身，满足模块的模板中心点击计算。
 * @param {string} name 模板名称。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} 测试图片替身。
 */
function makeImage(name) {
    return {
        name: name,
        getWidth: function() { return 10; },
        getHeight: function() { return 10; }
    };
}

/**
 * 构造展区模块测试所需的全部模板键；测试仅比较对象身份，不依赖真实图片文件。
 * @returns {Object} 模板键到替身图片的映射。
 */
function makeImages() {
    var names = [
        "baseIcon", "worldIcon", "tradePortEntry", "tradePortClose", "tradePortRewardTitle", "rewardDismissHint",
        "exhibitionMuseum", "exhibitionBubble", "exhibitionTreasureEntry", "exhibitionTreasureTitle",
        "exhibitionSitePin", "exhibitionCompleted", "exhibitionIdle", "exhibitionClaimReward",
        "exhibitionTeamBuild", "exhibitionAddHero", "exhibitionConfirmHero", "exhibitionStart",
        "exhibitionClose", "exhibitionBack"
    ];
    var imgs = {};
    names.forEach(function(name) { imgs[name] = makeImage(name); });
    return imgs;
}

/**
 * 在隔离 VM 中加载展区模块，并选择性注入 AutoJs6 全局 API 的 Node 替身。
 * @param {Object} overrides 需要覆盖的全局依赖。
 * @returns {{api: Object, context: Object}} 已加载模块和其沙箱上下文。
 */
function loadExhibition(overrides) {
    overrides = overrides || {};
    var context = {
        module: { exports: {} },
        exports: {},
        require: overrides.require || function() { throw new Error("Unexpected require"); },
        click: overrides.click || function() {},
        back: overrides.back || function() {},
        sleep: overrides.sleep || function() {},
        log: overrides.log || function() {},
        captureScreen: overrides.captureScreen || function() { return { recycle: function() {} }; },
        images: overrides.images || { pixel: function() { return 0xFF000000; } },
        ocr: overrides.ocr || { mlkit: { detect: function() { return []; } } },
        Date: overrides.Date || Date,
        console: console
    };
    vm.runInNewContext(source, context, { filename: sourcePath });
    return { api: context.module.exports, context: context };
}

/**
 * 验证冷却期在加载游戏工具、截图、OCR 与点击之前直接返回。
 */
function testCooldownSkipsAllIo() {
    var requireCalls = 0;
    var clickCalls = 0;
    var captureCalls = 0;
    var loaded = loadExhibition({
        Date: { now: function() { return 10000; } },
        require: function() { requireCalls++; throw new Error("冷却期不应加载依赖"); },
        click: function() { clickCalls++; },
        captureScreen: function() { captureCalls++; throw new Error("冷却期不应截图"); }
    });
    var result = loaded.api.runOnce({}, {
        intervalMinutes: 10,
        lastCompletedAt: 9500,
        durationHours: 4,
        sites: ["旧灯塔瞭望台"]
    }, function() { return false; }, function() {}, function() {});

    assert.strictEqual(result.status, "cooldown");
    assert.strictEqual(requireCalls, 0);
    assert.strictEqual(clickCalls, 0);
    assert.strictEqual(captureCalls, 0);
}

/**
 * 验证停止请求会单独返回中止状态，且在尚未进入流程时不加载识图依赖或产生触屏。
 */
function testStopSkipsAllIo() {
    var requireCalls = 0;
    var clickCalls = 0;
    var captureCalls = 0;
    var loaded = loadExhibition({
        require: function() { requireCalls++; throw new Error("停止前不应加载依赖"); },
        click: function() { clickCalls++; },
        captureScreen: function() { captureCalls++; throw new Error("停止前不应截图"); }
    });
    var result = loaded.api.runOnce({}, {
        intervalMinutes: 10,
        lastCompletedAt: 0,
        durationHours: 4,
        sites: ["旧灯塔瞭望台"]
    }, function() { return true; }, function() {}, function() {});

    assert.strictEqual(result.status, "interrupted");
    assert.strictEqual(requireCalls, 0);
    assert.strictEqual(clickCalls, 0);
    assert.strictEqual(captureCalls, 0);
}

/**
 * 验证用户任意点击顺序都会恢复为固定的地点业务顺序。
 */
function testConfiguredSiteOrder() {
    var loaded = loadExhibition();
    // VM 内创建的数组原型与 Node 宿主不同，序列化后只比较业务元素与顺序。
    assert.deepStrictEqual(JSON.parse(JSON.stringify(loaded.api._test.normalizeConfiguredSites([
        "沙漠绿洲", "旧灯塔瞭望台", "法老之墓"
    ]))), ["旧灯塔瞭望台", "法老之墓", "沙漠绿洲"]);
}

/**
 * 验证从 MuMu 原始截图校准的单选框点击中心，不会落到下方物资区或开始按钮上方。
 */
function testDurationControlCalibration() {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(loadedDurationPoints())), {
        4: [210, 1650],
        8: [460, 1650],
        12: [710, 1650]
    });
}

/**
 * 读取 VM 内的基准时长点击坐标，消除跨上下文数组原型差异。
 * @returns {Object} 时长到原始截图坐标的映射。
 */
function loadedDurationPoints() {
    return loadExhibition().api._test.durationPoints;
}

/**
 * 验证已完成队伍最多领取三次，且每次均先点领取奖励再关闭恭喜获得层。
 */
function testCompletedRewardLimit() {
    var imgs = makeImages();
    var state = { page: "treasure", remaining: 5, completedClicks: 0, claimClicks: 0, rewardCloseClicks: 0 };
    var loaded = loadExhibition({
        click: function(x, y) {
            if (x === 15) {
                state.completedClicks++;
                state.page = "completion";
            } else if (x === 105) {
                state.claimClicks++;
                state.page = "reward";
            } else if (x === 540 && y === 1800) {
                state.rewardCloseClicks++;
                state.remaining--;
                state.page = "treasure";
            }
        }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.exhibitionCompleted) return state.page === "treasure" && state.remaining > 0 ? { x: 10, y: 10 } : null;
            if (image === imgs.exhibitionClaimReward) return state.page === "completion" ? { x: 100, y: 10 } : null;
            if (image === imgs.tradePortRewardTitle) return state.page === "reward" ? { x: 200, y: 10 } : null;
            if (image === imgs.exhibitionTreasureTitle) return state.page === "treasure" ? { x: 300, y: 10 } : null;
            return null;
        },
        // 奖励层只有在测试状态机进入 reward 后才允许关闭，模拟底部提示已出现。
        waitForRewardDismissHint: function(image) {
            return image === imgs.rewardDismissHint && state.page === "reward";
        }
    };
    var flow = { page: "treasure" };
    assert.strictEqual(loaded.api._test.claimCompletedTeams(imgs, gameHelper, { x: 1, y: 1 }, flow, function() { return false; }, function() {}), true);
    assert.strictEqual(state.completedClicks, 3);
    assert.strictEqual(state.claimClicks, 3);
    assert.strictEqual(state.rewardCloseClicks, 3);
    assert.strictEqual(state.remaining, 2);
}

/**
 * 验证“探险完成”动画期间会有限等待领奖按钮，而不是把动画中的短暂缺图视为失败。
 */
function testCompletedRewardWaitsForCompletionAnimation() {
    var imgs = makeImages();
    var state = { page: "treasure", remaining: 1, completedClicks: 0, claimClicks: 0, rewardCloseClicks: 0, claimChecks: 0 };
    var notifications = [];
    var loaded = loadExhibition({
        click: function(x, y) {
            if (x === 15) {
                state.completedClicks++;
                state.page = "completion";
            } else if (x === 105) {
                state.claimClicks++;
                state.page = "reward";
            } else if (x === 540 && y === 1800) {
                state.rewardCloseClicks++;
                state.remaining--;
                state.page = "treasure";
            }
        }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.exhibitionCompleted) return state.page === "treasure" && state.remaining > 0 ? { x: 10, y: 10 } : null;
            if (image === imgs.exhibitionClaimReward) {
                state.claimChecks++;
                return state.page === "completion" && state.claimChecks >= 3 ? { x: 100, y: 10 } : null;
            }
            if (image === imgs.tradePortRewardTitle) return state.page === "reward" ? { x: 200, y: 10 } : null;
            if (image === imgs.exhibitionTreasureTitle) return state.page === "treasure" ? { x: 300, y: 10 } : null;
            return null;
        },
        waitForRewardDismissHint: function(image) {
            return image === imgs.rewardDismissHint && state.page === "reward";
        },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            notifications.push([taskName, positionName]);
            return false;
        }
    };
    var flow = { page: "treasure" };
    assert.strictEqual(loaded.api._test.claimCompletedTeams(imgs, gameHelper, { x: 1, y: 1 }, flow, function() { return false; }, function() {}), true);
    assert.strictEqual(state.claimChecks, 3);
    assert.strictEqual(state.completedClicks, 1);
    assert.strictEqual(state.claimClicks, 1);
    assert.strictEqual(state.rewardCloseClicks, 1);
    assert.deepStrictEqual(notifications, []);
}

/**
 * 验证展区已进入博物馆后找不到寻宝入口，会 Toast 提示并且不继续点击未知位置。
 */
function testMissingTreasureEntryNotifies() {
    var imgs = makeImages();
    var notifications = [];
    var loaded = loadExhibition();
    var gameHelper = {
        findFirst: function() { return null; },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            notifications.push([taskName, positionName]);
            return false;
        }
    };
    assert.strictEqual(loaded.api._test.enterTreasurePage(
        imgs, gameHelper, { page: "exhibition" }, function() { return false; }, function() {}
    ), false);
    assert.deepStrictEqual(notifications, [["展区", "寻宝入口"]]);
}

/**
 * 构造可驱动 fillIdleTeams 的寻宝地图桩，模拟地点详情、默认英雄、时长选择与开始探险返回链路。
 * @param {Array<string>} sites 可见且已勾选的地点。
 * @param {number} slotCount 初始空闲队伍槽数量。
 * @param {Array<string>} unavailableSites 当前不可派遣的地点。
 * @returns {{api: Object, imgs: Object, gameHelper: Object, flow: Object, state: Object}} 可执行的测试场景。
 */
function createDispatchScenario(sites, slotCount, unavailableSites) {
    var imgs = makeImages();
    var state = {
        page: "treasure",
        openedSite: null,
        dispatchedSites: [],
        teamBuildChecks: {},
        selectedDuration: null
    };
    var loaded = loadExhibition({
        click: function(x) {
            if (x >= 105 && x <= 305 && (x - 105) % 100 === 0) {
                state.openedSite = sites[(x - 105) / 100];
                state.page = "detail";
                return;
            }
            if (x === 405) { state.page = "team"; return; }
            if (x === 505) { state.page = "heroSelect"; return; }
            if (x === 605) { state.page = "team"; return; }
            if (x === 705) { state.page = "teamAfterStart"; return; }
            if (x === 210 || x === 460 || x === 710) {
                state.selectedDuration = x === 210 ? 4 : x === 460 ? 8 : 12;
                return;
            }
            if (x === 905) {
                if (state.page === "detail") state.page = "treasure";
                else if (state.page === "teamAfterStart") {
                    state.dispatchedSites.push(state.openedSite);
                    state.openedSite = null;
                    state.page = "treasure";
                } else if (state.page === "team") state.page = "detail";
                else if (state.page === "heroSelect") state.page = "team";
            }
        },
        images: {
            pixel: function(screen, x, y) {
                var durationX = state.selectedDuration === 4 ? 210 : state.selectedDuration === 8 ? 460 : state.selectedDuration === 12 ? 710 : -1;
                if (Math.abs(x - durationX) <= 30 && Math.abs(y - 1650) <= 30) return 0xFF269926;
                return 0xFF000000;
            }
        },
        ocr: {
            mlkit: {
                detect: function() {
                    return [{ label: "1." + state.openedSite, bounds: { left: 0 } }];
                }
            }
        }
    });
    var gameHelper = {
        findAll: function(image) {
            if (image === imgs.exhibitionIdle) {
                var remaining = slotCount - state.dispatchedSites.length;
                var slots = [];
                for (var i = 0; i < remaining; i++) slots.push({ x: 20 + i * 30, y: 2100 });
                return slots;
            }
            if (image === imgs.exhibitionSitePin) {
                return sites.map(function(site, index) { return { x: 100 + index * 100, y: 200 }; });
            }
            return [];
        },
        findFirst: function(image) {
            if (image === imgs.exhibitionTreasureTitle) return state.page === "treasure" ? { x: 20, y: 20 } : null;
            if (image === imgs.exhibitionClose) return ["detail", "team", "heroSelect", "teamAfterStart"].indexOf(state.page) >= 0 ? { x: 900, y: 20 } : null;
            if (image === imgs.exhibitionTeamBuild) {
                if (state.page !== "detail") return null;
                state.teamBuildChecks[state.openedSite] = (state.teamBuildChecks[state.openedSite] || 0) + 1;
                return unavailableSites.indexOf(state.openedSite) >= 0 ? null : { x: 400, y: 20 };
            }
            if (image === imgs.exhibitionAddHero) return state.page === "team" ? { x: 500, y: 20 } : null;
            if (image === imgs.exhibitionConfirmHero) return state.page === "heroSelect" ? { x: 600, y: 20 } : null;
            if (image === imgs.exhibitionStart) return state.page === "team" ? { x: 700, y: 20 } : null;
            return null;
        }
    };
    return { api: loaded.api, imgs: imgs, gameHelper: gameHelper, flow: { page: "treasure" }, state: state };
}

/**
 * 验证多个空闲槽会按配置顺序填满，且同一地点的组队流程在本轮只执行一次。
 */
function testFillMultipleSlotsWithoutRepeat() {
    var sites = ["旧灯塔瞭望台", "图书馆残址", "羽蛇神祭坛"];
    var scenario = createDispatchScenario(sites, 3, []);
    assert.strictEqual(scenario.api._test.fillIdleTeams(
        scenario.imgs,
        scenario.gameHelper,
        { x: 1, y: 1 },
        sites,
        4,
        scenario.flow,
        function() { return false; },
        function() {}
    ), true);
    assert.deepStrictEqual(scenario.state.dispatchedSites, sites);
    sites.forEach(function(site) {
        assert.strictEqual(scenario.state.teamBuildChecks[site], 1, "地点不应在同一轮重复组队：" + site);
    });
}

/**
 * 验证没有“组建小队”的地点会安全跳过，并继续尝试下一个已配置地点。
 */
function testUnavailableSiteSkipsToNext() {
    var sites = ["旧灯塔瞭望台", "图书馆残址"];
    var scenario = createDispatchScenario(sites, 1, ["旧灯塔瞭望台"]);
    assert.strictEqual(scenario.api._test.fillIdleTeams(
        scenario.imgs,
        scenario.gameHelper,
        { x: 1, y: 1 },
        sites,
        4,
        scenario.flow,
        function() { return false; },
        function() {}
    ), true);
    assert.deepStrictEqual(scenario.state.dispatchedSites, ["图书馆残址"]);
    assert.strictEqual(scenario.state.teamBuildChecks["旧灯塔瞭望台"], 1);
    assert.strictEqual(scenario.state.teamBuildChecks["图书馆残址"], 1);
}

/**
 * 验证点击添加英雄后仍保持空队伍时，脚本不会把“确认”模板缺失当作异常，
 * 也不会猜测英雄卡坐标；调用方可沿已确认的组队页安全退出。
 */
function testMissingDefaultHeroStopsDispatchSafely() {
    var imgs = makeImages();
    var logs = [];
    var requiredPositionReports = [];
    var flow = { page: "detail" };
    var loaded = loadExhibition({
        click: function(x) {
            if (x === 105) flow.page = "detail";
            if (x === 405) flow.page = "team";
            // 模拟现场“+”已点击但游戏没有自动选择英雄，页面仍停留在组队页。
            if (x === 505) flow.page = "team";
        },
        ocr: {
            mlkit: {
                detect: function() {
                    return [{ label: "旧灯塔瞭望台", bounds: { left: 0 } }];
                }
            }
        }
    });
    var gameHelper = {
        findFirst: function(image) {
            // 地点图钉点击后模块会先将 flow 标为 unknown；详情关闭模板是该状态转换的实际确认依据。
            if (image === imgs.exhibitionClose) return { x: 900, y: 20 };
            if (image === imgs.exhibitionTeamBuild) return flow.page === "detail" ? { x: 400, y: 20 } : null;
            if (image === imgs.exhibitionAddHero) return flow.page === "team" ? { x: 500, y: 20 } : null;
            if (image === imgs.exhibitionConfirmHero) return null;
            return null;
        },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            requiredPositionReports.push([taskName, positionName]);
            return false;
        }
    };

    var result = loaded.api._test.tryDispatchSite(
        imgs,
        gameHelper,
        { x: 1, y: 1 },
        { site: "旧灯塔瞭望台", point: { x: 100, y: 200 } },
        4,
        flow,
        function() { return false; },
        function(message) { logs.push(message); }
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.started, false);
    assert.strictEqual(flow.page, "team");
    assert.deepStrictEqual(requiredPositionReports, []);
    assert.ok(logs.some(function(message) { return message.indexOf("未自动选中英雄") >= 0; }));
}

/**
 * 构造时长与物资颜色测试场景；红色像素表示当前选择的时长物资不足。
 * @param {Object} insufficientByHour 时长到是否红字的映射。
 * @param {Array<number>} unselectableHours 被游戏置灰、点击后不改变选中态的时长。
 * @returns {{api: Object, imgs: Object, gameHelper: Object, flow: Object, state: Object}} 可调用 selectDurationAndStart 的场景。
 */
function createDurationScenario(insufficientByHour, unselectableHours) {
    unselectableHours = unselectableHours || [];
    var imgs = makeImages();
    var flow = { page: "team" };
    var state = { selectedHours: [], startClicks: 0, closeClicks: 0, currentHour: null };
    var loaded = loadExhibition({
        click: function(x) {
            if (x === 210 || x === 460 || x === 710) {
                var requestedHour = x === 210 ? 4 : x === 460 ? 8 : 12;
                state.selectedHours.push(requestedHour);
                if (unselectableHours.indexOf(requestedHour) < 0) state.currentHour = requestedHour;
                return;
            }
            if (x === 705) {
                state.startClicks++;
                flow.page = "teamAfterStart";
                return;
            }
            if (x === 905) {
                state.closeClicks++;
                if (flow.page === "teamAfterStart") flow.page = "treasure";
                else if (flow.page === "team") flow.page = "detail";
                else if (flow.page === "detail") flow.page = "treasure";
            }
        },
        images: {
            pixel: function(screen, x, y) {
                var durationX = state.currentHour === 4 ? 210 : state.currentHour === 8 ? 460 : state.currentHour === 12 ? 710 : -1;
                if (Math.abs(x - durationX) <= 30 && Math.abs(y - 1650) <= 30) return 0xFF269926;
                return insufficientByHour[state.currentHour] ? 0xFFFF0000 : 0xFF000000;
            }
        }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.exhibitionStart) return flow.page === "team" ? { x: 700, y: 20 } : null;
            if (image === imgs.exhibitionClose) return ["team", "detail", "teamAfterStart"].indexOf(flow.page) >= 0 ? { x: 900, y: 20 } : null;
            if (image === imgs.exhibitionTreasureTitle) return flow.page === "treasure" ? { x: 20, y: 20 } : null;
            return null;
        }
    };
    return { api: loaded.api, imgs: imgs, gameHelper: gameHelper, flow: flow, state: state };
}

/**
 * 验证 12 小时、8 小时物资不足时依次降到 4 小时，并只在确认充足时开始探险。
 */
function testDurationFallback() {
    var scenario = createDurationScenario({ 12: true, 8: true, 4: false });
    var result = scenario.api._test.selectDurationAndStart(
        scenario.imgs, scenario.gameHelper, { x: 1, y: 1 }, 12, scenario.flow, function() { return false; }, function() {}
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.started, true);
    assert.deepStrictEqual(scenario.state.selectedHours, [12, 8, 4]);
    assert.strictEqual(scenario.state.startClicks, 1);
    assert.strictEqual(scenario.flow.page, "treasure");
}

/**
 * 验证游戏将 12 小时置灰时，脚本不会沿用旧时长启动，而会确认 8 小时选中后再出发。
 */
function testDisabledDurationFallsBack() {
    var scenario = createDurationScenario({ 8: false }, [12]);
    var result = scenario.api._test.selectDurationAndStart(
        scenario.imgs, scenario.gameHelper, { x: 1, y: 1 }, 12, scenario.flow, function() { return false; }, function() {}
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.started, true);
    assert.deepStrictEqual(scenario.state.selectedHours, [12, 8]);
    assert.strictEqual(scenario.state.currentHour, 8);
    assert.strictEqual(scenario.state.startClicks, 1);
}

/**
 * 验证最低 4 小时仍缺物资时不点击开始探险，并依次关闭组队和地点详情返回寻宝页。
 */
function testInsufficientAtFourHoursSafelyReturns() {
    var scenario = createDurationScenario({ 4: true });
    var result = scenario.api._test.selectDurationAndStart(
        scenario.imgs, scenario.gameHelper, { x: 1, y: 1 }, 4, scenario.flow, function() { return false; }, function() {}
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.started, false);
    assert.deepStrictEqual(scenario.state.selectedHours, [4]);
    assert.strictEqual(scenario.state.startClicks, 0);
    assert.strictEqual(scenario.state.closeClicks, 2);
    assert.strictEqual(scenario.flow.page, "treasure");
}

/**
 * 验证已打开的“探险完成”页迟迟未出现领奖按钮时，不使用系统返回，避免触发游戏退出确认。
 */
function testCompletionPageDoesNotUseSystemBack() {
    var imgs = makeImages();
    var state = { page: "completion", backCalls: 0 };
    var logs = [];
    var loaded = loadExhibition({
        back: function() {
            state.backCalls++;
        }
    });
    var flow = { page: "completion" };
    assert.strictEqual(loaded.api._test.returnToMainScene(imgs, {}, { x: 1, y: 1 }, flow, function(message) { logs.push(message); }), false);
    assert.strictEqual(state.backCalls, 0);
    assert.ok(logs.some(function(message) { return message.indexOf("未使用系统返回") >= 0; }));
}

/**
 * 构造展区展品气泡找色场景；每个锚点模拟为独立展柜，避免测试再次依赖含背景的整图模板。
 * @param {boolean} removeAfterClick 是否模拟游戏在点击后移除对应气泡。
 * @returns {{api: Object, state: Object}} 可调用 collectExhibitionBubbles 的场景。
 */
function createBubbleCollectionScenario(removeAfterClick) {
    var state = {
        bubbles: [
            { x: 869, y: 919 }, { x: 523, y: 1078 }, { x: 863, y: 1287 }, { x: 534, y: 1473 }
        ],
        clicks: [],
        scanCalls: 0
    };
    var loaded = loadExhibition({
        captureScreen: function() {
            return { recycle: function() {} };
        },
        images: {
            findMultiColors: function(screen, anchorColor, pattern, options) {
                state.scanCalls++;
                assert.strictEqual(anchorColor, "#B5E19C");
                assert.strictEqual(pattern.length, 4);
                assert.strictEqual(options.threshold, 16);
                return state.bubbles.find(function(bubble) {
                    return bubble.x >= options.region[0] && bubble.x < options.region[0] + options.region[2] &&
                        bubble.y >= options.region[1] && bubble.y < options.region[1] + options.region[3];
                }) || null;
            }
        },
        click: function(x, y) {
            state.clicks.push([x, y]);
            if (!removeAfterClick) return;
            state.bubbles = state.bubbles.filter(function(bubble) {
                // 参观券锚点到实际触点的偏移必须保持稳定，不能点到底下的展柜。
                return x !== bubble.x + 21 || y !== bubble.y - 32;
            });
        }
    });
    return { api: loaded.api, state: state };
}

/**
 * 验证不同展柜背景下的四个参观券锚点都会被扫描、依次点击，并在消失后才报告完成。
 */
function testCollectsAllBubbleColorCandidates() {
    var scenario = createBubbleCollectionScenario(true);
    var logs = [];
    assert.strictEqual(scenario.api._test.collectExhibitionBubbles(
        { x: 1, y: 1 }, function() { return false; }, function(message) { logs.push(message); }
    ), true);
    assert.deepStrictEqual(scenario.state.clicks, [
        [890, 887], [544, 1046], [884, 1255], [555, 1441]
    ]);
    assert.strictEqual(scenario.state.bubbles.length, 0);
    assert.ok(scenario.state.scanCalls > 4);
    assert.ok(logs.some(function(message) { return message.indexOf("展品气泡收集完成") >= 0; }));
}

/**
 * 验证点击后同一气泡仍存在时安全中止，不能将未消失的气泡伪报为领取完成或重复点击。
 */
function testBubbleMustDisappearAfterClick() {
    var scenario = createBubbleCollectionScenario(false);
    var logs = [];
    assert.strictEqual(scenario.api._test.collectExhibitionBubbles(
        { x: 1, y: 1 }, function() { return false; }, function(message) { logs.push(message); }
    ), false);
    assert.strictEqual(scenario.state.clicks.length, 1);
    assert.ok(logs.some(function(message) { return message.indexOf("点击后仍可识别") >= 0; }));
}

testCooldownSkipsAllIo();
testStopSkipsAllIo();
testConfiguredSiteOrder();
testDurationControlCalibration();
testCompletedRewardLimit();
testCompletedRewardWaitsForCompletionAnimation();
testMissingTreasureEntryNotifies();
testFillMultipleSlotsWithoutRepeat();
testUnavailableSiteSkipsToNext();
testMissingDefaultHeroStopsDispatchSafely();
testDurationFallback();
testDisabledDurationFallsBack();
testInsufficientAtFourHoursSafelyReturns();
testCompletionPageDoesNotUseSystemBack();
testCollectsAllBubbleColorCandidates();
testBubbleMustDisappearAfterClick();
console.log("exhibition tests passed");
