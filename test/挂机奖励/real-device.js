// real-device.js — 在目标 MuMu 上手动执行一次挂机奖励流程并将最终状态写入 AutoJs 日志

/**
 * 从设备端项目目录读取本任务模板。使用绝对路径避免单独运行测试脚本时工作目录不同。
 * @returns {Object} 挂机奖励模块所需的模板资源。
 */
function loadHangUpRewardImages() {
    var basePath = "/sdcard/脚本/水世界/img/挂机奖励/";
    return {
        hangUpRewardEntry: images.read(basePath + "闯关入口.png"),
        hangUpRewardTv: images.read(basePath + "电视入口.png"),
        hangUpRewardTitle: images.read(basePath + "标题.png"),
        hangUpRewardClaim: images.read(basePath + "领取奖励.png"),
        hangUpRewardCongrats: images.read(basePath + "恭喜获得.png"),
        rewardDismissHint: images.read("/sdcard/脚本/水世界/img/通用/点击空白区域关闭.png"),
        hangUpRewardBack: images.read(basePath + "返回.png")
    };
}

// 与主程序保持一致地异步申请录屏权限，避免从外部 Intent 启动测试时同步申请提前返回。
requestScreenCaptureAsync(false);
// Android 15 需先选中被共享的游戏；测试脚本在识图前留出完整授权窗口，避免应用选择器尚未回调就误报图片权限失败。
sleep(15000);
// 本测试刻意以 1 小时配置、零完成时间调用，验证真实游戏状态下完整领取和安全返回。
var hangUpReward = require("../../modules/hangUpReward.js");
var result = hangUpReward.runOnce(loadHangUpRewardImages(), {
    intervalHours: 1,
    lastCompletedAt: 0
}, function() { return false; }, function(message) { log(message); });
log("[挂机奖励实测] 结果=" + JSON.stringify(result));
toast("挂机奖励实测：" + result.status);
