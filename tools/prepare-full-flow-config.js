/**
 * 为一次完整调度验收临时覆盖冷却与任务开关。
 * 原始配置已由 full-flow-config-probe.js 写入设备侧备份；本脚本不执行任何游戏触控。
 */
(function() {
    var backupPath = "/sdcard/水世界运行日志/fkssj-full-flow-config-backup.json";
    var contextPath = "/sdcard/水世界运行日志/fkssj-full-flow-test-context.json";
    var store = storages.create("fkssj_config");
    var backup = JSON.parse(files.read(backupPath));
    var config = backup.config || {};
    var now = Date.now();

    // 本次只验证普通任务链路；商船与盟战受时间窗口约束，保持关闭以免抢占本轮流程。
    config.taskEnabled = config.taskEnabled || {};
    config.taskEnabled.food = true;
    config.taskEnabled.weapon = false;
    config.taskEnabled.ship = false;
    config.taskEnabled.war = false;
    config.taskEnabled.tradePort = true;
    config.taskEnabled.gather = true;
    config.taskEnabled.exhibition = true;
    config.taskEnabled.intelligence = true;
    // 挂机奖励已收敛为资源收集组的第一项，不再写入旧顶层任务开关。
    delete config.taskEnabled.hangUpReward;
    config.taskEnabled.resourceCollection = true;

    // 已持久化的完成时间全部置零，使每个普通任务本轮都至少进入一次真实流程。
    config.tradePortLastCompletedAt = 0;
    config.exhibitionLastCompletedAt = 0;
    config.intelligenceLastCompletedAt = 0;
    config.gatherIntervalMinutes = 1;
    config.gatherThresholdPercent = 100;
    config.gatherDurationMinutes = 1;
    config.freq = config.freq || {};
    config.freq.food = 1;
    config.freq.tradePort = 1;
    config.freq.exhibition = 1;
    config.freq.intelligence = 1;
    config.freq.hangUpReward = 1;
    config.freq.resourceExperience = 1;
    config.freq.resourceFactory = 1;
    config.resourceCollection = { hangUpReward: true, experience: true, factory: true };

    store.put("config", config);
    files.write(contextPath, JSON.stringify({ preparedAt: now, config: config }, null, 2));
    log("[完整流程准备] 已写入临时强制执行配置");
    exit();
})();
