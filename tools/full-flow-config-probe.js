/**
 * 读取 AutoJs6 的水世界调度配置并写入设备侧测试备份。
 * 该探针不修改配置、不截图、不触控游戏，用于完整流程验收前保存可恢复的原始状态。
 */
(function() {
    var backupPath = "/sdcard/水世界运行日志/fkssj-full-flow-config-backup.json";
    var store = storages.create("fkssj_config");
    var payload = {
        capturedAt: Date.now(),
        config: store.get("config") || null
    };

    // 使用共享存储同一应用上下文导出配置，避免通过 ADB 直接读取私有目录或猜测面板开关。
    files.write(backupPath, JSON.stringify(payload, null, 2));
    log("[完整流程探针] 已备份调度配置到 " + backupPath);
    exit();
})();
