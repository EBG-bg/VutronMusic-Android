# Vutron Music - Mobile

> 非官方 Android 移植版 · **正式版 1.2.1（versionCode 47）** · Android 13 / HyperOS · ARM64

Vutron Music - Mobile 是 [VutronMusic](https://github.com/stark81/VutronMusic) 的**非官方 Android 移植版**，主要面向 Android 13 / HyperOS 的 ARM64 设备，并进行 Android 15 平板模拟器的定向检查。本项目与上游作者、网易云音乐及任何音乐平台均无官方隶属或背书关系。

本仓库维护 Android 客户端及构建所需的共享代码。桌面 Electron 版本请访问[上游项目](https://github.com/stark81/VutronMusic)。

> **下载：** [正式版 1.2.1](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.2.1) · [全部版本](https://github.com/EBG-bg/VutronMusic-Android/releases) · [更新记录](CHANGELOG.md) · [旧仓库最终版 1.0.2](https://github.com/EBG-bg/VutronMusic/releases/tag/mobile-v1.0.2)。

## 用前须知

本移植为纯 vibe-coding 项目，移植代码 by 6.1sol，检查与建议 by deepseek v4.1 1017、6.1sol 和我自己。

因本人为学生，所以大部分优化、Issue 和 PR 会在周末或假期处理和更新。

## 1.2.1 的主要变化

- **在同一主界面使用不同音乐库。** 开启并配置额外来源后，可在主菜单切换来源，沿用首页、音乐库、搜索和播放器；打开歌单、艺人或专辑后，返回仍按当前页面层级处理。
- **内置来源直接提供，按需开启。** 无需为随应用提供的来源再次下载或安装。自建流媒体、多个服务器实例及第三方 JavaScript 导入保留独立配置；原生网易云与本机音乐仍使用原有主入口。
- **分清三种来源设置。** 在线音频匹配、歌词读取顺序、评论读取顺序分别管理；音乐库连接开关不等于音频匹配候选的开关。

## 功能

下表为 1.2.1 的功能；旧版 1.2.0 安装包不包含新增音乐来源功能。

| 功能 | 说明 |
| --- | --- |
| 网易云音乐 | 二维码 / Cookie 登录、首页推荐、搜索、歌曲与歌单播放，以及喜欢、新建和编辑自有歌单等操作。 |
| 更多音乐库 | 内置酷狗、Emby、Jellyfin、Navidrome 等可选连接；可用功能由对应接口提供。 |
| 统一导航 | 已开启来源接入主菜单的首页、音乐库和搜索；歌曲菜单、队列、详情与播放器继续共用。 |
| 独立账号与实例 | 不同来源与服务器实例分别保存账号和配置；第三方兼容插件可通过 JavaScript 文件导入。 |
| 歌单管理 | 加入歌单、从自有歌单移除、排序与续播；列表 / 卡片布局、自定义拖动与每排数量。 |
| 评论与关联内容 | 网易云歌曲评论、楼层回复、点赞、发表和删除；其他实体、MV、FM 等按来源能力开放。 |
| 本机音乐 | 一个或多个授权文件夹、扫描音频、纯音频 ZIP、同目录单文件 CUE 分轨，以及移除记录恢复。 |
| 桌面歌单导出 | Windows GUI / CLI，可导出桌面本地歌单及已登录网易云账号的歌单。 |
| 离线缓存 | 自动缓存已播放歌曲，并保留歌单资料、封面和歌词；支持容量限制、单曲缓存删除与缓存歌单管理。 |
| 播放控制 | 队列与下一首插队、循环 / 单曲循环 / 随机、歌曲和歌单音量、重启恢复进度。 |
| 倍速与定时 | 播放页调整 0.5–2.0× 倍速和音高；最长 300 分钟睡眠定时；可选 Wi-Fi 下一首地址预取。 |
| 应用内歌词 | 封面 / 歌词切换、原文和译文滚动、逐曲延迟；支持 YRC、增强 LRC / WRC 的真实词时间。 |
| 桌面歌词 | 悬浮歌词的位置、颜色、透明度和阴影设置。 |
| 无账号本地模式 | 无需登录即可播放已授权的本机文件和已有完整音频缓存。 |
| 数据备份 | 导出设置与本地歌单资料，不包含账号、音频、封面、绝对路径或目录授权。 |
| 界面与更新 | 简中、繁中、英文，主题、100–150% 字号与动效偏好；手动检查 GitHub 更新，自动检查默认关闭。 |

## 使用额外音乐来源

1. 打开设置中的“管理音乐来源”，选择需要的音乐库连接。
2. 自建流媒体需要填写自己的服务器地址，再明确开启并登录该来源。开启开关本身不会连接服务；关闭状态下可先填写和保存地址。
3. 返回主界面后，从音乐来源选择器或侧栏选择已开启来源，再使用首页、音乐库或搜索。

Emby、Jellyfin 和 Navidrome 需要你已有可访问的服务器及账号；本应用不提供服务器或音乐资源。酷狗音乐库连接需要兼容的 API 服务地址，与自动音频匹配中的酷狗候选是不同入口。

各来源的接口要求、支持范围与自建服务器 HTTP 边界见[来源兼容说明](docs/PLUGIN_COMPATIBILITY.md)。

每个来源及附加服务器实例独立保存会话，不会自动合并账号。原版网易云和本地插件保留在“高级兼容入口”，供已有配置或原版流程使用；日常网易云与本机音乐无需开启这些兼容入口。演示来源位于开发区，默认关闭。

关闭来源会保留其账号、配置和插件内歌单。需要清除时，使用单独确认的“清除插件数据并关闭”；它只处理当前来源，不删除其他实例、主音乐库、共享缓存或手机原文件。外部导入插件与附加实例可单独删除。导入的 JavaScript 会作为插件执行，请使用可信来源的文件。

## 音频、歌词与评论来源

- **播放音源策略**：先使用已匹配的本机音频或完整缓存；需要在线取址时，先请求当前网易云账号可取得的官方完整音频。只有允许自动匹配且官方不可用时，才尝试其他候选，先确认歌曲匹配，再选择可用音质。设置展示实际候选集合与当前播放信息，候选集合不是固定的逐个播放顺序。
- **歌词与评论顺序**：分别决定关联歌曲的歌词、评论从哪里读取，不改变音频播放顺序。已关闭的音乐库来源不参与这些读取。
- **音乐库连接开关**：管理账号、歌单及插件功能。音频匹配使用独立候选，由“播放音源策略”中的开关控制；关闭一个库连接不等于关闭同名音频候选。

原生网易云和原版网易云兼容入口采用相同的取址规则，但账号、队列和缓存身份保持独立。本机文件及自建流媒体保留原来源，不会被自动换成网易云或其他平台音频。

登录成功不代表拥有所有歌曲的播放权限。实际可用内容、音质和功能取决于账号权限、地区、服务器和接口状态；本项目不提供或保证平台会员权益，也不保证任意第三方插件都兼容。

## 本机音乐与离线使用

- 授权文件夹后，应用只读取这些目录，不修改原音频。取消读取会释放目录授权；“从应用移除”保留原文件，扫描排除项可恢复。
- 纯音频 ZIP 可以仅按本地音频导入。主动补全在线资料需要联网和对应登录；失败仍保留本地音频，不自动改为在线播放。
- 桌面歌单包应由仓库内配套导出工具生成；已导入的旧包仍可读取。工具位于 [tools](tools/)。
- 缓存仅在对应内容已保存完整时保证离线读取；未播放或尚未完成的网络歌曲不会凭空变为离线歌曲。已缓存歌单资料与完整音频可在离线入口查看。
- CUE 支持同目录、单音频 `FILE`，保留原文件并生成虚拟分轨。多 `FILE`、相对子目录、缺文件或解析失败会回退整轨；CUE 曲目暂不显示整轨同名歌词。
- 滑条只能从滑块头部起拖，轨道空白可滚动页面；保留即时调节、松手保存、数值输入与键盘操作。

## 下载与安装

从 [1.2.1 Release](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.2.1) 下载 ARM64 正式安装包。

[本仓库 Releases](https://github.com/EBG-bg/VutronMusic-Android/releases) 提供以下文件：

```text
Vutron-Music-Mobile-1.2.1-arm64.apk
Vutron-Music-Mobile-1.2.1-arm64.apk.sha256
```

`.sha256` 用于校验安装包；GitHub 的 `Source code` 压缩包不是安装包。

主要目标为 Android 13 / HyperOS、ARM64。Android 15 平板模拟器已进行横竖屏、系统栏与部分播放交互检查，其他设备未全面验证。手动安装可能需要“安装未知应用”权限，悬浮歌词需要悬浮窗权限。

## 从旧版本升级与签名

旧仓库 [EBG-bg/VutronMusic](https://github.com/EBG-bg/VutronMusic) 已在 `1.0.2` 发布后归档。`1.0.2` 是更新源切换版本，此后只从本仓库检查更新，不回退旧仓库。

- `1.0.0 / 1.0.1` 可手动安装当前仓库的正式 APK，也可先升级至 `1.0.2` 再使用应用内更新。
- `1.0.2 / 1.1.0 / 1.2.0` 继续使用本仓库更新源，可通过应用内更新或手动下载正式 APK 升级至 1.2.1。
- 1.2.1 保留原包名与签名，支持覆盖升级；已保存资料按现有迁移规则保留，无需先卸载。

包名保持为 `io.github.vutronmusic.personal.webshell`。为兼容既有正式版本，继续沿用初始证书：

```text
Subject: C=US, O=Android, CN=Android Debug
SHA-256: d879659d80b689de9be73f419d3ccd01f4bee96f9725a08896b420037688d6d8
```

证书主题中的 `Android Debug` 是历史证书名称；正式安装包采用关闭调试的 Release 构建。更换证书将影响覆盖升级，本项目不会静默更换。若系统提示签名不一致，请先核对安装包来源与证书，不要为强行升级而直接删除现有资料。

## 应用内更新

- 自动检查默认关闭；开启后最多每 6 小时检查一次本仓库 Releases。
- 下载和系统安装仍需用户确认，并校验大小、SHA-256、包名、版本号和签名。
- 更新请求连接 GitHub，不发送音乐账号 Cookie；不会回退到旧仓库。
- 本地模式暂停自动检查，主动点击“检查更新”仍会联网。
- 没有新版本、没有可用 ARM64 安装包或网络失败时会给出对应提示。

## 隐私与数据

- 各来源账号会话保存在应用私有存储中，不随源码或 Release 分发。
- 本机音乐只读取已授权目录；缓存、封面、歌词和歌单资料保存在设备本地。
- JSON 备份不包含账号、Cookie、音频、封面缓存、绝对路径或目录授权；恢复后需要重新关联音频、重新授权目录。
- 卸载应用会删除应用私有资料；重装或更换设备前可先导出设置与本地歌单资料。

详见[隐私说明](legal/PRIVACY.md)、[使用说明](legal/USE_POLICY.md)和[再分发说明](legal/REDISTRIBUTION.md)。

## 构建

本仓库包含 Android 客户端、实际依赖的共享模块与运行库，不需要 Electron 桌面开发环境。源码来源见[迁移说明](docs/MIGRATION.md)。

需要 Node.js 22.16+、JDK 21、Android SDK Platform 35、Build Tools 35+，并设置 `JAVA_HOME`、`ANDROID_HOME` 或 `ANDROID_SDK_ROOT`。

```powershell
./scripts/build-mobile.ps1 -Configuration Debug -Edition Mobile
```

```sh
sh scripts/build-mobile.sh Debug mobile
```

产物位于 `apps/android-vutron/android/app/build/outputs/apk/`。Release 签名从以下环境变量读取：

```text
VUTRON_RELEASE_KEYSTORE
VUTRON_RELEASE_STORE_PASSWORD
VUTRON_RELEASE_KEY_ALIAS
VUTRON_RELEASE_KEY_PASSWORD
```

仓库不附带签名私钥。未提供签名配置时生成 unsigned APK，需要自行签名。

当前正式版本为 **1.2.1 / versionCode 47**。实际构建身份由版本配置生成，详细说明见 [Android README](apps/android-vutron/README.md)。

正式发布继续采用 `mobile-v*` 标签和固定资产名；本版使用 `mobile-v1.2.1` 与 `Vutron-Music-Mobile-1.2.1-arm64.apk`。

## 反馈与贡献

- Issue 和 PR 请提交到[本仓库](https://github.com/EBG-bg/VutronMusic-Android/issues)；桌面 Electron 版本的问题请访问[上游项目](https://github.com/stark81/VutronMusic)。
- 反馈时请尽量附上版本、设备和 Android 版本、复现步骤与相关日志。
- 不要公开账号 Cookie、签名媒体地址、本地音乐路径或设备标识；安全问题可通过 GitHub Security Advisory 私下报告。

## 暂未支持与边界

- 多 `FILE`、子目录路径和压缩包内 CUE 的自动分轨。
- 真正的无缝切歌；下一首预取只提前解析地址，不预下载音频。
- 原生网易云入口目前只提供歌曲评论；其他来源与实体的评论、MV、FM 等取决于插件和服务能力。
- 不保证桌面端任意插件、任意 API 服务或所有安卓设备均可使用；桌面 Electron 的窗口与系统集成功能也不会直接变成安卓功能。

## 项目与许可

- `apps/android-vutron`：Android 客户端与 Capacitor 原生适配。
- `packages`、`android/shared`、`vendor/android-runtime`：共享逻辑、网络适配与实际运行库。
- `scripts`、`tools`、`legal`：构建入口、桌面导出工具与许可材料。

根许可证为 MIT；包含 LGPL-3.0-only 等第三方组件。完整材料见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md)、[第三方许可](legal/THIRD_PARTY_LICENSES.txt)与[组件清单](legal/third-party-inventory.json)。本项目不附带账号、音乐文件或平台授权。

## 致谢

- [stark81/VutronMusic](https://github.com/stark81/VutronMusic)：原桌面播放器与上游代码。
- [jooy2/vutron](https://github.com/jooy2/vutron)：原始脚手架。
- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)：界面与设计参考。
- NeteaseCloudMusicApiEnhanced：网易云接口协议参考。
- [@unblockneteasemusic/server](https://github.com/UnblockNeteaseMusic/server)：备用音源匹配。
- 所有贡献者和第三方组件作者。

Android 适配与维护：**EBG-bg and contributors**。

## English summary

Vutron Music - Mobile is an unofficial Android port of [VutronMusic](https://github.com/stark81/VutronMusic), built with Vue 3, TypeScript, Pinia and Capacitor. The official release is **1.2.1 (versionCode 47)**, available from [Releases](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.2.1).

This update integrates enabled music sources into the main Home, Library and Search navigation, while keeping accounts and server instances separate. Built-in connections are provided with the app and can be turned on as needed. Emby, Jellyfin and Navidrome require your own server and account; third-party JavaScript compatibility depends on the plugin and service. Audio matching is independent of library connection switches and of lyric/comment priority lists. Local music, offline caches, queues, timed lyrics, speed/pitch controls and JSON backup remain available.

This project is not affiliated with the upstream author or any music provider, supplies no music accounts or files, and does not guarantee access to membership-only content. See [LICENSE](LICENSE), [NOTICE](NOTICE) and the [privacy statement](legal/PRIVACY.md).
