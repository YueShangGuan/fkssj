// intelligence.test.js — 以 Node VM 覆盖情报冷却、领奖、状态过滤、舰队等待与安全返回

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var sourcePath = path.join(__dirname, "..", "..", "modules", "intelligence.js");
var source = fs.readFileSync(sourcePath, "utf8") + [
    "module.exports._test = {",
    "collectBubbleCandidates: collectBubbleCandidates,",
    "findCompletedRewardMarks: findCompletedRewardMarks,",
    "getCompletedBubbleClickPoint: getCompletedBubbleClickPoint,",
    "selectNextDispatchCandidate: selectNextDispatchCandidate,",
    "claimCompletedRewards: claimCompletedRewards,",
    "findKnownEventAction: findKnownEventAction,",
    "findGoButton: findGoButton,",
    "goToCandidateEvent: goToCandidateEvent,",
    "ensureWorldScene: ensureWorldScene,",
    "enterIntelligencePage: enterIntelligencePage,",
    "enterOrResumeIntelligencePage: enterOrResumeIntelligencePage,",
    "openFleetDialogForEvent: openFleetDialogForEvent,",
    "waitForDefaultFleetAndDispatch: waitForDefaultFleetAndDispatch,",
    "returnToBaseScene: returnToBaseScene",
    "};"
].join("\n");

/**
 * 构造尺寸固定的模板替身，使测试只关注识图调用和点击顺序。
 * @param {string} name 模板逻辑名称。
 * @returns {{name: string, getWidth: Function, getHeight: Function}} 模板替身。
 */
function makeImage(name) {
    return {
        name: name,
        getWidth: function() { return 10; },
        getHeight: function() { return 10; }
    };
}

/**
 * 构造情报模块完整必需模板键，测试通过对象身份模拟每种页面控件。
 * @returns {Object} 模板键到图片替身的映射。
 */
function makeImages() {
    var names = [
        "baseIcon", "worldIcon", "tradePortRewardTitle", "rewardDismissHint", "fleetChecked", "fleetDispatch",
        "intelligenceEntry", "intelligenceTitle", "intelligenceCompletedCheck", "intelligenceDimBubble",
        "intelligenceGo", "intelligenceBack", "intelligenceFleetClose",
        "intelligenceBubbleChest", "intelligenceBubbleFlag", "intelligenceBubbleTools",
        "intelligenceBubbleAttack", "intelligenceBubbleLightning", "intelligenceBubbleSalvage", "intelligenceBubbleRescue",
        "intelligenceEventSalvage", "intelligenceEventAttack", "intelligenceEventRescue", "intelligenceEventAid",
        "intelligenceEventExplore", "intelligenceEventOccupy", "intelligenceEventCollect"
    ];
    var imgs = {};
    names.forEach(function(name) { imgs[name] = makeImage(name); });
    return imgs;
}

/**
 * 在隔离 VM 中加载情报模块，并按测试需要注入 AutoJs6 全局 API 替身。
 * @param {Object} overrides 需要覆盖的运行时依赖。
 * @returns {{api: Object, context: Object}} 已加载模块与其沙箱上下文。
 */
function loadIntelligence(overrides) {
    overrides = overrides || {};
    var context = {
        module: { exports: {} },
        exports: {},
        require: overrides.require || function() { throw new Error("Unexpected require"); },
        click: overrides.click || function() {},
        sleep: overrides.sleep || function() {},
        log: overrides.log || function() {},
        images: overrides.images || { pixel: function() { return 0xFF348CFF; } },
        Date: overrides.Date || Date,
        console: console
    };
    context.captureScreen = Object.prototype.hasOwnProperty.call(overrides, "captureScreen") ? overrides.captureScreen : function() {
        return { recycle: function() {} };
    };
    vm.runInNewContext(source, context, { filename: sourcePath });
    return { api: context.module.exports, context: context };
}

/**
 * 验证 4 小时冷却在加载识图库、截图或点击之前直接返回。
 */
function testCooldownSkipsAllIo() {
    var requireCalls = 0;
    var clickCalls = 0;
    var captureCalls = 0;
    var loaded = loadIntelligence({
        Date: { now: function() { return 10000; } },
        require: function() { requireCalls++; throw new Error("冷却期不应加载依赖"); },
        click: function() { clickCalls++; },
        captureScreen: function() { captureCalls++; throw new Error("冷却期不应截图"); }
    });
    var result = loaded.api.runOnce({}, {
        intervalHours: 4,
        lastCompletedAt: 9999
    }, function() { return false; }, function() {}, function() {});

    assert.strictEqual(result.status, "cooldown");
    assert.strictEqual(requireCalls, 0);
    assert.strictEqual(clickCalls, 0);
    assert.strictEqual(captureCalls, 0);
}

/**
 * 验证所有模板返回乱序或跨模板重复时，候选仍按视觉顺序去重。
 */
function testBubbleCandidatesAreStableAndDeduped() {
    var imgs = makeImages();
    var loaded = loadIntelligence();
    var gameHelper = {
        findAllInGrayscale: function(image) {
            if (image === imgs.intelligenceBubbleChest) return [{ x: 400, y: 300 }, { x: 100, y: 100 }];
            // 第二种模板命中的是第一种模板已识别的同一个气泡，必须被去重。
            if (image === imgs.intelligenceBubbleFlag) return [{ x: 405, y: 304 }];
            return [];
        }
    };
    var candidates = loaded.api._test.collectBubbleCandidates(imgs, gameHelper);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(candidates.map(function(item) {
        return { x: item.x, y: item.y };
    }))), [{ x: 100, y: 100 }, { x: 400, y: 300 }]);
}

/**
 * 验证完成奖励直接从全屏绿色勾扫描，不依赖被勾覆盖的普通气泡图标先命中。
 */
function testCompletedMarksClaimWithoutOrdinaryBubbleMatch() {
    var imgs = makeImages();
    var state = { page: "intelligence", claimed: false, clicks: [], bubbleScans: 0 };
    var loaded = loadIntelligence({
        images: {
            pixel: function() { return 0xFF20DF45; }
        },
        click: function(x) {
            if (x === 115 && state.page === "intelligence") {
                state.page = "reward";
                state.clicks.push("completed-check");
            } else if (x === 540 && state.page === "reward") {
                state.page = "intelligence";
                state.claimed = true;
                state.clicks.push("reward-close");
            }
        }
    });
    var gameHelper = {
        findAllInGrayscale: function(image) {
            if (image === imgs.intelligenceCompletedCheck) {
                return state.page === "intelligence" && !state.claimed ? [{ x: 125, y: 280 }] : [];
            }
            state.bubbleScans++;
            return [];
        },
        findFirst: function(image) {
            if (image === imgs.tradePortRewardTitle && state.page === "reward") return { x: 200, y: 10 };
            if (image === imgs.intelligenceTitle && state.page === "intelligence") return { x: 950, y: 10 };
            return null;
        },
        waitForRewardDismissHint: function(image) {
            return image === imgs.rewardDismissHint && state.page === "reward";
        }
    };
    assert.strictEqual(loaded.api._test.claimCompletedRewards(
        imgs, gameHelper, { page: "intelligence" }, function() { return false; }, function() {}
    ), true);
    assert.deepStrictEqual(state.clicks, ["completed-check", "reward-close"]);
    assert.strictEqual(state.bubbleScans, 0, "领奖扫描不得依赖普通气泡模板");
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(loaded.api._test.getCompletedBubbleClickPoint({ x: 125, y: 280 }))),
        { x: 115, y: 375 }
    );
}

/**
 * 验证参考截图中的四个完成勾按视觉顺序逐个回算为气泡主体点击点，绝不触碰底部月卡入口。
 */
function testFourCompletedMarksClickBubblesIndividually() {
    var imgs = makeImages();
    var marks = [
        { x: 525, y: 853 }, { x: 825, y: 853 }, { x: 225, y: 1025 }, { x: 375, y: 1025 }
    ];
    var state = { page: "intelligence", claimedCount: 0, clicks: [] };
    var loaded = loadIntelligence({
        images: {
            pixel: function() { return 0xFF20DF45; }
        },
        click: function(x, y) {
            if (state.page === "intelligence") {
                var expected = marks[state.claimedCount];
                var point = loaded.api._test.getCompletedBubbleClickPoint(expected);
                if (point.x === x && point.y === y) {
                    state.page = "reward";
                    state.clicks.push("bubble-" + (state.claimedCount + 1));
                    return;
                }
            }
            if (x === 540 && state.page === "reward") {
                state.page = "intelligence";
                state.claimedCount++;
                state.clicks.push("reward-close");
            }
        }
    });
    var gameHelper = {
        findAllInGrayscale: function(image) {
            if (image === imgs.intelligenceCompletedCheck && state.page === "intelligence") {
                return marks.slice(state.claimedCount);
            }
            return [];
        },
        findFirst: function(image) {
            if (image === imgs.tradePortRewardTitle && state.page === "reward") return { x: 200, y: 10 };
            if (image === imgs.intelligenceTitle && state.page === "intelligence") return { x: 950, y: 10 };
            return null;
        },
        waitForRewardDismissHint: function(image) {
            return image === imgs.rewardDismissHint && state.page === "reward";
        }
    };
    assert.strictEqual(loaded.api._test.claimCompletedRewards(
        imgs, gameHelper, { page: "intelligence" }, function() { return false; }, function() {}
    ), true);
    assert.deepStrictEqual(state.clicks, [
        "bubble-1", "reward-close", "bubble-2", "reward-close",
        "bubble-3", "reward-close", "bubble-4", "reward-close"
    ]);
}

/**
 * 验证完成勾通过灰度模板定位；彩色查找若被调用即报错，防止气泡等级换色后重新引入漏检。
 */
function testCompletedMarksUseGrayscaleMatching() {
    var imgs = makeImages();
    var loaded = loadIntelligence({
        images: {
            pixel: function() { return 0xFF20DF45; }
        }
    });
    var gameHelper = {
        findAll: function() {
            throw new Error("完成勾不得使用彩色全屏查找");
        },
        findAllInGrayscale: function(image) {
            return image === imgs.intelligenceCompletedCheck ? [{ x: 225, y: 1025 }] : [];
        }
    };
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(loaded.api._test.findCompletedRewardMarks(imgs, gameHelper))),
        [{ x: 225, y: 1025 }]
    );
}

/**
 * 验证绿色完成勾与浅色进行中气泡均会跳过，剩余正常亮色气泡才可派遣。
 */
function testGreenAndDimBubblesAreFiltered() {
    var imgs = makeImages();
    var loaded = loadIntelligence({
        images: {
            pixel: function(screen, x) {
                // 完成勾、浅色气泡、亮色气泡分别使用可区分的真实业务色彩特征。
                if (x >= 120 && x < 150) return 0xFF20DF45;
                if (x >= 200 && x < 300) return 0xFF668099;
                return 0xFF348CFF;
            }
        }
    });
    var gameHelper = {
        findAllInGrayscale: function(image) {
            if (image === imgs.intelligenceBubbleFlag) return [{ x: 100, y: 100 }];
            if (image === imgs.intelligenceBubbleTools) return [{ x: 200, y: 100 }];
            if (image === imgs.intelligenceBubbleChest) return [{ x: 400, y: 100 }];
            return [];
        },
        findFirstInRegionInGrayscale: function(image, x) {
            if (image === imgs.intelligenceCompletedCheck && x < 150) return { x: 125, y: 80 };
            return null;
        },
        findFirstInRegion: function(image, x) {
            if (image === imgs.intelligenceDimBubble && x >= 190 && x < 220) return { x: 200, y: 100 };
            return null;
        }
    };
    var candidate = loaded.api._test.selectNextDispatchCandidate(imgs, gameHelper, [], function() {});
    assert.ok(candidate, "应保留一个正常亮色气泡");
    assert.strictEqual(candidate.x, 400);
}

/**
 * 验证浅色模板的相似误命中会被亮色像素反证，不能遗漏可派遣的正常气泡。
 */
function testDimTemplateDoesNotOverrideBrightBubble() {
    var imgs = makeImages();
    var loaded = loadIntelligence();
    var gameHelper = {
        findAllInGrayscale: function(image) {
            return image === imgs.intelligenceBubbleChest ? [{ x: 400, y: 100 }] : [];
        },
        findFirstInRegionInGrayscale: function() { return null; },
        findFirstInRegion: function(image) {
            // 模拟浅色模板因边缘相似命中；默认像素替身仍为亮色。
            return image === imgs.intelligenceDimBubble ? { x: 400, y: 100 } : null;
        }
    };
    var candidate = loaded.api._test.selectNextDispatchCandidate(imgs, gameHelper, [], function() {});
    assert.ok(candidate, "亮色反证后仍应派遣该气泡");
    assert.strictEqual(candidate.x, 400);
}

/**
 * 验证七类事件均只能通过各自真实按钮模板进入舰队弹窗，并保留“解救”和“救助”的独立文案。
 */
function testAllKnownEventButtons() {
    var imgs = makeImages();
    var actionKeys = [
        "intelligenceEventSalvage", "intelligenceEventAttack", "intelligenceEventRescue", "intelligenceEventAid",
        "intelligenceEventExplore", "intelligenceEventOccupy", "intelligenceEventCollect"
    ];
    var actionLabels = {
        intelligenceEventSalvage: "打捞",
        intelligenceEventAttack: "攻击",
        intelligenceEventRescue: "解救",
        intelligenceEventAid: "救助",
        intelligenceEventExplore: "探查",
        intelligenceEventOccupy: "占领",
        intelligenceEventCollect: "征收"
    };
    actionKeys.forEach(function(actionKey) {
        var state = { page: "event", clicks: 0 };
        var loaded = loadIntelligence({
            click: function(x) {
                if (x === 15 && state.page === "event") {
                    state.page = "fleet";
                    state.clicks++;
                }
            }
        });
        var gameHelper = {
            findFirst: function(image) {
                if (state.page === "event" && image === imgs[actionKey]) return { x: 10, y: 10 };
                if (state.page === "fleet" && image === imgs.intelligenceFleetClose) return { x: 20, y: 10 };
                return null;
            }
        };
        var eventAction = loaded.api._test.findKnownEventAction(imgs, gameHelper);
        assert.ok(eventAction, "应识别事件按钮：" + actionKey);
        assert.strictEqual(eventAction.template.key, actionKey);
        // 相近语义不能掩盖文本差异，日志和模板匹配必须反映实际事件按钮。
        assert.strictEqual(eventAction.template.label, actionLabels[actionKey]);
        assert.strictEqual(loaded.api._test.openFleetDialogForEvent(
            imgs, gameHelper, { page: "world" }, function() { return false; }, function() {}, eventAction
        ), true, "应识别事件按钮：" + actionKey);
        assert.strictEqual(state.clicks, 1, "每种事件只能点击一次对应按钮：" + actionKey);
    });
}

/**
 * 验证点击“前往”进入事件详情后，会按既定顺序逐一检测全部已知动作模板，
 * 并能在任一动作出现时结束扫描，避免仅在独立识别函数中覆盖而遗漏转场路径。
 */
function testGoToEventDetectsEveryKnownAction() {
    var actionKeys = [
        "intelligenceEventSalvage", "intelligenceEventAttack", "intelligenceEventRescue", "intelligenceEventAid",
        "intelligenceEventExplore", "intelligenceEventOccupy", "intelligenceEventCollect"
    ];
    actionKeys.forEach(function(actionKey, actionIndex) {
        var imgs = makeImages();
        var state = { page: "intelligence", checkedActionKeys: [] };
        var loaded = loadIntelligence({
            click: function(x) {
                if (x === 5 && state.page === "intelligence") state.page = "candidate";
                if (x === 15 && state.page === "candidate") state.page = "event";
            }
        });
        var gameHelper = {
            findFirst: function(image) {
                if (image === imgs.intelligenceGo && state.page === "candidate") return { x: 10, y: 0 };
                if (state.page !== "event") return null;
                for (var i = 0; i < actionKeys.length; i++) {
                    if (image === imgs[actionKeys[i]]) {
                        state.checkedActionKeys.push(actionKeys[i]);
                        return actionKeys[i] === actionKey ? { x: 20, y: 0 } : null;
                    }
                }
                return null;
            }
        };
        var flow = { page: "intelligence" };
        var eventAction = loaded.api._test.goToCandidateEvent(
            imgs,
            gameHelper,
            { x: 0, y: 0, image: imgs.intelligenceBubbleChest },
            flow,
            function() { return false; },
            function() {}
        );

        assert.ok(eventAction, "前往后应识别动作：" + actionKey);
        assert.strictEqual(eventAction.template.key, actionKey);
        assert.strictEqual(flow.page, "event");
        assert.deepStrictEqual(state.checkedActionKeys, actionKeys.slice(0, actionIndex + 1));
    });
}

/**
 * 验证“前往”后不再错误等待世界页的基地图标，而是轮询实际出现的事件按钮。
 */
function testGoToEventWaitsForActionWithoutBaseIcon() {
    var imgs = makeImages();
    var state = { page: "intelligence", actionChecks: 0, sleeps: [] };
    var loaded = loadIntelligence({
        sleep: function(milliseconds) { state.sleeps.push(milliseconds); },
        click: function(x) {
            if (x === 5 && state.page === "intelligence") state.page = "candidate";
            if (x === 15 && state.page === "candidate") state.page = "event";
        }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.intelligenceGo && state.page === "candidate") return { x: 10, y: 0 };
            if (image === imgs.intelligenceEventAttack && state.page === "event") {
                state.actionChecks++;
                return state.actionChecks >= 3 ? { x: 20, y: 0 } : null;
            }
            if (image === imgs.baseIcon) throw new Error("前往后不应要求基地图标");
            return null;
        }
    };
    var flow = { page: "intelligence" };
    var eventAction = loaded.api._test.goToCandidateEvent(
        imgs,
        gameHelper,
        { x: 0, y: 0, image: imgs.intelligenceBubbleChest },
        flow,
        function() { return false; },
        function() {}
    );

    assert.ok(eventAction, "延迟出现的攻击按钮应被识别");
    assert.strictEqual(eventAction.template.key, "intelligenceEventAttack");
    assert.strictEqual(flow.page, "event");
    assert.strictEqual(state.actionChecks, 3);
    assert.deepStrictEqual(state.sleeps, [800, 500, 500]);
}

/**
 * 验证详情卡入场期间“前往”可短暂漏检，后续稳定按钮模板出现时仍会点击，而不是立即中止任务。
 */
function testGoButtonRetriesUntilStableTemplateAppears() {
    var imgs = makeImages();
    var state = { checks: 0, sleeps: [], notices: [] };
    var loaded = loadIntelligence({
        sleep: function(milliseconds) { state.sleeps.push(milliseconds); }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image !== imgs.intelligenceGo) return null;
            state.checks++;
            return state.checks === 3 ? { x: 875, y: 1523 } : null;
        },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            state.notices.push([taskName, positionName]);
            return false;
        }
    };
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(loaded.api._test.findGoButton(imgs, gameHelper, function() { return false; }, function() {}))),
        { x: 875, y: 1523 }
    );
    assert.strictEqual(state.checks, 3);
    assert.deepStrictEqual(state.sleeps, [400, 400]);
    assert.deepStrictEqual(state.notices, []);
}

/**
 * 验证候选气泡点击后仍停在联盟情报地图时，有限等待结束后跳过该候选而不是误报“前往”模板缺失。
 */
function testCandidateStillOnMapIsSkippedWithoutPositionWarning() {
    var imgs = makeImages();
    var state = { clicks: [], sleeps: [], goChecks: 0, notices: [], logs: [] };
    var loaded = loadIntelligence({
        sleep: function(milliseconds) { state.sleeps.push(milliseconds); },
        click: function(x, y) { state.clicks.push([x, y]); }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.intelligenceGo) {
                state.goChecks++;
                return null;
            }
            if (image === imgs.intelligenceTitle) return { x: 950, y: 10 };
            return null;
        },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            state.notices.push([taskName, positionName]);
            return false;
        }
    };
    var flow = { page: "intelligence" };
    var result = loaded.api._test.goToCandidateEvent(
        imgs,
        gameHelper,
        { x: 200, y: 300, image: imgs.intelligenceBubbleChest, label: "宝箱气泡" },
        flow,
        function() { return false; },
        function(message) { state.logs.push(message); }
    );

    assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), { skipped: true });
    assert.strictEqual(flow.page, "intelligence");
    assert.strictEqual(state.goChecks, 6);
    assert.deepStrictEqual(state.sleeps, [800, 400, 400, 400, 400, 400]);
    assert.deepStrictEqual(state.notices, []);
    assert.ok(state.logs.some(function(message) { return message.indexOf("气泡未打开详情，跳过候选：宝箱气泡（205, 305）") >= 0; }));
}

/**
 * 验证跳过无法打开详情的候选后，即使其他页面都已安全返回基地，也绝不写入情报完成冷却。
 */
function testSkippedCandidateDoesNotPersistCompletion() {
    var imgs = makeImages();
    var state = { page: "intelligence", clicks: [], persisted: [], logs: [] };
    var gameHelper;
    var loaded = loadIntelligence({
        Date: { now: function() { return 1000000; } },
        require: function(request) {
            if (request === "./gameHelper.js") return gameHelper;
            throw new Error("Unexpected require: " + request);
        },
        click: function(x) {
            state.clicks.push(x);
            if (x === 205 && state.page === "intelligence") state.page = "world";
            else if (x === 305 && state.page === "world") state.page = "base";
        }
    });
    gameHelper = {
        findAllInGrayscale: function(image) {
            return image === imgs.intelligenceBubbleChest && state.page === "intelligence" ? [{ x: 100, y: 100 }] : [];
        },
        findFirstInRegionInGrayscale: function() { return null; },
        findFirstInRegion: function() { return null; },
        findFirst: function(image) {
            if (image === imgs.intelligenceTitle && state.page === "intelligence") return { x: 950, y: 10 };
            if (image === imgs.intelligenceBack && state.page === "intelligence") return { x: 200, y: 0 };
            if (image === imgs.baseIcon && state.page === "world") return { x: 300, y: 0 };
            if (image === imgs.worldIcon && state.page === "base") return { x: 400, y: 0 };
            return null;
        },
        notifyRequiredPositionMissing: function() {
            throw new Error("仍在情报地图的候选不应触发全局缺位恢复");
        }
    };
    var result = loaded.api.runOnce(
        imgs,
        { intervalHours: 4, lastCompletedAt: 0 },
        function() { return false; },
        function(message) { state.logs.push(message); },
        function(completedAt) { state.persisted.push(completedAt); }
    );

    assert.strictEqual(result.status, "failed");
    assert.strictEqual(result.waitSeconds, 30);
    assert.deepStrictEqual(state.persisted, []);
    assert.strictEqual(state.page, "base");
    assert.ok(state.logs.some(function(message) { return message.indexOf("有 1 个气泡未打开详情，未记录完成时间") >= 0; }));
}

/**
 * 验证已确认世界主界面后找不到情报入口，会提示缺失位置且不点击其他控件。
 */
function testMissingIntelligenceEntryNotifies() {
    var imgs = makeImages();
    var notifications = [];
    var loaded = loadIntelligence();
    var gameHelper = {
        findFirst: function(image) {
            return image === imgs.baseIcon ? { x: 10, y: 10 } : null;
        },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            notifications.push([taskName, positionName]);
            return false;
        }
    };
    assert.strictEqual(loaded.api._test.enterIntelligencePage(
        imgs, gameHelper, { page: "world" }, function() { return false; }, function() {}
    ), false);
    assert.deepStrictEqual(notifications, [["情报", "联盟情报入口"]]);
}

/**
 * 验证从基地切换到世界页时，基地图标延迟出现仍会在有限轮询内确认，
 * 避免把游戏转场帧误判为入口缺失后提前停止情报任务。
 */
function testWorldSceneWaitsForDelayedBaseIcon() {
    var imgs = makeImages();
    var state = { page: "base", worldChecks: 0, sleeps: [], clicks: [], notifications: [] };
    var loaded = loadIntelligence({
        sleep: function(milliseconds) { state.sleeps.push(milliseconds); },
        click: function(x, y) {
            state.clicks.push([x, y]);
            if (x === 15 && y === 15 && state.page === "base") state.page = "world";
        }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.worldIcon && state.page === "base") return { x: 10, y: 10 };
            if (image === imgs.baseIcon && state.page === "world") {
                state.worldChecks++;
                return state.worldChecks >= 3 ? { x: 900, y: 10 } : null;
            }
            return null;
        },
        notifyRequiredPositionMissing: function(taskName, positionName) {
            state.notifications.push([taskName, positionName]);
            return false;
        }
    };
    var flow = { page: "base" };

    assert.strictEqual(loaded.api._test.ensureWorldScene(
        imgs, gameHelper, flow, function() { return false; }, function() {}
    ), true);
    assert.deepStrictEqual(state.clicks, [[15, 15]]);
    assert.strictEqual(state.worldChecks, 3);
    assert.deepStrictEqual(state.sleeps, [400, 400]);
    assert.deepStrictEqual(state.notifications, []);
    assert.strictEqual(flow.page, "world");
}

/**
 * 验证没有空闲舰队时保留选择页并每 30 秒轮询，游戏自动勾选后才点击出征。
 */
function testFleetWaitPollsEveryThirtySeconds() {
    var imgs = makeImages();
    var state = { page: "fleet", checks: 0, sleeps: [], dispatches: 0 };
    var loaded = loadIntelligence({
        sleep: function(milliseconds) { state.sleeps.push(milliseconds); },
        click: function(x) {
            if (x === 605) {
                state.dispatches++;
                state.page = "world";
            }
        }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.fleetChecked && state.page === "fleet") {
                state.checks++;
                return state.checks >= 3 ? { x: 500, y: 10 } : null;
            }
            if (image === imgs.intelligenceFleetClose && state.page === "fleet") return { x: 700, y: 10 };
            if (image === imgs.fleetDispatch && state.page === "fleet") return { x: 600, y: 10 };
            if (image === imgs.baseIcon && state.page === "world") return { x: 900, y: 10 };
            return null;
        }
    };
    assert.strictEqual(loaded.api._test.waitForDefaultFleetAndDispatch(
        imgs, gameHelper, { page: "fleetDialog" }, function() { return false; }, function() {}
    ), true);
    assert.strictEqual(state.dispatches, 1);
    assert.deepStrictEqual(state.sleeps, [30000, 30000, 1500]);
    assert.strictEqual(source.indexOf("selectUnchecked"), -1, "情报任务不得调用舰队全选逻辑");
}

/**
 * 验证连续五分钟没有自动勾选舰队时返回专用跳过标记，避免无限停留在可能由整点商船占用的舰队弹窗。
 */
function testFleetWaitSkipsAfterFiveMinutesWithoutIdleFleet() {
    var imgs = makeImages();
    var state = { sleeps: [], closeChecks: 0 };
    var loaded = loadIntelligence({
        sleep: function(milliseconds) { state.sleeps.push(milliseconds); }
    });
    var gameHelper = {
        findFirst: function(image) {
            if (image === imgs.fleetChecked) return null;
            if (image === imgs.intelligenceFleetClose) {
                state.closeChecks++;
                return { x: 700, y: 10 };
            }
            return null;
        }
    };
    var logs = [];
    assert.strictEqual(loaded.api._test.waitForDefaultFleetAndDispatch(
        imgs, gameHelper, { page: "fleetDialog" }, function() { return false; }, function(message) { logs.push(message); }
    ), "noIdleFleet");
    assert.strictEqual(state.sleeps.length, 10, "应恰好等待十个 30 秒窗口");
    assert.deepStrictEqual(state.sleeps, [30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000]);
    assert.strictEqual(state.closeChecks, 11, "达到五分钟后仍需确认弹窗存在，才交由安全返回流程关闭");
    assert.ok(logs.some(function(message) { return message.indexOf("可能正在整点商船驻守") >= 0; }));
}

/**
 * 构造一次完整情报流程：可选择验证先领奖再派遣并安全回到基地，或在舰队弹窗停止。
 * @param {boolean} stopDuringFleet 是否在首次舰队勾选检查时请求停止。
 * @param {boolean} keepFleetBusy 是否始终不返回自动勾选状态，用于模拟商船驻守期间全舰队忙碌。
 * @returns {{api: Object, imgs: Object, state: Object}} 可执行的流程场景。
 */
function createRunScenario(stopDuringFleet, keepFleetBusy) {
    var imgs = makeImages();
    var state = {
        page: "base",
        phase: stopDuringFleet ? "normal" : "completed",
        clicks: [],
        dispatches: 0,
        stopped: false,
        persisted: []
    };
    var gameHelper = {
        findAllInGrayscale: function(image) {
            if (state.page === "intelligence" && state.phase === "completed" && image === imgs.intelligenceCompletedCheck) {
                return [{ x: 125, y: 280 }];
            }
            if (state.page !== "intelligence") return [];
            if (state.phase === "normal" && image === imgs.intelligenceBubbleTools) return [{ x: 200, y: 300 }];
            if (state.phase === "normal" && image === imgs.intelligenceBubbleChest) return [{ x: 400, y: 300 }];
            return [];
        },
        findFirstInRegionInGrayscale: function(image, x) {
            if (state.page === "intelligence" && state.phase === "completed" && image === imgs.intelligenceCompletedCheck) {
                return { x: 125, y: 280 };
            }
            return null;
        },
        findFirstInRegion: function(image, x) {
            if (state.page === "intelligence" && state.phase === "normal" && image === imgs.intelligenceDimBubble && x >= 190 && x < 220) {
                return { x: 200, y: 300 };
            }
            return null;
        },
        findFirst: function(image) {
            if (image === imgs.worldIcon && state.page === "base") return { x: 10, y: 10 };
            if (image === imgs.baseIcon && state.page === "world") return { x: 900, y: 10 };
            if (image === imgs.intelligenceEntry && state.page === "world") return { x: 100, y: 10 };
            if (image === imgs.intelligenceTitle && state.page === "intelligence") return { x: 950, y: 10 };
            if (image === imgs.tradePortRewardTitle && state.page === "reward") return { x: 200, y: 10 };
            if (image === imgs.intelligenceGo && state.page === "candidate") return { x: 300, y: 10 };
            if (image === imgs.intelligenceEventSalvage && state.page === "event") return { x: 500, y: 10 };
            if (image === imgs.intelligenceFleetClose && state.page === "fleet") return { x: 700, y: 10 };
            if (image === imgs.fleetChecked && state.page === "fleet") {
                if (stopDuringFleet) {
                    state.stopped = true;
                    return null;
                }
                if (keepFleetBusy) return null;
                return { x: 550, y: 10 };
            }
            if (image === imgs.fleetDispatch && state.page === "fleet") return { x: 600, y: 10 };
            if (image === imgs.intelligenceBack && state.page === "intelligence") return { x: 800, y: 10 };
            return null;
        },
        // 奖励层进入 reward 状态才视为底部关闭提示已显示，避免测试绕过新前置条件。
        waitForRewardDismissHint: function(image) {
            return image === imgs.rewardDismissHint && state.page === "reward";
        }
    };
    var loaded = loadIntelligence({
        Date: { now: function() { return 1000000; } },
        require: function(request) {
            if (request === "./gameHelper.js") return gameHelper;
            throw new Error("Unexpected require: " + request);
        },
        images: {
            pixel: function(screen, x) {
                if (x >= 120 && x < 150) return 0xFF20DF45;
                if (x >= 200 && x < 300) return 0xFF668099;
                return 0xFF348CFF;
            }
        },
        click: function(x) {
            if (x === 15 && state.page === "base") { state.page = "world"; state.clicks.push("world"); return; }
            if (x === 105 && state.page === "world") { state.page = "intelligence"; state.clicks.push("entry"); return; }
            if (x === 115 && state.page === "intelligence" && state.phase === "completed") { state.page = "reward"; state.clicks.push("completed"); return; }
            if (x === 540 && state.page === "reward") { state.page = "intelligence"; state.phase = "normal"; state.clicks.push("reward-close"); return; }
            if (x === 405 && state.page === "intelligence") { state.page = "candidate"; state.clicks.push("normal"); return; }
            if (x === 305 && state.page === "candidate") { state.page = "event"; state.clicks.push("go"); return; }
            if (x === 505 && state.page === "event") { state.page = "fleet"; state.clicks.push("event"); return; }
            if (x === 605 && state.page === "fleet") { state.page = "world"; state.phase = "done"; state.dispatches++; state.clicks.push("dispatch"); return; }
            if (x === 705 && state.page === "fleet") { state.page = "world"; state.clicks.push("fleet-close"); return; }
            if (x === 805 && state.page === "intelligence") { state.page = "world"; state.clicks.push("back"); return; }
            if (x === 905 && state.page === "world") { state.page = "base"; state.clicks.push("base"); }
        }
    });
    return { api: loaded.api, imgs: imgs, state: state };
}

/**
 * 验证完整流程严格先领取完成奖励，再过滤浅色气泡、派遣亮色气泡并确认回到基地后持久化。
 */
function testRewardFirstAndSafeCompletion() {
    var scenario = createRunScenario(false);
    var result = scenario.api.runOnce(scenario.imgs, { intervalHours: 4, lastCompletedAt: 0 }, function() {
        return scenario.state.stopped;
    }, function() {}, function(completedAt) {
        scenario.state.persisted.push(completedAt);
    });

    assert.strictEqual(result.status, "completed");
    assert.strictEqual(result.waitSeconds, 14400);
    assert.deepStrictEqual(scenario.state.clicks, [
        "world", "entry", "completed", "reward-close", "normal", "go", "event", "dispatch", "entry", "back", "base"
    ]);
    assert.strictEqual(scenario.state.dispatches, 1);
    assert.deepStrictEqual(scenario.state.persisted, [1000000]);
    assert.strictEqual(scenario.state.page, "base");
}

/**
 * 验证上轮在情报详情卡中断后，重启可从已确认的情报标题直接续跑，不强制要求用户先手动返回基地。
 */
function testRunResumesFromExistingIntelligencePage() {
    var scenario = createRunScenario(false);
    scenario.state.page = "intelligence";
    var result = scenario.api.runOnce(scenario.imgs, { intervalHours: 4, lastCompletedAt: 0 }, function() {
        return scenario.state.stopped;
    }, function() {}, function(completedAt) {
        scenario.state.persisted.push(completedAt);
    });

    assert.strictEqual(result.status, "completed");
    assert.deepStrictEqual(scenario.state.clicks, [
        "completed", "reward-close", "normal", "go", "event", "dispatch", "entry", "back", "base"
    ]);
    assert.strictEqual(scenario.state.page, "base");
}

/**
 * 验证在舰队选择页收到停止请求时关闭已确认弹窗并返回基地，但绝不写入完成时间。
 */
function testStopDoesNotPersistAndSafelyReturns() {
    var scenario = createRunScenario(true);
    var result = scenario.api.runOnce(scenario.imgs, { intervalHours: 4, lastCompletedAt: 0 }, function() {
        return scenario.state.stopped;
    }, function() {}, function(completedAt) {
        scenario.state.persisted.push(completedAt);
    });

    assert.strictEqual(result.status, "interrupted");
    assert.deepStrictEqual(scenario.state.persisted, []);
    assert.strictEqual(scenario.state.dispatches, 0);
    assert.ok(scenario.state.clicks.indexOf("fleet-close") >= 0, "停止时必须关闭已确认舰队弹窗");
    assert.strictEqual(scenario.state.page, "base");
}

/**
 * 验证舰队连续五分钟忙碌时关闭已确认弹窗、回到基地并跳过情报，不写完成时间，以便下一轮重新尝试。
 */
function testBusyFleetSkipsRunAndSafelyReturns() {
    var scenario = createRunScenario(false, true);
    var logs = [];
    var result = scenario.api.runOnce(scenario.imgs, { intervalHours: 4, lastCompletedAt: 0 }, function() {
        return scenario.state.stopped;
    }, function(message) { logs.push(message); }, function(completedAt) {
        scenario.state.persisted.push(completedAt);
    });

    assert.strictEqual(result.status, "skipped");
    assert.strictEqual(result.waitSeconds, 0);
    assert.deepStrictEqual(scenario.state.persisted, []);
    assert.strictEqual(scenario.state.dispatches, 0);
    assert.ok(scenario.state.clicks.indexOf("fleet-close") >= 0, "五分钟无空闲舰队后必须关闭已确认舰队弹窗");
    assert.strictEqual(scenario.state.page, "base");
    assert.ok(logs.some(function(message) { return message.indexOf("本轮已安全跳过") >= 0; }));
}

testCooldownSkipsAllIo();
testBubbleCandidatesAreStableAndDeduped();
testCompletedMarksClaimWithoutOrdinaryBubbleMatch();
testFourCompletedMarksClickBubblesIndividually();
testCompletedMarksUseGrayscaleMatching();
testGreenAndDimBubblesAreFiltered();
testDimTemplateDoesNotOverrideBrightBubble();
testAllKnownEventButtons();
testGoToEventDetectsEveryKnownAction();
testGoToEventWaitsForActionWithoutBaseIcon();
testGoButtonRetriesUntilStableTemplateAppears();
testCandidateStillOnMapIsSkippedWithoutPositionWarning();
testSkippedCandidateDoesNotPersistCompletion();
testMissingIntelligenceEntryNotifies();
testWorldSceneWaitsForDelayedBaseIcon();
testFleetWaitPollsEveryThirtySeconds();
testFleetWaitSkipsAfterFiveMinutesWithoutIdleFleet();
testRewardFirstAndSafeCompletion();
testRunResumesFromExistingIntelligencePage();
testStopDoesNotPersistAndSafelyReturns();
testBusyFleetSkipsRunAndSafelyReturns();
console.log("intelligence tests passed");
