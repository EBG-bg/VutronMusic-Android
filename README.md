# Vutron Music - Mobile

> 非官方 Android 移植版 · 正式版本 **1.2.0** · Android 13 / HyperOS · ARM64

Vutron Music - Mobile 是 [VutronMusic](https://github.com/stark81/VutronMusic) 的**非官方 Android 移植版**，主要面向 Android 13 / HyperOS 的 ARM64 设备，并完成 Android 15 平板模拟器的定向检查。本项目与上游作者、网易云音乐及任何音乐平台均无官方隶属或背书关系。其他安卓设备的兼容问题欢迎提交 Issue。

本仓库只维护 Android 客户端及构建所需的共享代码；桌面 Electron 版本请访问[上游项目](https://github.com/stark81/VutronMusic)。

> **下载：** [正式版 1.2.0](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.2.0) · [更新记录](CHANGELOG.md) · [旧仓库最终版 1.0.2](https://github.com/EBG-bg/VutronMusic/releases/tag/mobile-v1.0.2)

## 用前须知

本移植为纯 vibe-coding 项目，移植代码 by 6.1sol，检查与建议 by deepseek v4.1 1017、6.1sol 和我自己。

因本人为学生，所以大部分优化、Issue 和 PR 会在周末或假期处理和更新。

## 功能

| 功能 | 说明 |
| --- | --- |
| 在线音乐 | 网易云二维码 / Cookie 登录、首页推荐、搜索、歌单与歌曲播放。 |
| 歌单管理 | 喜欢、加入歌单、新建、编辑、删除自有歌单，以及从歌单移除歌曲。 |
| 歌曲评论 | 推荐 / 热门 / 最新、分页、点赞、发表、回复、删除和楼层。 |
| 本地音乐 | 授权文件夹、扫描音频、纯音频 ZIP、CUE 分轨；支持取消读取和恢复排除项。 |
| 桌面歌单导出 | Windows GUI / CLI，可导出本地及已登录网易云账号的歌单。 |
| 离线缓存 | 缓存歌曲、歌单资料和封面；支持单曲删除和容量限制。 |
| 播放队列 | 队列、下一首插队、循环 / 单曲循环 / 随机按钮、歌曲与歌单音量、重启恢复进度。 |
| 歌单排序 | 按名称、创建时间、最近播放或自定义排序；支持列表手柄与卡片长按拖动。 |
| 高级播放 | 播放页右上角调整 0.5–2.0× 倍速和音高；Wi-Fi 下一首地址预取默认关闭。 |
| 应用内歌词 | 点击切换封面 / 歌词，原文与译文同步、逐曲延迟微调；支持 YRC、增强 LRC/WRC 词时间。 |
| 桌面歌词 | 悬浮歌词的颜色、透明度、阴影和位置设置。 |
| 本地模式 | 无需账号或网络即可播放本地文件和已有缓存。 |
| 数据备份 | 导出设置与本地歌单资料，不包含账号、音频、封面和目录授权。 |
| 检查更新 | 手动检查 GitHub Releases；自动检查默认关闭。 |
| 睡眠定时 | 最长 300 分钟，双滚轮与精确输入，秒数跨分钟连续调整。 |
| 界面 | 简中、繁中、英文；主题、100–150% 字号、强调色、列表/卡片布局及每排数量。 |

补充说明：

- CUE 仅支持同目录、单音频 `FILE`；多 `FILE`、相对子目录、缺文件或解析失败会回退整轨。CUE 曲目暂不显示整轨同名歌词。
- 评论目前只有歌曲评论，不支持专辑、歌单和 MV。
- 本地歌单默认按纯音频导入；登录后主动补全在线资料失败时保留本地音频，不替换为在线歌曲。
- 本地扫描只读取已授权目录，不修改原文件，也不自动匹配在线元数据。
- 滑条只能从滑块头部开始拖动，空白轨道可滚动页面；支持实时调节、松手保存、数值输入和键盘操作。

## 下载与安装

从[本仓库 Releases](https://github.com/EBG-bg/VutronMusic-Android/releases) 下载：

```text
Vutron-Music-Mobile-1.2.0-arm64.apk
Vutron-Music-Mobile-1.2.0-arm64.apk.sha256
```

`.sha256` 用于校验安装包；GitHub 的 `Source code` 压缩包不是安装包。

主要目标：Android 13 / HyperOS、ARM64；Android 15 平板模拟器已完成横竖屏、系统栏和部分播放交互检查，其他设备尚未完整验证。手动安装可能需要“安装未知应用”权限，悬浮歌词需要悬浮窗权限。

## 从旧仓库升级

旧仓库 [EBG-bg/VutronMusic](https://github.com/EBG-bg/VutronMusic) 的 `1.0.2` 已发布并归档，是最后一个版本，也是更新源切换版本。

- **1.0.0 / 1.0.1**：可手动安装本仓库的 `1.2.0`；也可先更新到 `1.0.2`，再通过应用内更新升级。
- **1.0.2**：应用内只从本仓库检查和下载后续版本，不会回退旧仓库。
- **1.1.0**：本仓库首个正式版，保留旧版功能并完善播放控制、设置交互、错误恢复和国际化。
- **1.2.0**：增加字号、歌单排序、定时滚轮和头像同步，完善主题控件、弹层手势及 Android 15 系统栏适配；可直接覆盖升级。
- **1.1.0 以后**：只在本仓库发布和更新；继续沿用原包名和签名，覆盖升级保留应用数据。
- 若系统提示签名不一致，请保留当前安装包和数据，先核对下载来源及证书。

1.2.0 与 1.1.0、1.0.0 / 1.0.1 / 1.0.2 保持包名 `io.github.vutronmusic.personal.webshell` 和相同签名。为兼容旧版覆盖升级，正式版沿用初始证书主题 `C=US, O=Android, CN=Android Debug`，证书 SHA-256 为 `d879659d80b689de9be73f419d3ccd01f4bee96f9725a08896b420037688d6d8`。私钥独立保管，安装包均为关闭调试的 Release 构建。

## 应用内更新

- 自动检查默认关闭；开启后最多每 6 小时检查一次本仓库 Releases。
- 下载和系统安装仍需用户确认。
- 校验大小、SHA-256、包名、版本号和签名证书。
- 更新请求只连接 GitHub，不发送网易云账号 Cookie。
- 本地模式暂停自动检查；主动点击“检查更新”仍会联网。
- 无新版本、无可用 ARM64 资产包或网络失败时，应用会提示当前已是最新/暂无可用安装包或报错，不会查询旧仓库。

## 反馈与贡献

- 旧仓库已在 1.0.2 发布后归档；Issue 和 PR 请提交到[本仓库](https://github.com/EBG-bg/VutronMusic-Android/issues)。
- 本项目只维护 Android 客户端；桌面 Electron 版本的问题请提交到[上游项目](https://github.com/stark81/VutronMusic)。
- 提交问题请附：版本号、设备与 Android 版本、复现步骤、相关日志（或提供其中几项即可）。
- 不要公开发布账号 Cookie、签名媒体地址、本地音乐路径或设备标识。
- 安全问题请通过 GitHub Security Advisory 私下报告。

## 暂未支持

- 专辑、歌单、MV 评论；当前只有歌曲评论。
- 多 `FILE`、子目录路径和压缩包内 CUE 的自动分轨。
- 真正的无缝切歌；预取只提前解析下一首地址，不预下载音频。
- 桌面版插件系统和自建流媒体音源。

## 隐私与数据

- 网易云账号会话保存在应用私有存储中，不写入仓库或 Release。
- 本地音乐只读取用户授权的目录；缓存、歌词、封面和本地歌单资料保存在设备本地。
- JSON 备份不包含账号、Cookie、音频、封面缓存、绝对路径或目录授权。
- 卸载应用会删除应用私有数据；迁移或重装前建议先导出备份。

详见[隐私说明](legal/PRIVACY.md)、[使用说明](legal/USE_POLICY.md)和[再分发说明](legal/REDISTRIBUTION.md)。

## 构建

本仓库只包含 Android 客户端及构建所需代码，不需要 Electron 桌面开发环境。迁入说明见[源码迁移说明](docs/MIGRATION.md)。

环境要求：Node.js 22.16+、JDK 21、Android SDK Platform 35、Build Tools 35+，并设置 `JAVA_HOME`、`ANDROID_HOME` 或 `ANDROID_SDK_ROOT`。

```powershell
./scripts/build-mobile.ps1 -Configuration Debug
```

```sh
sh scripts/build-mobile.sh Debug
```

产物位于 `apps/android-vutron/android/app/build/outputs/apk/`。

Release 签名从以下环境变量读取，不要提交到仓库：

```text
VUTRON_RELEASE_KEYSTORE
VUTRON_RELEASE_STORE_PASSWORD
VUTRON_RELEASE_KEY_ALIAS
VUTRON_RELEASE_KEY_PASSWORD
```

未提供签名配置时生成 unsigned APK，需要自行签名；仓库不附带签名私钥。

当前 `package.json` 为 `1.2.0`，Android `versionCode` 为 `41`；详细构建和验证见 [Android README](apps/android-vutron/README.md)。

发布继续使用 `mobile-v*` 标签和固定资产名，例如 `mobile-v1.2.0` / `Vutron-Music-Mobile-1.2.0-arm64.apk`；更新器依赖这两个格式，不要改成普通 `v1.2.0`。

## 项目与许可

- `apps/android-vutron`：Android 客户端与 Capacitor 原生适配
- `packages`、`android/shared`、`vendor/android-runtime`：共享逻辑、网络适配和实际运行库
- `scripts`、`tools`、`legal`：构建入口、桌面导出工具和许可材料

根许可证为 MIT；项目还包含 LGPL-3.0-only 等第三方组件，完整许可见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md)、[第三方许可](legal/THIRD_PARTY_LICENSES.txt) 和[清单](legal/third-party-inventory.json)。本项目不附带账号、音乐文件或平台授权。

## 致谢

- [stark81/VutronMusic](https://github.com/stark81/VutronMusic)：原桌面播放器与上游代码
- [jooy2/vutron](https://github.com/jooy2/vutron)：原始脚手架
- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)：界面与设计参考
- NeteaseCloudMusicApiEnhanced：网易云接口协议参考
- [@unblockneteasemusic/server](https://github.com/UnblockNeteaseMusic/server)：备用音源匹配
- 所有贡献者和第三方组件作者

Android 适配与维护：**EBG-bg and contributors**。

## English summary

Vutron Music - Mobile is an unofficial Android port of [VutronMusic](https://github.com/stark81/VutronMusic), built with Vue 3, Pinia and Capacitor. It supports NetEase playback and playlist management, comments, local music and single-file CUE sheets, audio-only ZIP import, offline caching, queues, word-timed lyrics, playback speed/pitch and an opt-in next-track address prefetch.

The current official release is **1.2.0** (`versionCode 41`). Download the ARM64 APK from [Releases](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.2.0); users on `1.0.2` or `1.1.0` can upgrade in-app. This release adds interface font sizing, playlist ordering, continuous sleep-timer wheels, themed pickers and Android 15 tablet adaptations. This project is not affiliated with the upstream author or any music provider. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
