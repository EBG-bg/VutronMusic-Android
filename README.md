# Vutron Music - Mobile

> 非官方 Android 移植版 · **1.3.0**

基于 [VutronMusic](https://github.com/stark81/VutronMusic) 的 Android 音乐播放器，支持在线音乐库、本机文件与离线播放。本项目与上游作者及音乐平台均无官方隶属或背书关系；桌面版请访问上游项目。

**[下载安装包](https://github.com/EBG-bg/VutronMusic-Android/releases)** · [更新记录](CHANGELOG.md) · [使用与构建说明](apps/android-vutron/README.md)

## 用前须知

本移植为纯 vibe-coding 项目，移植代码 by 6.1sol，检查与建议 by deepseek v4.1 1017、6.1sol 和我自己。

因本人为学生，所以大部分优化、Issue 和 PR 会在周末或假期处理和更新。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 在线音乐库 | 网易云扫码 / Cookie 登录、推荐、搜索、歌单与评论；可选酷狗及 Emby、Jellyfin、Navidrome 等来源，账号与服务器实例独立。 |
| 本机与离线 | 多文件夹、音频 ZIP、桌面歌单包、单文件 CUE 分轨；自动缓存歌曲、歌单资料、封面和歌词，支持容量管理。无需账号也可使用本机模式。 |
| 歌单与队列 | 列表 / 卡片布局、排序与续播；自定义顺序预览、命名和永久保存，多选入队、下一首插队、可撤销移除。 |
| 播放工具 | 循环 / 随机、倍速与音高、歌曲和歌单音量、A/B 区间循环、睡眠定时及淡出、恢复播放进度。 |
| 歌词 | 原文与译文滚动、真实逐字、逐曲延迟；悬浮歌词可调位置、颜色、透明度和阴影。估算逐字默认关闭。 |
| 界面与数据 | 简中 / 繁中 / 英文、主题、大字号与动效设置、滑动导航；JSON 设置与本地歌单备份、GitHub 更新检查。 |

## 下载与升级

在 [Releases](https://github.com/EBG-bg/VutronMusic-Android/releases) 下载 **ARM64 `.apk`**；同名 `.sha256` 文件用于校验，`Source code` 是源码。

保留原包名与签名，支持覆盖升级，无需先卸载。证书主题 `Android Debug` 为历史名称，安装包使用关闭调试的 Release 构建；完整指纹见 [Android 说明](apps/android-vutron/README.md)。旧 `1.0.0 / 1.0.1` 可手动升级，`1.0.2` 及后续版本使用本仓库更新源。

自动检查更新默认关闭，本地模式不自动检查；主动点击“检查更新”仍会联网。

## 使用说明

- 在设置的“管理音乐来源”开启额外音乐库，再从侧栏或顶部切换。酷狗默认可直接扫码；Emby、Jellyfin、Navidrome 需要自己的服务器和账号。来源能力及音频、歌词、评论设置的区别见[兼容说明](docs/PLUGIN_COMPATIBILITY.md)。
- 本机音乐只读取授权目录，“从应用移除”不删除原音频。网络歌曲需完整缓存后才能离线播放；桌面歌单包使用[配套导出工具](tools/README.md)生成。
- JSON 备份保存设置与本地歌单资料，不包含账号、音频或目录授权；换设备或重装后需重新关联文件并授权目录。
- 在线内容、音质及功能取决于账号权限和接口状态，本项目不提供音乐资源或平台会员权益。具体数据处理见[隐私说明](legal/PRIVACY.md)。

## 反馈

问题和建议请提交到 [Issues](https://github.com/EBG-bg/VutronMusic-Android/issues)，附上版本、设备和复现步骤；分享日志前移除账号凭据与个人路径。桌面版问题请反馈到上游仓库。

## 许可与致谢

基于 [stark81/VutronMusic](https://github.com/stark81/VutronMusic) 与 [jooy2/vutron](https://github.com/jooy2/vutron)，感谢上游作者及所有第三方组件贡献者。Android 适配与维护：**EBG-bg and contributors**。

根许可证为 MIT，包含 LGPL-3.0-only 等第三方组件。详见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md)及[再分发说明](legal/REDISTRIBUTION.md)。

## English summary

An unofficial Android port of VutronMusic with online libraries, local/offline playback, playlists, timed lyrics and playback tools. Download the ARM64 APK from [Releases](https://github.com/EBG-bg/VutronMusic-Android/releases); see the [Android documentation](apps/android-vutron/README.md) for setup and builds. This project is not affiliated with music providers and supplies no music accounts, files or membership access.
