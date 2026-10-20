// ocr-rows-probe.js — 仅在“资源储量”弹窗已打开时运行，验证七行库存 OCR 区域，不执行任何点击。

var rows = [
    [570, 570, 230, 65], [570, 740, 230, 65], [570, 910, 230, 65], [570, 1080, 230, 65],
    [570, 1250, 230, 65], [570, 1420, 230, 65], [570, 1590, 230, 65]
];
var resultPath = "/sdcard/脚本/水世界/test/打捞资源/ocr-rows-probe-result.txt";
var lines = [];

try {
    // 探针使用当前游戏画面，只读取同一张截图，避免测试过程改变资源或地图状态。
    requestScreenCapture(false);
    sleep(1000);
    var screen = captureScreen();
    try {
        for (var i = 0; i < rows.length; i++) {
            var results = ocr.mlkit.detect(screen, rows[i]);
            lines.push(JSON.stringify(results.map(function(item) { return item.label; })));
        }
    } finally {
        screen.recycle();
    }
} catch (e) {
    lines.push("ERROR: " + e.message);
}

files.write(resultPath, lines.join("\n"));
toast("打捞资源 OCR 探针完成");
