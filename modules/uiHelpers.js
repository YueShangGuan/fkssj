// uiHelpers.js — 日志、统计、导航、图标

var helpers = {};

var logEntries = [];
var RUNTIME_LOG_DIRECTORY = "/sdcard/水世界运行日志";
var RUNTIME_LOG_PREFIX = "fkssj-run-";
var MAX_RUNTIME_LOG_BYTES = 2 * 1024 * 1024;
var MAX_RUNTIME_LOG_SESSIONS = 8;
var runtimeSessionId = formatFileToken(new Date());
var runtimeLogSegment = 1;
var runtimeLogPath = null;
var errorScreenshotSequence = 0;
var warningScreenshotSequence = 0;
// 同一会话内同一缺位告警只保留首次现场，避免未知页面连续重试时生成大量重复截图。
var warningEvidenceMessages = {};
// UI 线程和调度线程共享模块变量；锁保证同一 JSONL 行、分段与清理操作不会并发交错。
var runtimeLogLock = threads.lock();

/**
 * 返回当前界面中保留的最近日志行，供现有 UI 读取而不暴露可写数组。
 *
 * @returns {string[]} 最近 30 条以内的界面日志。
 */
helpers.getLogEntries = function() { return logEntries; };

/**
 * 将时间格式化为界面日志使用的本地时分秒。
 *
 * @param {Date} d 要格式化的时间。
 * @returns {string} 形如 HH:mm:ss 的本地时间。
 */
helpers.timeStr = function(d) {
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
};

/**
 * 将时间格式化为界面中可读的日期与时间。
 *
 * @param {Date} d 要格式化的时间。
 * @returns {string} 形如 M/d HH:mm:ss 的本地时间。
 */
helpers.dateStr = function(d) {
    return (d.getMonth()+1) + '/' + d.getDate() + ' ' + helpers.timeStr(d);
};

/**
 * 生成可排序且可关联日志与异常截图的会话文件时间标识。
 *
 * @param {Date} date 生成日志时的本地时间。
 * @returns {string} 形如 yyyyMMdd-HHmmss-SSS 的文件名安全标识。
 */
function formatFileToken(date) {
    return String(date.getFullYear())
        + String(date.getMonth() + 1).padStart(2, "0")
        + String(date.getDate()).padStart(2, "0")
        + "-" + String(date.getHours()).padStart(2, "0")
        + String(date.getMinutes()).padStart(2, "0")
        + String(date.getSeconds()).padStart(2, "0")
        + "-" + String(date.getMilliseconds()).padStart(3, "0");
}

/**
 * 生成日志记录中的本地时间，避免 AI 仅凭无时区的界面文本猜测时间。
 *
 * @param {Date} date 生成日志时的本地时间。
 * @returns {string} 形如 yyyy-MM-dd HH:mm:ss.SSS 的本地时间。
 */
function formatRuntimeTimestamp(date) {
    return String(date.getFullYear())
        + "-" + String(date.getMonth() + 1).padStart(2, "0")
        + "-" + String(date.getDate()).padStart(2, "0")
        + " " + String(date.getHours()).padStart(2, "0")
        + ":" + String(date.getMinutes()).padStart(2, "0")
        + ":" + String(date.getSeconds()).padStart(2, "0")
        + "." + String(date.getMilliseconds()).padStart(3, "0");
}

/**
 * 返回当前会话指定分段的日志路径；日志与脚本代码分离，定向同步代码时不会覆盖诊断证据。
 *
 * @param {number} segment 从 1 开始的日志分段序号。
 * @returns {string} Android 外部存储中的 JSONL 日志路径。
 */
function buildRuntimeLogPath(segment) {
    return files.join(
        RUNTIME_LOG_DIRECTORY,
        RUNTIME_LOG_PREFIX + runtimeSessionId + "-" + String(segment).padStart(3, "0") + ".jsonl"
    );
}

/**
 * 取得文件当前字节数，用于在长时间调度时滚动日志，避免单一日志无限增长。
 *
 * @param {string} path 要检查的日志路径。
 * @returns {number} 文件大小；无法读取时返回 0，由后续追加操作决定是否可写。
 */
function getRuntimeLogSize(path) {
    try {
        return Number(new java.io.File(path).length());
    } catch (e) {
        return 0;
    }
}

/**
 * 按 UTF-8 计算文本字节数，保证中文业务日志也遵循 2 MiB 分段上限。
 *
 * @param {string} text 待写入的 JSONL 文本。
 * @returns {number} UTF-8 字节数；运行时无法计算时退回字符数估算。
 */
function getRuntimeLogByteLength(text) {
    try {
        return new java.lang.String(String(text)).getBytes("UTF-8").length;
    } catch (e) {
        return String(text).length;
    }
}

/**
 * 从已落盘的文件名中提取会话前缀，以会话为粒度清理旧诊断数据。
 *
 * @param {string} name 日志目录中的文件名。
 * @returns {string|null} 会话前缀；非本模块文件返回 null。
 */
function getRuntimeSessionPrefix(name) {
    var match = /^(fkssj-run-\d{8}-\d{6}-\d{3})-/.exec(name);
    return match ? match[1] : null;
}

/**
 * 仅删除本模块最旧的完整会话，既限制设备占用，也不会触及脚本目录或其他应用文件。
 */
function pruneRuntimeLogs() {
    try {
        var names = files.listDir(RUNTIME_LOG_DIRECTORY, function(name) {
            return name.indexOf(RUNTIME_LOG_PREFIX) === 0;
        }) || [];
        var sessions = {};
        var i;

        for (i = 0; i < names.length; i++) {
            var sessionPrefix = getRuntimeSessionPrefix(names[i]);
            if (sessionPrefix) sessions[sessionPrefix] = true;
        }

        var retained = Object.keys(sessions).sort();
        while (retained.length > MAX_RUNTIME_LOG_SESSIONS) {
            delete sessions[retained.shift()];
        }

        for (i = 0; i < names.length; i++) {
            var nameSessionPrefix = getRuntimeSessionPrefix(names[i]);
            if (nameSessionPrefix && !sessions[nameSessionPrefix]) {
                // 文件名和目录都受固定前缀约束，清理不会影响用户脚本或其他应用数据。
                files.remove(files.join(RUNTIME_LOG_DIRECTORY, names[i]));
            }
        }
    } catch (e) {
        // 日志清理失败不应阻断正在执行的游戏任务，后续写入仍会继续尝试。
    }
}

/**
 * 根据当前文件大小选择可追加的日志分段，并在达到上限后切换到下一个分段。
 *
 * @param {number} pendingBytes 即将追加的 JSONL 文本字节数估算。
 * @returns {string} 本次记录应写入的日志路径。
 */
function getWritableRuntimeLogPath(pendingBytes) {
    if (!runtimeLogPath) runtimeLogPath = buildRuntimeLogPath(runtimeLogSegment);

    // 空文件允许写入首条超长错误，后续记录才切分，保证错误上下文不会被截断。
    var currentSize = getRuntimeLogSize(runtimeLogPath);
    if (currentSize > 0 && currentSize + pendingBytes > MAX_RUNTIME_LOG_BYTES) {
        runtimeLogSegment += 1;
        runtimeLogPath = buildRuntimeLogPath(runtimeLogSegment);
    }
    return runtimeLogPath;
}

/**
 * 将结构化事件追加为一行 JSONL；失败时只降级为界面/AutoJs 日志，不能让诊断写盘反过来终止任务。
 *
 * @param {Object} record 已序列化前的运行事件。
 * @returns {string|null} 成功写入的路径；存储不可用时返回 null。
 */
function writeRuntimeRecord(record) {
    runtimeLogLock.lock();
    try {
        var serialized = JSON.stringify(record) + "\n";
        var path = getWritableRuntimeLogPath(getRuntimeLogByteLength(serialized));

        // ensureDir 接受文件路径，并只创建其父目录，不会产生额外占位文件。
        files.ensureDir(path);
        files.append(path, serialized, "utf-8");
        pruneRuntimeLogs();
        return path;
    } catch (e) {
        try { log("持久化运行日志失败: " + e); } catch (ignored) {}
        return null;
    } finally {
        runtimeLogLock.unlock();
    }
}

/**
 * 将一条已格式化日志同时更新到原有界面缓存；界面异常不能影响后台调度线程。
 *
 * @param {string} line 供用户阅读的单行日志。
 */
function appendToLogPanel(line) {
    logEntries.push(line);
    if (logEntries.length > 30) logEntries.shift();
    $ui.run(function() {
        try {
            $ui.txt_log.setText(logEntries.join("\n"));
            $ui.post(function() { $ui.log_scroll.fullScroll(android.view.View.FOCUS_DOWN); });
        } catch(e) {}
    });
}

/**
 * 统一写入日志事件，确保界面日志、AutoJs 控制台和可拉取 JSONL 共用同一时间与消息。
 *
 * @param {string} level 事件等级，例如 info 或 error。
 * @param {string} message 用户可读的事件描述。
 * @param {Object|null} details 可选的错误堆栈与截图路径。
 * @returns {string|null} 成功落盘的日志路径；无法落盘时返回 null。
 */
function appendRuntimeRecord(level, message, details) {
    var now = new Date();
    var record = {
        timestamp: formatRuntimeTimestamp(now),
        epochMs: now.getTime(),
        timezoneOffsetMinutes: -now.getTimezoneOffset(),
        sessionId: runtimeSessionId,
        level: level,
        message: String(message)
    };
    if (details) {
        if (details.stack) record.stack = String(details.stack);
        if (details.screenshotPath) record.screenshotPath = details.screenshotPath;
    }

    var persistedPath = writeRuntimeRecord(record);
    var line = helpers.timeStr(now) + "  " + record.message;
    try { log(line); } catch (e) {}
    appendToLogPanel(line);
    return persistedPath;
}

/**
 * 追加一条普通业务日志，同时持久化为 JSONL，方便宿主机在不依赖 logcat 的情况下回收分析。
 *
 * @param {string} msg 业务流程的可读描述。
 * @returns {string|null} 成功落盘的日志路径；存储不可用时返回 null。
 */
helpers.appendLog = function(msg) {
    return appendRuntimeRecord("info", msg, null);
};

/**
 * 判断当前脚本运行时是否仍持有可截图的 MediaProjection 会话。
 * 日志模块不能为收集证据而隐式申请录屏权限，否则用户拒绝启动后会再次弹出系统授权窗口。
 *
 * @returns {boolean} 当前可直接截图时返回 true。
 */
function hasActiveScreenCapture() {
    return !!images.getScreenCaptureOptions();
}

/**
 * 为同一会话内首次出现的告警保存现场截图。
 * 截图权限或存储不可用时仅省略图片，告警本身仍会写入 JSONL，不能影响正在运行的任务。
 *
 * @param {string} message 用于去重的完整告警文本。
 * @returns {string|null} 成功保存的图片路径；重复告警或截图失败时返回 null。
 */
function captureFirstWarningScreenshot(message) {
    if (!hasActiveScreenCapture()) return null;

    var screenshotPath = null;
    runtimeLogLock.lock();
    try {
        if (warningEvidenceMessages[message]) return null;
        warningEvidenceMessages[message] = true;
        warningScreenshotSequence += 1;
        screenshotPath = files.join(
            RUNTIME_LOG_DIRECTORY,
            RUNTIME_LOG_PREFIX + runtimeSessionId + "-warning-" + String(warningScreenshotSequence).padStart(3, "0") + ".png"
        );
        files.ensureDir(screenshotPath);
    } catch (e) {
        screenshotPath = null;
    } finally {
        runtimeLogLock.unlock();
    }

    if (!screenshotPath) return null;
    try {
        // 缺位时画面最能区分模板失配、动画未结束和意外弹层；只在首次告警时截取以控制存储量。
        captureScreen(screenshotPath);
        return screenshotPath;
    } catch (captureError) {
        return null;
    }
}

/**
 * 追加需人工诊断的告警，并仅为同一消息的首次出现关联当前画面截图。
 *
 * @param {string} msg 用户可读的告警描述。
 * @param {boolean} [captureEvidence=true] 为 false 时仅写 warn 事件，避免无录屏会话时日志本身再次触发系统授权。
 * @returns {string|null} 成功落盘的日志路径；无法落盘时返回 null。
 */
helpers.appendWarning = function(msg, captureEvidence) {
    var message = String(msg);
    return appendRuntimeRecord("warn", message, {
        // 用户刚拒绝录屏时，禁止告警截图回调 captureScreen()，否则底层会再次弹出授权窗口。
        screenshotPath: captureEvidence === false ? null : captureFirstWarningScreenshot(message)
    });
};

/**
 * 将顶层异常写为 error 事件，并在截图权限仍可用时保留当前画面作为同会话诊断证据。
 *
 * @param {string} context 异常发生的业务上下文。
 * @param {Error|Object|string} error 捕获到的异常对象或文本。
 * @returns {string|null} 成功落盘的日志路径；存储不可用时返回 null。
 */
helpers.appendError = function(context, error) {
    var message = error && error.message ? String(error.message) : String(error || "未知错误");
    var stack = error && error.stack ? String(error.stack) : null;
    var screenshotPath = null;

    runtimeLogLock.lock();
    try {
        errorScreenshotSequence += 1;
        screenshotPath = files.join(
            RUNTIME_LOG_DIRECTORY,
            RUNTIME_LOG_PREFIX + runtimeSessionId + "-error-" + String(errorScreenshotSequence).padStart(3, "0") + ".png"
        );
        files.ensureDir(screenshotPath);
    } finally {
        runtimeLogLock.unlock();
    }

    if (hasActiveScreenCapture()) {
        try {
            // 只有已有会话才截现场，避免错误日志在权限缺失时变成新的授权请求。
            captureScreen(screenshotPath);
        } catch (captureError) {
            screenshotPath = null;
        }
    } else {
        screenshotPath = null;
    }

    return appendRuntimeRecord("error", String(context) + ": " + message, {
        stack: stack,
        screenshotPath: screenshotPath
    });
};

helpers.updateStats = function(taskKey, stats) {
    $ui.run(function() {
        try {
            if (stats && taskKey) {
                if ($ui["stat_" + taskKey]) $ui["stat_" + taskKey].setText(String(stats[taskKey] || 0));
            }
        } catch(e) {}
    });
};

helpers.initStats = function(stats) {
    $ui.run(function() {
        var keys = ["food", "weapon", "ship", "war"];
        for (var i = 0; i < keys.length; i++) {
            try {
                if ($ui["stat_" + keys[i]]) $ui["stat_" + keys[i]].setText(String(stats[keys[i]] || 0));
            } catch(e) {}
        }
    });
};

helpers.initCircleIcon = function(iv, srcBitmap) {
    try {
        iv.post(function() {
            var size = iv.getWidth();
            if (!size) return;
            var output = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
            var canvas = new android.graphics.Canvas(output);
            var paint = new Paint();
            paint.setAntiAlias(true);
            var shader = new android.graphics.BitmapShader(srcBitmap, android.graphics.Shader.TileMode.CLAMP, android.graphics.Shader.TileMode.CLAMP);
            var matrix = new android.graphics.Matrix();
            var scale = Math.max(size / srcBitmap.getWidth(), size / srcBitmap.getHeight());
            matrix.setScale(scale, scale);
            var dx = (size - srcBitmap.getWidth() * scale) / 2;
            var dy = (size - srcBitmap.getHeight() * scale) / 2;
            matrix.postTranslate(dx, dy);
            shader.setLocalMatrix(matrix);
            paint.setShader(shader);
            canvas.drawCircle(size / 2, size / 2, size / 2, paint);
            iv.setImageBitmap(output);
        });
    } catch(e) {}
};

module.exports = helpers;
