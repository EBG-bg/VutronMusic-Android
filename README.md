# Vutron Music - Mobile

> 非官方 Android 移植版 · 正式版本 **1.1.0** · Android 13 / HyperOS · ARM64

Vutron Music - Mobile 是 [VutronMusic](https://github.com/stark81/VutronMusic) 的**非官方 Android 移植版**，面向 Android 13 / HyperOS 的 ARM64 设备。本项目与上游作者、网易云音乐及任何音乐平台均无官方隶属或背书关系。“面向”指作者仅有该环境进行实际测试，如有其他安卓设备不兼容情况，欢迎提交 Issue。

本仓库只维护 Android 客户端及构建所需的共享代码；桌面 Electron 版本请访问[上游项目](https://github.com/stark81/VutronMusic)。

> **下载与升级：** [下载正式版 1.1.0](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.1.0)。本仓库基于旧仓库最终版 `1.0.2` 继续维护 Android 客户端，沿用原包名和签名。已安装 `1.0.2` 的用户可在应用内检查更新；旧仓库保留历史版本并维持归档。

## 用前须知

本移植为纯 vibe-coding 项目，移植代码 by 6.1sol，检查与建议 by deepseek v4.1 1017、6.1sol 和我自己。

因本人为学生，所以大部分优化、Issue 和 PR 会在周末或假期处理和更新。

## 功能亮点

- **在线歌单可管理**：喜欢、加入歌单、新建、编辑、删除自有歌单，不只是查看和播放。
- **本地音乐可用**：授权文件夹、扫描音频、纯音频 ZIP 导入、离线缓存，不登录也能听本地文件。
- **CUE 分轨**：同目录整轨 FLAC/WAV + CUE 会显示为多首虚拟曲目。
- **逐字歌词**：支持网易云 YRC、增强 LRC/WRC 的真实词时间，并提供桌面悬浮歌词。
- **评论**：支持歌曲评论的推荐/热门/最新、分页、点赞、发表、回复、删除和楼层。
- **播放控制**：队列、下一首插队、全局倍速、高级变调、睡眠定时和 Wi-Fi 下一首地址预取。
- **播放体验**：播放页快捷调速、实际倍率反馈、耳机断开暂停、可操作的故障提示，以及更完整的设置动效与三语文案。

## 功能

| 功能 | 说明 |
| --- | --- |
| 在线音乐 | 网易云二维码 / Cookie 登录、首页推荐、搜索、歌单与歌曲播放。 |
| 歌单管理 | 喜欢 / 取消喜欢、加入歌单、新建、编辑、删除自有歌单，以及从自有歌单移除歌曲。状态以服务端重新读取的结果为准。 |
| 歌曲评论 | 推荐 / 热门 / 最新排序、分页、点赞、发表、回复、删除自己的评论和独立楼层分页。评论按纯文本显示，不写入持久缓存。 |
| 本地音乐 | 授权一个或多个本地文件夹、扫描音频、从应用移除曲目并恢复扫描排除项；原文件保留。 |
| CUE 分轨 | 支持同目录、单个音频 `FILE` 的 CUE；按 `INDEX 01` 生成虚拟曲目，保留原音频。 |
| 本地歌单 | 导入兼容的纯音频 ZIP；默认按纯音频导入，不自动联网匹配；支持自定义曲目顺序。 |
| 桌面歌单导出 | 配套 Windows 简易 GUI / CLI，可导出本地及已登录网易云账号的歌单；见[工具说明](tools/README.md)。 |
| 离线缓存 | 缓存歌曲、歌单资料与封面；支持单曲删除和容量限制。 |
| 播放队列 | 查看队列、追加歌曲、下一首插队、循环与随机播放。 |
| 播放设置 | 保存歌曲与歌单音量、重启恢复播放进度、睡眠定时。 |
| 高级播放 | 播放页右上角调整全局 0.5–2.0× 倍速和音高，支持精确输入、常用倍率及实际生效反馈；Wi-Fi 下下一首地址预取位于缓存设置，默认关闭，不预下载音频。 |
| 应用内歌词 | 原文与译文同步滚动、逐曲延迟微调；支持 YRC、增强 LRC/WRC 的真实词时间。 |
| 桌面歌词 | 悬浮歌词、颜色、透明度、阴影和位置设置。 |
| 界面 | 简体中文、繁体中文、英文；设置、外观、调色盘、歌词延迟和播放错误已扩展三语，部分其他运行提示仍为中文；支持主题、列表/卡片布局和每排数量调整。 |
| 本地模式 | 无需账号或网络即可播放本地文件与已有缓存；自动更新检查暂停。 |
| 数据备份 | 导出设置与本地歌单资料；不包含账号、音频、封面、绝对路径和目录授权。 |
| 检查更新 | 设置中手动检查 GitHub Releases；自动检查默认关闭。 |
| 关于 | 查看版本、原项目信息，以及 APK 内置的隐私、使用说明和第三方许可。 |

**补充说明与交互细节：**

- **本地歌单导入**：默认按纯音频导入；若登录后主动选择补全在线资料，失败时会保留本地音频，不会替换为在线歌曲。
- **桌面导出歌单**：需使用配套工具生成。增强 LRC / WRC / YRC 真实词时间优先；无原始逐字时的估算逐字默认关闭，开启后由程序计算，不保证准确。
- **本地目录扫描**：仅读取授权目录中的音频与歌词，不修改原文件，也不自动批量匹配在线元数据。
- **滑条操作**：滑条只能从滑块头部开始拖动，空白轨道可滚动页面；保留实时调节、松手保存、数值输入和键盘操作。
- **CUE 分轨限制**：目前只处理同目录、单个音频 `FILE` 的常见场景。多 `FILE`、相对子目录、缺文件或无法解析的 CUE 会回退为整轨并提示；CUE 曲目暂不显示整轨同名歌词，避免时间轴错位。

## 下载与安装

正式安装包在[本仓库 Releases](https://github.com/EBG-bg/VutronMusic-Android/releases) 提供。当前版本为 [1.1.0](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.1.0)，更新内容见[更新记录](CHANGELOG.md)。

1.1.0 文件名：

```text
Vutron-Music-Mobile-1.1.0-arm64.apk
Vutron-Music-Mobile-1.1.0-arm64.apk.sha256
```

`.sha256` 用于核对安装包完整性；GitHub 自动生成的 `Source code` 是源码，不是安装包。

安装要求：

- Android 13 / HyperOS，ARM64 设备为主要目标。
- 其他 Android 版本和设备尚未完整验证。
- 手动安装 APK 时，系统可能要求授予“安装未知应用”权限。
- 使用悬浮歌词时，需要在系统中授予悬浮窗权限。

## 从旧仓库升级

旧仓库 [EBG-bg/VutronMusic](https://github.com/EBG-bg/VutronMusic) 的 `1.0.2` 已发布并归档，是最后一个版本，也是更新源切换版本。

- **1.0.0 / 1.0.1**：可手动下载本仓库的 `1.1.0` 覆盖升级；也可先从旧仓库更新到 `1.0.2`，再通过应用内更新继续升级。
- **1.0.2**：旧仓库最后版本，已发布；应用内只从本仓库检查和下载后续更新，不会回退旧仓库。
- **1.1.0**：本仓库的首个正式发行版，保留旧版功能并完善播放控制、设置交互、错误恢复和国际化。
- 后续正式版本只在本仓库发布和更新。
- 后续版本保持既有包名和签名，覆盖升级并保留应用数据。若系统提示签名不一致，请保留当前安装包和数据，先核对下载来源及证书。
- 旧仓库历史源码和 Release 保留用于追溯；归档后不再更新，也不再接收新的 Issue 或 PR。

1.1.0 与已发布的 1.0.0 / 1.0.1 / 1.0.2 保持包名 `io.github.vutronmusic.personal.webshell` 和相同签名。为兼容早期版本的覆盖升级并保留用户数据，正式版沿用初始生成密钥时的默认证书主题 `C=US, O=Android, CN=Android Debug`，证书 SHA-256 为 `d879659d80b689de9be73f419d3ccd01f4bee96f9725a08896b420037688d6d8`。私钥独立保管，安装包均为关闭应用调试的正式 Release 构建；证书主题与构建类型是不同信息。

旧仓库最后版本：

```text
https://github.com/EBG-bg/VutronMusic/releases/tag/mobile-v1.0.2
```

## 应用内更新

“设置 → 检查更新”提供手动检查与自动检查开关。

- 自动检查默认关闭；开启后最多每 6 小时检查一次本仓库的 Releases。
- 下载和系统安装仍需用户确认。
- 更新包会校验大小、SHA-256、包名、版本号和签名证书。
- 更新请求只连接 GitHub，不发送网易云账号 Cookie。
- 仅本地模式会暂停自动检查；主动点击“检查更新”仍会连接 GitHub。
- 当远端没有可用的新版本，或发布中不包含可验证的稳定 ARM64 资产包时，应用会提示当前已是最新版本或暂无可用安装包；网络失败会另行报错，不会查询旧仓库。

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

- 网易云账号会话保存在应用私有存储中，不写入本项目仓库或 Release。
- 本地音乐通过 Android 系统文件夹选择器授权；应用只读取用户授权的目录。
- 音乐缓存、歌词缓存、封面和本地歌单资料保存在设备本地。
- JSON 备份不包含账号、Cookie、音频、封面缓存、绝对路径或目录授权。
- 卸载应用会删除应用私有数据；迁移或重装前建议先导出 JSON 备份。

详见[隐私说明](legal/PRIVACY.md)、[使用说明](legal/USE_POLICY.md)和[再分发说明](legal/REDISTRIBUTION.md)。

## 构建

本仓库只包含 Android 客户端及构建所需代码，不需要安装完整的 Electron 桌面开发环境。

迁入基线、原项目版权和历史源码入口见[源码迁移说明](docs/MIGRATION.md)。

当前 `package.json` 为 `1.1.0`，Android `versionCode` 为 `33`；正式安装包对应 `mobile-v1.1.0` 标签中的源码。详细构建和验证说明见 [Android README](apps/android-vutron/README.md)。

### 环境要求

- Node.js 22.16 或更新的受支持版本
- JDK 21
- Android SDK Platform 35
- Android Build Tools 35+
- 设置 `JAVA_HOME`、`ANDROID_HOME` 或 `ANDROID_SDK_ROOT`

### 调试构建

```powershell
./scripts/build-mobile.ps1 -Configuration Debug
```

Linux / macOS：

```sh
sh scripts/build-mobile.sh Debug
```

产物位于：

```text
apps/android-vutron/android/app/build/outputs/apk/
```

### Release 签名

Gradle 从以下环境变量读取签名配置，值不要写入源码或提交：

```text
VUTRON_RELEASE_KEYSTORE
VUTRON_RELEASE_STORE_PASSWORD
VUTRON_RELEASE_KEY_ALIAS
VUTRON_RELEASE_KEY_PASSWORD
```

未提供签名配置时生成 unsigned release APK，需要自行签名。仓库不附带签名私钥。

Release APK 不开启 WebView 调试；CI 的 Debug artifact 只用于开发检查，不作为已安装版本的升级来源。

### 后续发布约定

正式 Release 使用以下格式；1.1.0 的标签与资产名为：

- tag：`mobile-v1.1.0`
- 资产名：`Vutron-Music-Mobile-1.1.0-arm64.apk`
- 校验文件：同名 `.sha256`

更新器依赖 `mobile-v*` 前缀和固定资产名，不要改成 `v1.1.0` 或其他命名。

CI 在 `main` 的 push / PR 中执行安卓构建和测试，只生成开发检查用的 Debug artifact，不自动创建标签或 Release；其签名不能用于覆盖已安装的正式版。

## 项目结构

- `apps/android-vutron`：Android 客户端、Vue UI 与 Capacitor 原生适配
- `packages/core`：歌词与封面共享逻辑
- `packages/ui`：桌面 / Android 共用控件
- `android/shared`：网络与会话适配
- `vendor/android-runtime`：Android 运行时、音源匹配与音质选择
- `vendor/java-compat`：Android Java 兼容库的对应源码与来源说明
- `src/renderer/assets`、`src/renderer/locales`：移动端实际使用的原图标、主题和三语词库
- `scripts`：Android 构建入口
- `tools`：桌面歌单导出 GUI / CLI 及测试
- `legal`：隐私、使用、许可与再分发材料

`vendor/android-runtime` 中的运行库和 JavaScript 是实际运行输入，必须保留。其中包含 LGPL-3.0-only 组件，对应源码和许可证随仓库提供。

## 许可与声明

本项目根许可证为 MIT，原 VutronMusic 的版权与许可文本保留。

但**不是所有组件都是 MIT**：项目包含第三方库和 LGPL-3.0-only 组件，具体许可见：

- [LICENSE](LICENSE)
- [NOTICE](NOTICE)
- [第三方声明](THIRD_PARTY_NOTICES.md)
- [完整第三方许可](legal/THIRD_PARTY_LICENSES.txt)
- [第三方清单](legal/third-party-inventory.json)

本项目不附带账号、Cookie、音乐文件、歌词库或平台授权，也不承诺提供受限内容。播放能力取决于各来源的可用性及用户账号权限。

本项目是非官方移植，不代表上游作者或音乐平台。

## 致谢

- [stark81/VutronMusic](https://github.com/stark81/VutronMusic)：原桌面播放器与上游代码
- [jooy2/vutron](https://github.com/jooy2/vutron)：原始脚手架
- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)：界面与设计参考
- NeteaseCloudMusicApiEnhanced：网易云接口协议参考
- [@unblockneteasemusic/server](https://github.com/UnblockNeteaseMusic/server)：备用音源匹配
- 所有贡献者和第三方组件作者

Android 适配与维护：**EBG-bg and contributors**。

## English summary

Vutron Music - Mobile is an unofficial Android port of [VutronMusic](https://github.com/stark81/VutronMusic), built with Vue 3, Pinia and Capacitor.

The Android source, build inputs, tools and license materials have been migrated from the archived `1.0.2` repository and continue to be maintained here. The current official release is **1.1.0** (`mobile-v1.1.0`, `versionCode 33`). Features include NetEase playback and playlist management, track comments, local music folders, single-file CUE sheets, audio-only ZIP import, offline caching, playback queues, enhanced word-timed lyrics, playback speed/pitch controls and an opt-in next-track address prefetch.

Download the latest ARM64 APK (`1.1.0`) from [Releases](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.1.0). Users on `1.0.2` from the [archived repository](https://github.com/EBG-bg/VutronMusic/releases/tag/mobile-v1.0.2) can also upgrade directly via the in-app updater. This project is not affiliated with or endorsed by the upstream author or any music provider. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for licensing information.
