#!/system/bin/sh
# MuMu 的游戏会忽略无障碍服务与 adb input 生成的手势；本进程以 adb root 权限
# 写入虚拟机真实触摸设备。Auto.js 通过 127.0.0.1 HTTP 请求调用它，避免把 root
# 权限暴露给脚本或游戏以外的应用。

EVENT_DEVICE="/dev/input/event4"
TRACKING_ID=4242

emit_event() {
    sendevent "$EVENT_DEVICE" "$1" "$2" "$3"
}

sync_event() {
    emit_event 0 0 0
}

sleep_ms() {
    if [ "$1" -gt 0 ]; then
        toybox usleep "$(( $1 * 1000 ))"
    fi
}

touch_down_raw() {
    emit_event 3 47 "$1"
    emit_event 3 57 "$2"
    emit_event 3 53 "$3"
    emit_event 3 54 "$4"
}

touch_move_raw() {
    emit_event 3 47 "$1"
    emit_event 3 53 "$2"
    emit_event 3 54 "$3"
}

touch_up_raw() {
    emit_event 3 47 "$1"
    emit_event 3 57 -1
}

touch_down() {
    touch_down_raw 0 "$TRACKING_ID" "$1" "$2"
    # MuMu 的触摸设备将主接触声明为 BTN_MOUSE；缺少该状态时，Android 不会把
    # 原始坐标派发给普通界面和 Unity，只会在内核中记录多点坐标。
    emit_event 1 272 1
    # 游戏仅在收到手指工具状态后才把后续移动归类为工具拖放；
    # 缺少该事件时，单点点击仍可生效，但 Unity 会把长距离移动当成地图平移。
    emit_event 1 325 1
    sync_event
}

touch_move() {
    touch_move_raw 0 "$1" "$2"
    sync_event
}

touch_up() {
    touch_up_raw 0
    # 主接触和手指工具状态必须成对释放，否则后续手势会被系统视为仍处于按下状态。
    emit_event 1 272 0
    # 与按下事件成对结束，避免下一次手势沿用已经激活的工具手指状态。
    emit_event 1 325 0
    sync_event
}

get_argument() {
    printf '%s' "$QUERY" | tr '&' '\n' | while IFS= read -r item; do
        case "$item" in
            "$1"=*)
                printf '%s' "${item#*=}"
                break
                ;;
        esac
    done
}

send_response() {
    printf 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nok\n'
}

read -r REQUEST || exit 0
PATH_AND_QUERY="${REQUEST#GET }"
PATH_AND_QUERY="${PATH_AND_QUERY%% HTTP/*}"
PATH_NAME="${PATH_AND_QUERY%%\?*}"
QUERY="${PATH_AND_QUERY#*\?}"
if [ "$QUERY" = "$PATH_AND_QUERY" ]; then
    QUERY=""
fi

case "$PATH_NAME" in
    /tap)
        X="$(get_argument x)"
        Y="$(get_argument y)"
        HOLD="$(get_argument d)"
        [ -n "$HOLD" ] || HOLD=300
        if [ -n "$X" ] && [ -n "$Y" ]; then
            touch_down "$X" "$Y"
            # Unity 对短于一帧的按下经常不派发点击，默认保持 300ms。
            sleep_ms "$HOLD"
            touch_up
        fi
        ;;
    /swipe)
        X1="$(get_argument x1)"
        Y1="$(get_argument y1)"
        X2="$(get_argument x2)"
        Y2="$(get_argument y2)"
        DURATION="$(get_argument d)"
        [ -n "$DURATION" ] || DURATION=600
        if [ -n "$X1" ] && [ -n "$Y1" ] && [ -n "$X2" ] && [ -n "$Y2" ]; then
            STEPS=12
            DELAY="$(( DURATION / STEPS ))"
            touch_down "$X1" "$Y1"
            STEP=1
            while [ "$STEP" -le "$STEPS" ]; do
                NEXT_X="$(( X1 + (X2 - X1) * STEP / STEPS ))"
                NEXT_Y="$(( Y1 + (Y2 - Y1) * STEP / STEPS ))"
                touch_move "$NEXT_X" "$NEXT_Y"
                sleep_ms "$DELAY"
                STEP="$(( STEP + 1 ))"
            done
            touch_up
        fi
        ;;
    /path)
        DURATION="$(get_argument d)"
        [ -n "$DURATION" ] || DURATION=2000
        HOLD="$(get_argument h)"
        [ -n "$HOLD" ] || HOLD=450
        POINTS="$(get_argument p)"
        # p 以 x1,y1,x2,y2... 传入；坐标仅来自脚本内部识图结果。
        set -- $(printf '%s' "$POINTS" | tr ',' ' ')
        if [ "$#" -ge 4 ]; then
            PREV_X="$1"
            PREV_Y="$2"
            shift 2
            PAIRS="$(( $# / 2 ))"
            [ "$PAIRS" -gt 0 ] || PAIRS=1
            DELAY="$(( DURATION / PAIRS / 4 ))"
            touch_down "$PREV_X" "$PREV_Y"
            # 镰刀、种子等底部工具需要先被按住，游戏才会锁定为拖放对象。
            sleep_ms "$HOLD"
            while [ "$#" -ge 2 ]; do
                NEXT_X="$1"
                NEXT_Y="$2"
                shift 2
                STEP=1
                while [ "$STEP" -le 4 ]; do
                    MOVE_X="$(( PREV_X + (NEXT_X - PREV_X) * STEP / 4 ))"
                    MOVE_Y="$(( PREV_Y + (NEXT_Y - PREV_Y) * STEP / 4 ))"
                    touch_move "$MOVE_X" "$MOVE_Y"
                    sleep_ms "$DELAY"
                    STEP="$(( STEP + 1 ))"
                done
                PREV_X="$NEXT_X"
                PREV_Y="$NEXT_Y"
            done
            touch_up
        fi
        ;;
    /pinch)
        X1="$(get_argument x1)"
        Y1="$(get_argument y1)"
        X2="$(get_argument x2)"
        Y2="$(get_argument y2)"
        TO_X1="$(get_argument tx1)"
        TO_Y1="$(get_argument ty1)"
        TO_X2="$(get_argument tx2)"
        TO_Y2="$(get_argument ty2)"
        DURATION="$(get_argument d)"
        [ -n "$DURATION" ] || DURATION=800
        if [ -n "$X1" ] && [ -n "$Y1" ] && [ -n "$X2" ] && [ -n "$Y2" ] && [ -n "$TO_X1" ] && [ -n "$TO_Y1" ] && [ -n "$TO_X2" ] && [ -n "$TO_Y2" ]; then
            STEPS=12
            DELAY="$(( DURATION / STEPS ))"
            touch_down_raw 0 "$TRACKING_ID" "$X1" "$Y1"
            touch_down_raw 1 "$(( TRACKING_ID + 1 ))" "$X2" "$Y2"
            sync_event
            STEP=1
            while [ "$STEP" -le "$STEPS" ]; do
                MOVE_X1="$(( X1 + (TO_X1 - X1) * STEP / STEPS ))"
                MOVE_Y1="$(( Y1 + (TO_Y1 - Y1) * STEP / STEPS ))"
                MOVE_X2="$(( X2 + (TO_X2 - X2) * STEP / STEPS ))"
                MOVE_Y2="$(( Y2 + (TO_Y2 - Y2) * STEP / STEPS ))"
                touch_move_raw 0 "$MOVE_X1" "$MOVE_Y1"
                touch_move_raw 1 "$MOVE_X2" "$MOVE_Y2"
                sync_event
                sleep_ms "$DELAY"
                STEP="$(( STEP + 1 ))"
            done
            touch_up_raw 1
            touch_up_raw 0
            sync_event
        fi
        ;;
esac

send_response
