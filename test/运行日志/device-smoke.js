/**
 * 在真实 AutoJs6 运行时验证持久化日志写入；不启动游戏、不发起点击，也不请求截图权限。
 * 该脚本只在需要验收日志链路时手动通过 RunIntentActivity 运行。
 */
global.$ui = {
    // uiHelpers 同时服务于主界面与后台线程；烟测用同步空实现保留其原有调用契约。
    run: function(action) { action(); },
    post: function(action) { action(); },
    txt_log: { setText: function() {} },
    log_scroll: { fullScroll: function() {} }
};

var uiHelpers = require("../../modules/uiHelpers.js");

// 该可识别消息会被拉取脚本写入 AI 摘要，用于证明真实设备而非 Node 桩已完成写盘。
uiHelpers.appendLog("[设备烟测] 持久化运行日志写入成功");
