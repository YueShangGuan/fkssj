/**
 * 恢复完整流程验收前的面板参数，同时保留测试中真实完成任务的新完成时间与统计。
 * 未达到本次测试开始时间的完成记录视为测试未成功，恢复其原始冷却，避免重复执行。
 */
(function() {
    var backupPath = "/sdcard/水世界运行日志/fkssj-full-flow-config-backup.json";
    var contextPath = "/sdcard/水世界运行日志/fkssj-full-flow-test-context.json";
    var restorePath = "/sdcard/水世界运行日志/fkssj-full-flow-config-restored.json";
    var store = storages.create("fkssj_config");
    var backup = JSON.parse(files.read(backupPath));
    var context = JSON.parse(files.read(contextPath));
    var original = backup.config || {};
    var current = store.get("config") || {};
    var testStartedAt = context.preparedAt;

    /**
     * 保留本次测试之后写入的完成时间；若任务未成功完成则恢复测试前的冷却记录。
     * @param {string} key 持久化完成时间字段。
     * @returns {number} 恢复后应保存的完成时间。
     */
    function completionTimeFor(key) {
        return typeof current[key] === "number" && current[key] >= testStartedAt
            ? current[key]
            : (typeof original[key] === "number" ? original[key] : 0);
    }

    // 先以完整原配置为基准恢复用户偏好，再覆盖真实完成记录和运行统计。
    original.tradePortLastCompletedAt = completionTimeFor("tradePortLastCompletedAt");
    original.exhibitionLastCompletedAt = completionTimeFor("exhibitionLastCompletedAt");
    original.intelligenceLastCompletedAt = completionTimeFor("intelligenceLastCompletedAt");
    if (current.stats) original.stats = current.stats;
    if (current.ballPos) original.ballPos = current.ballPos;

    store.put("config", original);
    files.write(restorePath, JSON.stringify({ restoredAt: Date.now(), config: original }, null, 2));
    log("[完整流程恢复] 已恢复面板参数并保留本次有效完成时间");
    exit();
})();
