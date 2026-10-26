// scheduler.js — 总调度器：协调普通任务与限时任务的抢占顺序

var scheduler = {};
// 普通任务完成或冷却返回后仅短暂停顿；各任务自己的冷却由模块内部决定，不能阻塞整轮检查。
var TASK_TURN_INTERVAL_SECONDS = 2;

/**
 * 在可中断的短暂等待期间持续观察整点与盟战窗口，避免任务轮转漏掉限时任务。
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
 * 20:00 属于盟战抢占时段，19:59 也不得为该整点提前打开商船活动弹窗。
 */
function isShipHour(now) {
    return now.getHours() >= 8 && now.getHours() < 22 && now.getHours() !== 20;
}

/**
 * 读取商船提前准备分钟数；面板未提供值时采用产品默认值 1 分钟。
 * @param {Object} panel 悬浮面板的启动配置快照。
 * @returns {number} 大于 0 的整分钟准备时长。
 */
function getShipPrepareMinutes(panel) {
    var minutes = Number(panel && panel.shipPrepareMinutes);
    return isFinite(minutes) && minutes > 0 && Math.floor(minutes) === minutes ? minutes : 1;
}

/**
 * 读取商船夺回重试分钟数；面板未提供值时采用产品默认值 1 分钟。
 * @param {Object} panel 悬浮面板的启动配置快照。
 * @returns {number} 大于 0 的整分钟重试间隔。
 */
function getShipRetryMinutes(panel) {
    var minutes = Number(panel && panel.shipRetryMinutes);
    return isFinite(minutes) && minutes > 0 && Math.floor(minutes) === minutes ? minutes : 1;
}

/**
 * 返回下一个允许执行的商船整点。整点本身必须在既有活动窗口内，避免在收档后提前进入无效弹窗。
 * @param {Date} now 当前设备本地时间。
 * @returns {Date|null} 下一个商船整点；活动窗口外返回 null。
 */
function getNextShipTargetTime(now) {
    var target = new Date(now.getTime());
    target.setMinutes(0, 0, 0);
    target.setHours(target.getHours() + 1);
    return isShipHour(target) ? target : null;
}

/**
 * 使用设备本地时间判断周五，避免宿主机时区影响锻造限定。
 */
function isFriday(now) {
    return now.getDay() === 5;
}

/**
 * 运行总调度器。普通任务固定按锻造、种植、打捞资源、贸易港口、居民需求、展区、情报、资源收集执行；限时任务在安全动作边界抢占。
 * @param {Object} options 任务模块、配置、日志与状态回调。
 */
scheduler.run = function(options) {
    var imgs = options.images;
    var panel = options.panel;
    var shouldStop = options.shouldStop;
    var _log = options.log || function(msg) { log(msg); };
    var setStatus = options.setStatus || function() {};
    var onAction = options.onAction || function() {};
    var onResidentDemandStateChange = options.onResidentDemandStateChange || function() {};
    var weapon = require("./weapon.js");
    var plantFood = require("./plantFood.js");
    var merchantShip = require("./merchantShip.js");
    var war = require("./war.js");
    var navigate = require("./navigate.js");
    var gameHelper = require("./gameHelper.js");
    var tradePort = require("./tradePort.js");
    var resourceGather = require("./resourceGather.js");
    var residentDemand = require("./residentDemand.js");
    var exhibition = require("./exhibition.js");
    var intelligence = require("./intelligence.js");
    var hangUpReward = require("./hangUpReward.js");
    var resourceCollection = require("./resourceCollection.js");
    var observedHour = hourKey(new Date());
    // 商船只在准备期确认活动弹窗后才可在整点出征，启动时不补派错过准备期的任务。
    var pendingShip = false;
    var shipPrepareMinutes = getShipPrepareMinutes(panel);
    var shipRetryMinutes = getShipRetryMinutes(panel);
    // 保留到目标整点才可消费的活动弹窗上下文；它存在时所有普通任务都必须暂停，避免触碰遮罩层后的界面。
    var shipPreparation = null;
    var shipPreparationTargetAt = 0;
    // 夺回重试只属于当前整点和当前调度会话；重启、跨整点或盟战窗口均不继续旧时段。
    var shipRetryPeriodKey = "";
    var shipRetryDueAt = 0;
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
    // 锻造、种植的秒级冷却只在当前调度会话有效；模块收到时间戳后会在冷却期静默返回。
    var weaponLastCompletedAt = 0;
    var foodLastCompletedAt = 0;
    // 打捞资源冷却只属于本次总调度进程；停止或重启后不从持久化配置恢复。
    var gatherLastCompletedAt = 0;
    // 挂机奖励与打捞资源一样只在本次调度会话中冷却，重启脚本后允许重新领取。
    var hangUpRewardLastCompletedAt = 0;
    // 主城经验和工厂物资也只记录本次会话的完成时间，脚本重启后会重新检查现场气泡。
    var resourceExperienceLastCompletedAt = 0;
    var resourceFactoryLastCompletedAt = 0;

    /**
     * 清除当前商船夺回重试的会话状态。
     * @param {string} [reason] 需要写入调度日志的结束原因。
     */
    function clearShipRetry(reason) {
        if (shipRetryDueAt <= 0) return;
        shipRetryPeriodKey = "";
        shipRetryDueAt = 0;
        if (reason) _log("[商船] " + reason);
    }

    /**
     * 处理一次商船尝试的结果，并在货轮仍存在时安排本整点的下一次夺回。
     * @param {"dispatched"|"empty"|"noIdleFleet"|"failed"} result 商船模块的本次结果。
     * @param {string} periodKey 本次尝试所属的整点键。
     */
    function recordShipAttemptResult(result, periodKey) {
        var now = new Date();
        if (result === "empty") {
            clearShipRetry();
            setStatus("本时段货轮已结束，等待下一个有效整点");
            _log("[商船] 货轮不在列表，本时段结束");
            return;
        }

        // 尝试过程可能跨入盟战或下一整点；此时不能把旧时段重试带入新的限时任务。
        if (isWarWindow(now) || !isShipHour(now) || hourKey(now) !== periodKey) {
            clearShipRetry("已离开本时段，取消夺回重试");
            return;
        }

        shipRetryPeriodKey = periodKey;
        shipRetryDueAt = now.getTime() + shipRetryMinutes * 60 * 1000;
        if (result === "dispatched") {
            setStatus("商船已出征，" + shipRetryMinutes + " 分钟后尝试夺回");
            _log("[商船] 已出征，" + shipRetryMinutes + " 分钟后重新检查货轮");
        } else if (result === "noIdleFleet") {
            setStatus("无空闲舰队，" + shipRetryMinutes + " 分钟后重试商船");
            _log("[商船] 无空闲舰队，保留本时段夺回重试");
        } else {
            setStatus("商船本轮未确认，" + shipRetryMinutes + " 分钟后重试");
            _log("[商船] 本轮路径未确认，保留本时段夺回重试");
        }
    }

    /**
     * 在重试时间到达时重新进入商船活动并执行一轮完整的夺回流程。
     * 未到期时直接返回 false，让总调度器继续普通任务。
     * @param {Date} now 当前设备本地时间。
     * @returns {boolean} 本次检查是否实际执行了商船重试。
     */
    function runShipRetryIfDue(now) {
        if (shipRetryDueAt <= 0) return false;
        if (shipRetryPeriodKey !== hourKey(now) || isWarWindow(now) || !isShipHour(now)) {
            clearShipRetry("已跨整点或进入盟战窗口，取消夺回重试");
            return false;
        }
        if (now.getTime() < shipRetryDueAt) return false;

        setStatus("商船夺回重试");
        _log("[商船] 夺回重试时间到，重新进入活动并检查货轮");
        var result = merchantShip.retryOnce(imgs, _log, shouldStop);
        if (result === "dispatched") onAction("ship");
        recordShipAttemptResult(result, shipRetryPeriodKey);
        return true;
    }

    /**
     * 将跨过的整点标记为待处理。盟战优先时保留该标记，活动结束后只补执行一次商船。
     */
    function observeTime() {
        var now = new Date();
        var currentHour = hourKey(now);
        if (currentHour !== observedHour) {
            if (shipRetryPeriodKey && shipRetryPeriodKey !== currentHour) {
                clearShipRetry("已跨整点，结束上一时段夺回重试");
            }
            observedHour = currentHour;
            if (panel.taskEnabled.ship && isShipHour(now)) {
                pendingShip = true;
                _log("[商船] 检测到新整点，等待安全动作边界执行");
            }
        }
    }

    /**
     * 在目标整点前打开并确认商船活动弹窗。准备状态一旦建立，调度器只等待整点，
     * 这样不会再启动新的普通任务，也不会让盟战覆盖已经打开的活动弹窗。
     * @param {Date} now 当前设备本地时间。
     * @returns {boolean} 已处于准备窗口或刚执行准备时返回 true。
     */
    function prepareShipIfDue(now) {
        if (!panel.taskEnabled.ship) return false;
        // 盟战持续抢占到 21:00，期间不能为 21:00 商船打开活动弹窗，否则会把当前盟战带离目标界面。
        if (isWarWindow(now)) return false;
        if (shipPreparationTargetAt > 0) return true;
        var target = getNextShipTargetTime(now);
        if (!target || now.getTime() < target.getTime() - shipPrepareMinutes * 60 * 1000) return false;

        shipPreparationTargetAt = target.getTime();
        setStatus("商船提前准备");
        _log("[商船] 距 " + target.getHours() + ":00 还有 " + shipPrepareMinutes + " 分钟，停止其他任务并进入活动弹窗");
        shipPreparation = merchantShip.prepare(imgs, _log, shouldStop);
        if (shipPreparation) {
            setStatus("商船准备完成，等待 " + target.getHours() + ":00");
            _log("[商船] 已进入活动弹窗，等待整点点击货轮列表");
        } else {
            // 准备失败后仍封锁当前分钟，不能退回普通任务并在即将到点时误触其他页面。
            setStatus("商船准备失败，本整点跳过");
            _log("[商船] 未能进入活动弹窗，本整点不会回退为旧的直达流程");
        }
        return true;
    }

    /**
     * 在盟战窗口持续执行盟战动作，普通轮次会保持暂停直到窗口结束或用户停止。
     */
    function runWarWindow() {
        while (!shouldStop() && panel.taskEnabled.war && isWarWindow(new Date())) {
            if (prepareShipIfDue(new Date())) return true;
            setStatus("盟战抢占中（20:00-21:00）");
            // 使用启动时的副本，防止运行中的外部写入改变某支舰队的模式、目标或钻石开关。
            var handled = war.runOnce(imgs, warFleetPlans, _log, warClaimReward);
            if (handled) onAction("war");
            // 商船准备时间一到必须在当前盟战动作结束后立刻让出调度权，不能继续等完下一段轮询间隔。
            if (waitWithTimeChecks(panel.freq.war, shouldStop, function() {
                observeTime();
                return prepareShipIfDue(new Date());
            })) return true;
        }
        return false;
    }

    /**
     * 执行已到点的限时任务；已进入准备态的商船在整点优先，其他时段仍由盟战抢占。
     */
    function runDueTimedTasks() {
        var didRunTimedTask = false;
        observeTime();
        if (!shouldStop() && panel.taskEnabled.ship && pendingShip) {
            var shipPeriodKey = hourKey(new Date());
            var preparedShip = shipPreparation;
            pendingShip = false;
            shipPreparation = null;
            shipPreparationTargetAt = 0;
            if (!preparedShip) {
                // 未在准备期确认活动弹窗时不再补走图标直达流程，避免错过首点后点击到其他世界控件。
                setStatus("商船准备未完成，本整点跳过");
                _log("[商船] 未能确认活动弹窗，本整点跳过");
                return true;
            }
            setStatus("整点已到，点击货轮列表");
            _log("[商船] 整点已到，立即点击货轮列表并开始出征");
            var shipResult = merchantShip.startPrepared(imgs, preparedShip, _log, shouldStop);
            if (shipResult === "dispatched") onAction("ship");
            recordShipAttemptResult(shipResult, shipPeriodKey);
            // 商船入口已在整点优先消费；下一轮才继续检查盟战或普通任务。
            return true;
        }
        if (prepareShipIfDue(new Date())) return true;
        if (runShipRetryIfDue(new Date())) return true;
        if (panel.taskEnabled.war && isWarWindow(new Date())) {
            if (runWarWindow()) return true;
            didRunTimedTask = true;
            // 城战可能跨过新的整点；先更新观察时间，再消费已有待执行商船，避免补执行后重复触发。
            observeTime();
        }
        return didRunTimedTask;
    }

    /**
     * 在商船活动弹窗已打开时以 200ms 粒度等待整点。该短窗口内不运行普通任务，
     * 用较细轮询缩短货轮列表按钮从刷新到点击之间的延迟。
     */
    function waitForPreparedShipTick() {
        for (var i = 0; i < 5 && !shouldStop() && shipPreparationTargetAt > 0; i++) {
            observeTime();
            if (pendingShip) return;
            sleep(200);
        }
    }

    /**
     * 在每个任务边界确认仍处于基地或世界主界面。
     * 任务失败后保留在未知弹层时，继续运行后续模块会把安全失败放大成一串无效告警。
     *
     * @param {string} stage 触发确认的任务边界名称。
     * @returns {boolean} 页面未能恢复且已进入无触控退避时返回 true；恢复成功时返回 false 并继续本轮后续任务。
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
            // 当前失败动作的临时状态已在模块内结束，恢复到主界面后可安全继续尚未执行的任务，无需重跑本轮前序任务。
            _log("[调度] " + stage + "已恢复主界面，继续本轮后续任务");
            setStatus("已回到主界面，继续本轮后续任务");
            return false;
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

    /**
     * 在两个普通任务检查之间保留可中断的短间隔。
     * 任务的分钟级或小时级冷却必须由各自模块快速返回，不能把整轮调度睡眠到下一次业务执行。
     * @returns {boolean} 等待时有已到点的限时任务抢占时返回 true。
     */
    function waitBeforeNextTask() {
        setStatus("本轮检查完成，" + TASK_TURN_INTERVAL_SECONDS + " 秒后继续");
        return waitWithTimeChecks(TASK_TURN_INTERVAL_SECONDS, shouldStop, runDueTimedTasks);
    }

    _log("总调度器已启动：锻造 → 种植 → 打捞资源 → 贸易港口 → 居民需求 → 展区 → 情报 → 资源收集；商船提前准备后整点抢占并按设置夺回重试");
    while (!shouldStop()) {
        if (shipPreparationTargetAt > 0) {
            // 活动弹窗会让常规场景识别结果变为 unknown；准备期间只能计时，不能触发全局回主页或其他任务。
            runDueTimedTasks();
            if (shouldStop()) break;
            if (shipPreparationTargetAt > 0) {
                if (shipPreparation) setStatus("商船准备完成，等待整点");
                waitForPreparedShipTick();
            }
            continue;
        }
        if (pauseRoundWhenMainSceneUnknown("调度开始时")) continue;
        if (runDueTimedTasks()) continue;
        if (shouldStop()) break;
        if (pauseRoundWhenMainSceneUnknown("限时任务后")) continue;

        var gatherResult = null;
        var exhibitionResult = null;
        var intelligenceResult = null;
        var hangUpRewardResult = null;
        var resourceCollectionResult = null;

        if (panel.taskEnabled.weapon && (!panel.weaponFridayOnly || isFriday(new Date()))) {
            setStatus("执行锻造");
            if (weapon.runOnce(imgs, {
                type: panel.weaponType,
                level: panel.weaponLevel,
                intervalSeconds: panel.freq.weapon,
                lastCompletedAt: weaponLastCompletedAt
            }, _log, shouldStop)) {
                // 仅在锻造模块确认已返回主界面后写入会话内完成时间，冷却判断仍由模块自身完成。
                weaponLastCompletedAt = Date.now();
                onAction("weapon");
            }
            if (pauseRoundWhenMainSceneUnknown("锻造后")) continue;
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
            if (waitBeforeNextTask()) continue;
            if (shouldStop()) break;
        } else if (panel.taskEnabled.weapon && panel.weaponFridayOnly) {
            // 周五限定不关闭任务开关，日期变化后调度器会自动恢复锻造。
            setStatus("锻造等待周五");
        }

        if (panel.taskEnabled.food) {
            setStatus("检查种植");
            if (plantFood.runOnce(imgs, {
                foodType: panel.selectedFood,
                intervalSeconds: panel.freq.food,
                lastCompletedAt: foodLastCompletedAt
            }, shouldStop, _log, function(newFood) {
                panel.selectedFood = newFood;
                panel.updateFoodLabel(newFood);
                panel._saveConfig();
            })) {
                // 仅在种植模块实际完成收割或播种后刷新会话冷却，冷却期由模块直接静默返回。
                foodLastCompletedAt = Date.now();
                onAction("food");
            }
            if (pauseRoundWhenMainSceneUnknown("种植后")) continue;
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
            if (waitBeforeNextTask()) continue;
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
                // 设施菜单也可能显示基地/世界图标，不能仅凭常规场景守卫就认定已回主页并执行后续任务。
                // 只有资源模块已尝试返回且仍未确认主界面时才到这里，本轮不能把后续点击落在残留菜单上。
                _log("[调度] 打捞资源入口未确认，本轮跳过剩余任务");
                setStatus("打捞资源入口未确认，30 秒后重试");
                waitWithTimeChecks(30, shouldStop, function() {
                    observeTime();
                    return false;
                });
                continue;
            }
            if (pauseRoundWhenMainSceneUnknown("打捞资源后")) continue;
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
            if (waitBeforeNextTask()) continue;
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.tradePort) {
            setStatus("检查贸易港口");
            tradePort.runOnce(
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
            if (pauseRoundWhenMainSceneUnknown("贸易港口后")) continue;
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
            if (waitBeforeNextTask()) continue;
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.residentDemand) {
            // 完成状态按日期实时比较；每次进入任务段都刷新展示，使跨零点后即使脚本持续运行也会先显示“今日未完成”。
            onResidentDemandStateChange();
            setStatus("检查居民需求");
            residentDemand.runOnce(
                imgs,
                {
                    intervalMinutes: panel.freq.residentDemand,
                    lastCheckedAt: panel.residentDemandLastCheckedAt,
                    completedDate: panel.residentDemandCompletedDate,
                    // 面板在运行期间冻结奖励与完成日期字段，调度仅透传当前快照，不在此处推断星期、日期或默认阈值。
                    experienceThreshold: panel.residentDemandExperienceThreshold,
                    thursdayGoldEnabled: panel.residentDemandThursdayGoldEnabled,
                    goldThreshold: panel.residentDemandGoldThreshold
                },
                shouldStop,
                _log,
                function(state) {
                    // 模块只会在确认返回基地后回调；在此单一边界同步两类时间戳并保存一次。
                    if (panel.applyResidentDemandSafeCheck(state)) onResidentDemandStateChange();
                }
            );
            if (pauseRoundWhenMainSceneUnknown("居民需求后")) continue;
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
            if (waitBeforeNextTask()) continue;
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
            if (exhibitionResult.status === "completed") onAction("exhibition");
            if (pauseRoundWhenMainSceneUnknown("展区后")) {
                continue;
            }
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
            if (waitBeforeNextTask()) continue;
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
            if (pauseRoundWhenMainSceneUnknown("情报后")) continue;
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
            if (waitBeforeNextTask()) continue;
            if (shouldStop()) break;
        }

        if (panel.taskEnabled.resourceCollection) {
            setStatus("检查资源收集");
            if (panel.resourceCollection.hangUpReward) {
                // 第一项继续直接调用原领奖状态机，保证闯关入口、奖励关闭与返回基地的既有逻辑不变。
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
                }
                if (pauseRoundWhenMainSceneUnknown("资源收集 / 挂机奖励后")) continue;
                if (runDueTimedTasks()) continue;
                if (shouldStop()) break;
            }

            resourceCollectionResult = resourceCollection.runOnce(
                imgs,
                {
                    experience: {
                        enabled: panel.resourceCollection.experience,
                        intervalMinutes: panel.freq.resourceExperience,
                        lastCompletedAt: resourceExperienceLastCompletedAt
                    },
                    factory: {
                        enabled: panel.resourceCollection.factory,
                        intervalMinutes: panel.freq.resourceFactory,
                        lastCompletedAt: resourceFactoryLastCompletedAt
                    }
                },
                shouldStop,
                _log
            );
            if (resourceCollectionResult.experience.status === "completed") resourceExperienceLastCompletedAt = Date.now();
            if (resourceCollectionResult.factory.status === "completed") resourceFactoryLastCompletedAt = Date.now();
            if (pauseRoundWhenMainSceneUnknown("资源收集后")) continue;
            if (runDueTimedTasks()) continue;
            if (shouldStop()) break;
        }

        // 普通任务不再把自身冷却升级为整轮休眠；所有模块返回后很快进入下一轮，由模块决定是否执行业务。
        waitBeforeNextTask();
    }
    setStatus("已停止");
};

module.exports = scheduler;
