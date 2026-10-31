package io.github.vutronmusic.personal;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import javax.net.ssl.SSLException;

/** Stable UI codes; diagnostics contain stages/types/numeric player codes, never source URLs or cookies. */
final class PlaybackFailure {
    final String code, message, diagnostic;
    private PlaybackFailure(String code, String message, String diagnostic) {
        this.code = code; this.message = message; this.diagnostic = diagnostic;
    }
    static PlaybackFailure of(String code) { return new PlaybackFailure(code, message(code), ""); }
    static PlaybackFailure legacy(String message) { return new PlaybackFailure("playback", message, ""); }

    static final class Reported extends IOException {
        final String code;
        Reported(String code, String message) { super(message); this.code = code; }
    }

    static PlaybackFailure from(Throwable failure, String stage, boolean remote, boolean online) {
        ArrayDeque<Throwable> pending = new ArrayDeque<>();
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        if (failure != null) pending.add(failure);
        String code = "", networkCode = "";
        while (!pending.isEmpty() && seen.size() < 16) {
            Throwable next = pending.removeFirst();
            if (!seen.add(next)) continue;
            if (next instanceof Reported) { code = ((Reported) next).code; break; }
            if (next instanceof NeteaseApi.CommentFailure
                    && (((NeteaseApi.CommentFailure) next).code == 301 || ((NeteaseApi.CommentFailure) next).code == 401)) {
                code = "auth"; break;
            }
            if (!remote && next instanceof SecurityException) { code = "local_permission"; break; }
            if (!remote && next instanceof FileNotFoundException) { code = "local_missing"; break; }
            if (next instanceof SocketTimeoutException) networkCode = "timeout";
            else if (networkCode.isEmpty() && (next instanceof UnknownHostException || next instanceof ConnectException
                    || next instanceof SocketException || next instanceof SSLException)) networkCode = "network";
            if (next.getCause() != null) pending.addLast(next.getCause());
            for (Throwable suppressed : next.getSuppressed()) pending.addLast(suppressed);
        }
        if (code.isEmpty()) code = !networkCode.isEmpty() ? networkCode : remote && !online ? "network"
                : "resolve".equals(stage) ? "source_unavailable" : "playback";
        return new PlaybackFailure(code, message(code), stage + ": " + (failure == null ? "Unknown" : failure.getClass().getSimpleName()));
    }

    static PlaybackFailure media(int what, int extra, boolean remote, boolean online) {
        // MediaPlayer: SERVER_DIED=100, IO=-1004, MALFORMED=-1007, UNSUPPORTED=-1010, TIMED_OUT=-110.
        String code = what == 100 ? "player" : extra == -1007 || extra == -1010 ? "decode"
                : extra == -110 ? "timeout" : remote && !online ? "network"
                : extra == -1004 && remote ? "source_io" : "playback";
        return new PlaybackFailure(code, message(code), "MediaPlayer what=" + what + ", extra=" + extra);
    }

    private static String message(String code) {
        switch (code) {
            case "auth": return "网易云登录已失效，请重新登录后重试";
            case "network": return "网络连接不可用，请检查网络，或播放本地／已缓存歌曲";
            case "timeout": return "读取音频超时，请重试或检查网络";
            case "local_permission": return "音乐文件夹读取权限已失效，请重新授权原文件夹";
            case "local_missing": return "找不到本地音频，请检查文件或重新导入／扫描音乐文件夹";
            case "source_unavailable": return "当前音源未能提供完整音频，请稍后重试或检查账号权限";
            case "source_io": return "音源读取失败，可能是地址失效或连接中断，请重试";
            case "decode": return "无法解码该音频，文件可能损坏或格式不受设备支持";
            case "player": return "系统播放器已中断，请重新播放";
            case "offline": return "当前为本地模式，仅可播放本地文件和已完成缓存";
            case "seek": return "无法定位该音频的播放进度，请重新播放";
            case "audio_focus": return "系统暂未授予音频播放权限，请稍后重试";
            default: return "播放未能完成，请重新播放；若仍失败，可查看技术信息";
        }
    }
}
