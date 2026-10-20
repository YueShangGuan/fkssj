// scheduler.js — 总调度器：协调普通任务与限时任务的抢占顺序

var scheduler = {};

/**
 * 在可中断等待期间持续观察整点与盟战窗口，避免长间隔错过限时任务。
 */
function waitWithTimeChecks(seconds, shouldStop, onTick) {
    for (var i = 0; i < seconds && !shouldStop(); i++) {
        if (onTick()) return true;
        sleep(1000);
    }
    return false;
}

/**
 * 返回用于区分整点的本地时间键，防止同一小时重复执行商船。
 */
function hourKey(now) {
    return now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate() + "-" + now.getHours();
}

/**
 * 判断当前是否处于盟战持续抢占窗口。
 */
function isWarWindow(now) {
    return now.getHours() >= 20 && now.getHours() < 21;
}

/**
 * 判断当前整点是否允许商船任务执行。
 */
function isShipHour(now) {
    return now.getHours() >= 8 && now.getHours() < 22;
}

/**
 * 使用设备本地时间判断周五，避免宿主机时区影响锻造限定。
 */
function isFriday(now) {
    return now.getDay() === 5;
}

/**
 * 运行总调度器。普通任务固定按锻造、种植、打捞资源、贸易港口、展区、情报、挂机奖励执行；限时任务在安全动作边界抢占。
 * @param {Object} options 任务模块、配置、日志与状态回调。
 */
scheduler.run = function(options) {
    var imgs = options.images;
    var panel = options.panel;
    var shouldStop = options.shouldStop;
    var _log = options.log || function(msg) { log(msg); };
    var setStatus = options.setStatus || function() {};
    var onAction = options.onAction || function() {};
    var weapon = require("./weapon.js");
    var plantFood = require("./plantFood.js");
    var merchantShip = require("./merchantShip.js");
    var war = require("./war.js");
    var navigate = require("./navigate.js");
    var gameHelper = require("./gameHelper.js");
    var tradePort = require("./tradePort.js");
    var resourceGather = require("./resourceGather.js");
    var exhibition = require("./exhibition.js");
    var intelligence = require("./intelligence.js");
    var hangUpReward = require("./hangUpReward.js");
    var observedHour = hourKey(new Date());
    var pendingShip = panel.taskEnabled.ship && isShipHour(new Date()) && new Date().getMinutes() === 0;
    // 城战会跨多个轮询周期；复制所有标量配置，确保即使外部持有面板对象也不能在运行中改写本次计划。
    var warFleetPlans = (panel.warFleetPlans || []).map(function(plan) {
        return {
            mode: plan && plan.mode,
            target: plan && plan.target,
            repairAccelerate: !!(plan && plan.repairAccelerate),
            marchAccelerate: !!(plan && plan.marchAccelerate)
        };
    });
    var warClaimReward = panel.warClaimReward === true;
    // 打捞资源冷却只属于本次总调度进程；停止或重启后不从持久化配置恢复。
    var gatherLastCompletedAt = 0;
    // 挂机奖励与打捞资源一样只在本次调度会话中冷却，重启脚本后允许重新领取。
    var hangUpRewardLastCompletedAt = 0;

    /**
     * 将跨过的整点标记为待处理。盟战优先时保留该标记，活动结束后只补执行一次商船。
     */
    function observeTime() {
        var now = new Date();
        var currentHour = hourKey(now);
        if (currentHour !== observedHour) {
            observedHour = currentHour;
            if (panel.taskEnabled.ship && isShipHour(now)) {
                pendingShip = true;
                _log("[商船] 检测到新整点，等待安全动作边界执行");
            }
        }
    }

    /**
     * 在盟战窗口持续执行盟战动作，普通轮次会保持暂停直到窗口结束或用户停止。
     */
    function runWarWindow() {
        while (!shouldStop() && panel.taskEnabled.war && isWarWindow(new Date())) {
            setStatus("盟战抢占中（20:00-21:00）");
            // 使用启动时的副本，防止运行中的外部写入改变某支舰队的模式、目标或钻石开关。
            var handled = war.runOnce(imgs, warFleetPlans, _log, warClaimReward);
            if (handled) onAction("war");
            waitWithTimeChecks(panel.freq.war, shouldStop, observeTime);
        }
    }

    /**
     * 执行已到点的限时任务；盟战优先于同一整点的商船。
     */
    function runDueTimedTasks() {
        var didRunTimedTask = false;
        observeTime();
        if (panel.taskEnabled.war && isWarWindow(new Date())) {
            runWarWindow();
            didRunTimedTask = true;
            // 城战可能跨过新的整点；先更新观察时间，再消费已有待执行商船，避免补执行后重复触发。
            observeTime();
        }
        if (!shouldStop() && panel.taskEnabled.ship && pendingShip) {
            setStatus("执行整点商船");
            // 城战结束后仍保留的 pendingShip 只在此处消费一次，不回补多个历史整点。
            pendingShip = false;
            if (merchantShip.runOnce(imgs, _log, shouldStop)) onAction("ship");
            didRunTimedTask = true;
        }
        return didRunTimedTask;
    }

    /**
     * 将贸易港口、展区的分钟级冷却和情报、挂机奖励的小时级冷却转换为秒级等待值。
     * @param {string} taskKey 最后一次完整执行的普通任务键。
     * @returns {number} 下一轮可检查前的等待秒数。
     */
    function getRegularWaitSeconds(taskKey) {
        if (taskKey === "intelligence" || taskKey === "hangUpReward") return panel.freq[taskKey] * 60 * 60;
        return taskKey === "tradePort" || taskKey === "exhibition" ? panel.freq[taskKey] * 60 : panel.freq[taskKey];
    }

    /**
     * 在展区失败后统一执行模块指定的退避。页面恢复成功也不能跳过这段等待，
     * 否则同一个未解决的组队或识图状态会在每轮调度中被立即重复触发。
     * @param {{waitSeconds: number}} result 展区本轮失败结果。
     */
    function waitAfterFailedExhibition(result) {
        var retrySeconds = Math.max(30, Number(result && result.waitSeconds) || 30);
        setStatus("展区本轮失败，" + retrySeconds + " 秒后重试");
        waitWithTimeChecks(retrySeconds, shouldStop, runDueTimedTasks);
    }

    /**
     * 判断某个任务是否是唯一启用任务。
     * 冷却任务与其他普通或限时任务共存时不得独占长等待，以免延后其他任务的检查。
     * @param {string} taskKey 待判断的任务键。
     * @returns {boolean} 仅该任务开关开启时返回 true。
     */
    function isOnlyTaskEnabled(taskKey) {
        var keys = Object.keys(panel.taskEnabled || {});
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] !== taskKey && panel.taskEnabled[keys[i]]) return false;
        }
        return !!panel.taskEnabled[taskKey];
    }

    /**
     * 返回资源任务在本次调度会话中还需等待的秒数。
     * 仅在没有其他普通任务决定等待节奏时使用，避免资源冷却改变锻造或种植的频率。
     * @returns {number} 最小为 1 的剩余等待秒数。
     */
    function getGatherCooldownSeconds() {
        var intervalMs = panel.gatherIntervalMinutes * 60 * 1000;
        return Math.max(1, Math.ceil((intervalMs - (Date.now() - gatherLastCompletedAt)) / 1000));
    }

    /**
     * 在每个任务边界确认仍处于基地或世界主界面。
     * 任务失败后保留在未知弹层时，继续运行后续模块会把安全失败放大成一串无效告警。
     *
     * @param {string} stage 触发确认的任务边界名称。
     * @returns {boolean} 页面未知并已进入无触控退避时返回 true。
     */
    function pauseRoundWhenMainSceneUnknown(stage) {
        if (navigate.detectScene(imgs) !== "unknown") return false;

        var recovered = gameHelper.reportRequiredPositionMissing("调度", stage + "游戏主界面", _log);
        if (!recovered) {
            // AutoJs 调度器运行在独立线程，不能依赖入口线程写入的模块级恢复回调；在告警已落盘后直接执行同一套有限、页面感知的恢复流程。
            recovered = navigate.recoverToMainScene(imgs, shouldStop, function(message) {
                _log("[调度 / " + stage + "游戏主界面] " + message);
            });
        }
        if (recovered) {
            // 页面恢复后丢弃本轮临时任务状态，从新的主界面开始完整调度。
            _log("[调度] " + stage + "已恢复主界面，重新开始本轮");
            setStatus("已回到主界面，重新开始本轮");
            return true;
        }

        _log("[调度] " + stage + "未确认游戏主界面，本轮跳过剩余任务");
        setStatus("主界面未确认，30 秒后重试");
        // 未知页面只观察时间窗口，不执行商船或盟战，避免把固定任务点击落到失败弹层上。
        waitWithTimeChecks(30, shouldStop, function() {
            observeTime();
            return false;
        });
        return true;
    }

    _log("总调度器已启动：锻造 → 种植 → 打捞资源 → 贸易港口 → 展区 → 情报 → 挂机奖励；限时任务到点抢占");
    while (!shouldStop()) {
        if (pauseRoundWhenMainSceneUnknown("调度开始时")) continue;
        runDueTimedTasks();
        if (shouldStop()) break;
        if (pauseRoundWhenMainSceneUnknown("限时任务后")) continue;

        var lastCompletedTask = null;
        var tradePortResult = null;
        var gatherResult = null;
        var exhibitionResult = null;
        var intelligenceResult = null;
        var hangUpRewardResult = null;

        if (panel.taskEnabled.weapon && (!panel.weaponFridayOnly || isFriday(new Date()))) {
            setStatus("执行锻造");
            if (weapon.runOnce(imgs, panel.weaponType, panel.weaponLevel, _log, shouldStop)) onAction("weapon");
            lastCompletedTask = "weapon";
            if (pauseRoundWhenMainSceneUnknown("锻造后")) continue;
            runDueTimedTasks();
            if (shouldStop()) break;
        } else if (panel.taskEnabled.weapon && panel.weaponFridayOnly) {
            // 周五限定不关闭任务开关，日期变化后调度器会自动恢复锻造。
            setStatus("锻造等待周五");
        }

        if (panel.taskEnabled.food) {
            setStatus("定位种植区");
            // 商船和盟战会切换主界面，因此每个种植原子动作先重新定位农田。
            if (!navigate.autoLocate(imgs, _log)) {
                _log("自动定位失败，本轮跳过种植");
            } else if (plantFood.runOnce(imgs, panel.selectedFood, shouldStop, _log, function(newFood) {
                panel.selectedFood = newFood;
                panel.updateFoodLabel(newFood);
                panel._saveConfig();
            })) onAction("food");
            lastCompletedTask = "food";
            if (pauseRoundWhenMainSceneUnknown("种植后")) continue;
            runDueTimedTasks();
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.gather) {
            setStatus("检查打捞资源");
            gatherResult = resourceGather.runOnce(imgs, {
                intervalMinutes: panel.gatherIntervalMinutes,
                thresholdPercent: panel.gatherThresholdPercent,
                durationMinutes: panel.gatherDurationMinutes,
                lastCompletedAt: gatherLastCompletedAt
            }, shouldStop, _log);
            if (gatherResult === "completed") {
                // 仅在模块确认完整检查和所有计划采集均已结束后刷新本会话的冷却起点。
                gatherLastCompletedAt = Date.now();
            }
            if (gatherResult === "unconfirmed") {
                // 设施菜单可能保留基地/世界图标，常规主界面守卫无法识别；本轮必须在这里截断，避免后续任务点击到菜单上。
                _log("[调度] 打捞资源入口未确认，本轮跳过剩余任务");
                setStatus("打捞资源入口未确认，30 秒后重试");
                waitWithTimeChecks(30, shouldStop, function() {
                    observeTime();
                    return false;
                });
                continue;
            }
            if (pauseRoundWhenMainSceneUnknown("打捞资源后")) continue;
            runDueTimedTasks();
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.tradePort) {
            setStatus("检查贸易港口");
            tradePortResult = tradePort.runOnce(
                imgs,
                panel.freq.tradePort,
                panel.tradePortLastCompletedAt,
                _log,
                shouldStop,
                function(completedAt) {
                    // 只有模块确认点击港口 X 后才保存时间，重启脚本也不会绕过完成后间隔。
                    panel.tradePortLastCompletedAt = completedAt;
                    panel._saveConfig();
                }
            );
            // 冷却期返回 completed=false，因此不会覆盖本轮已执行的锻造或种植等待节奏。
            if (tradePortResult.completed) lastCompletedTask = "tradePort";
            if (pauseRoundWhenMainSceneUnknown("贸易港口后")) continue;
            runDueTimedTasks();
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.exhibition) {
            setStatus("检查展区");
            exhibitionResult = exhibition.runOnce(
                imgs,
                {
                    intervalMinutes: panel.freq.exhibition,
                    lastCompletedAt: panel.exhibitionLastCompletedAt,
                    durationHours: panel.exhibitionDurationHours,
                    sites: panel.exhibitionSites
                },
                shouldStop,
                _log,
                function(completedAt) {
                    // 只有展区模块确认两次返回并识别到主界面后才写冷却，保证重启后不会跳过中断流程。
                    panel.exhibitionLastCompletedAt = completedAt;
                    panel._saveConfig();
                }
            );
            if (exhibitionResult.status === "completed") {
                lastCompletedTask = "exhibition";
                onAction("exhibition");
            }
            if (pauseRoundWhenMainSceneUnknown("展区后")) {
                // 全局恢复已回到主界面时仍须保留失败退避，不能直接跳过到下一轮再次进入展区。
                if (exhibitionResult.status === "failed" && navigate.detectScene(imgs) !== "unknown") {
                    waitAfterFailedExhibition(exhibitionResult);
                }
                continue;
            }
            runDueTimedTasks();
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.intelligence) {
            setStatus("检查情报");
            intelligenceResult = intelligence.runOnce(
                imgs,
                {
                    intervalHours: panel.freq.intelligence,
                    lastCompletedAt: panel.intelligenceLastCompletedAt
                },
                shouldStop,
                _log,
                function(completedAt) {
                    // 仅当情报模块确认奖励关闭、气泡完成并安全回到基地后，才持久化跨重启冷却时间。
                    panel.intelligenceLastCompletedAt = completedAt;
                    panel._saveConfig();
                }
            );
            if (intelligenceResult.status === "completed") {
                lastCompletedTask = "intelligence";
            }
            if (pauseRoundWhenMainSceneUnknown("情报后")) continue;
            runDueTimedTasks();
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.hangUpReward) {
            setStatus("检查挂机奖励");
            hangUpRewardResult = hangUpReward.runOnce(
                imgs,
                {
                    intervalHours: panel.freq.hangUpReward,
                    lastCompletedAt: hangUpRewardLastCompletedAt
                },
                shouldStop,
                _log
            );
            if (hangUpRewardResult.status === "completed") {
                // 模块只有确认主界面后才返回 completed，因此此时间可作为本会话冷却起点。
                hangUpRewardLastCompletedAt = Date.now();
                lastCompletedTask = "hangUpReward";
            }
            if (pauseRoundWhenMainSceneUnknown("挂机奖励后")) continue;
            runDueTimedTasks();
            if (shouldStop()) break;
        }

        if (lastCompletedTask) {
            var interval = getRegularWaitSeconds(lastCompletedTask);
            setStatus("本轮完成，等待 " + interval + " 秒");
            // 按用户确认的规则，整轮等待取最后一个实际执行普通任务的间隔。
            waitWithTimeChecks(interval, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.tradePort && tradePortResult && isOnlyTaskEnabled("tradePort")) {
            // 仅启用贸易港口时，直接等待模块计算出的冷却剩余时间，避免每秒空转识图。
            setStatus("贸易港口等待 " + tradePortResult.waitSeconds + " 秒");
            waitWithTimeChecks(tradePortResult.waitSeconds, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.exhibition && exhibitionResult && exhibitionResult.status === "cooldown" && isOnlyTaskEnabled("exhibition")) {
            // 仅启用展区时使用模块精确计算的剩余分钟冷却，避免每秒重新进入博物馆。
            setStatus("展区冷却中，等待 " + exhibitionResult.waitSeconds + " 秒");
            waitWithTimeChecks(exhibitionResult.waitSeconds, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.exhibition && exhibitionResult && exhibitionResult.status === "failed") {
            // 识图、OCR 或安全退出无法确认时不写冷却；模块给出的退避避免异常画面连续触屏。
            waitAfterFailedExhibition(exhibitionResult);
        } else if (panel.taskEnabled.intelligence && intelligenceResult && intelligenceResult.status === "cooldown" && isOnlyTaskEnabled("intelligence")) {
            // 仅运行情报时直接使用精确剩余冷却；与其他任务并行时本轮仅跳过情报，让其他任务决定节奏。
            setStatus("情报冷却中，等待 " + intelligenceResult.waitSeconds + " 秒");
            waitWithTimeChecks(intelligenceResult.waitSeconds, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.intelligence && intelligenceResult && intelligenceResult.status === "failed" && isOnlyTaskEnabled("intelligence")) {
            // 页面或状态不明时不写冷却；独立运行时短暂退避，避免连续误触未知界面。
            setStatus("情报本轮失败，30 秒后重试");
            waitWithTimeChecks(30, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.hangUpReward && hangUpRewardResult && hangUpRewardResult.status === "cooldown" && isOnlyTaskEnabled("hangUpReward")) {
            // 仅启用挂机奖励时按模块剩余时间休眠，避免冷却期不断重复识图。
            setStatus("挂机奖励冷却中，等待 " + hangUpRewardResult.waitSeconds + " 秒");
            waitWithTimeChecks(hangUpRewardResult.waitSeconds, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.hangUpReward && hangUpRewardResult && hangUpRewardResult.status === "failed") {
            // 奖励页任一状态无法确认都不写本会话完成时间，仅短暂退避后再尝试。
            setStatus("挂机奖励本轮失败，30 秒后重试");
            waitWithTimeChecks(30, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.gather && gatherResult === "cooldown" && isOnlyTaskEnabled("gather")) {
            // 只有打捞资源作为唯一普通任务时才按自己的冷却等待，不影响锻造或种植的既有节奏。
            var gatherWaitSeconds = getGatherCooldownSeconds();
            setStatus("打捞资源冷却中，等待 " + gatherWaitSeconds + " 秒");
            waitWithTimeChecks(gatherWaitSeconds, shouldStop, runDueTimedTasks);
        } else if (panel.taskEnabled.gather && gatherResult === "failed") {
            // 失败不写入冷却，但只启用该任务时保留短暂退避，避免 OCR/模板异常时每秒重复触屏。
            setStatus("打捞资源本轮失败，30 秒后重试");
            waitWithTimeChecks(30, shouldStop, runDueTimedTasks);
        } else {
            setStatus("等待已开启的限时任务");
            waitWithTimeChecks(1, shouldStop, runDueTimedTasks);
        }
    }
    setStatus("已停止");
};

module.exports = scheduler;
