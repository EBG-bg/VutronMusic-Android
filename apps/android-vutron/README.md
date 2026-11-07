# Vutron Music - Mobile Android

Vutron Music - Mobile 的 Android 开发与构建说明。当前正式版本为 [1.2.1 / versionCode 47](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.2.1)。使用介绍、用前须知和发行状态见[仓库首页](../../README.md)，源码来源见[迁移说明](../../docs/MIGRATION.md)。

## 技术与目录

界面使用 Vue 3、TypeScript、Pinia 和 Capacitor 7，原生适配负责媒体播放、文件夹授权、缓存、通知与悬浮歌词。Android 不运行 Electron 桌面窗口；构建也不需要 Electron 开发环境。

- `src/App.vue`、`stores/androidShell.ts`：主导航及播放界面。额外音乐库接入同一首页、音乐库和搜索，不再另开一套主导航。
- `src/plugins/useMusicSources.ts`：来源目录和选择状态。目录读取与来源开关只操作元数据，不执行关闭来源的插件代码。
- `src/components/PluginLibraryView.vue`、`src/plugins/usePluginLibrary.ts`：复用来源列表、搜索、实体详情和原有操作；按来源、页面与账号范围保留短期内存快照，不写入备份。
- `src/stores/domains`：原生账号、本机音乐与网易云歌单等领域逻辑；`src/components` 保留共享控件与弹层。
- `android/app/src/main/java`、`../../android/shared`：Capacitor 桥与原生适配。
- `../../packages/plugin-api`、`../../packages/plugin-runtime-deps`、`../../vendor/android-runtime`：原版插件接口、实际运行库与安卓宿主适配。

原生网易云账号和本机音乐继续使用原有入口。原版网易云、本地插件作为高级兼容入口保留，账号不会自动迁入原生入口。

## 环境与开发

需要 Node.js 22.16 或更新的受支持版本、JDK 21、Android SDK Platform 35 与 Build Tools 35+。设置 `JAVA_HOME` 以及 `ANDROID_HOME` / `ANDROID_SDK_ROOT`。

```sh
cd apps/android-vutron
npm ci --ignore-scripts
npm run typecheck
npm run dev
```

在仓库根目录构建公开的 Mobile 身份：

```powershell
./scripts/build-mobile.ps1 -Configuration Debug -Edition Mobile
```

```sh
sh scripts/build-mobile.sh Debug mobile
```

构建入口依次准备插件接口与运行库、执行 Vue 类型检查、Vite 构建、Capacitor 同步和 Gradle。产物位于 `apps/android-vutron/android/app/build/outputs/apk/`。只克隆 `apps` 子目录不能构建：共享模块、原图标与主题、`android/shared`、`vendor/android-runtime` 和法律资源都是输入。

开发使用 Vite 7，网页输出保持 ES2020 / Chrome 87 目标。依赖版本和定向覆盖由各模块的锁文件与构建脚本管理；更新依赖后应同时检查网页、Capacitor 桥与实际运行库，不能只验证桌面 Node。

## 版本与 Release 签名

1.2.1 的发行身份为 `versionName 1.2.1`、`versionCode 47`；发布标签为 `mobile-v1.2.1`，资产为 `Vutron-Music-Mobile-1.2.1-arm64.apk` 及同名 `.sha256` 文件，可从 [1.2.1 Release](https://github.com/EBG-bg/VutronMusic-Android/releases/tag/mobile-v1.2.1) 下载。

实际身份由 `package.json`、`mobile-release.json` 与构建入口生成，并由 Gradle 校验。不要只修改显示文字或手工替换网页中的版本号。

Gradle 从以下环境变量读取 Release 签名；值不得写入源码或提交：

- `VUTRON_RELEASE_KEYSTORE`：现有签名库的绝对路径。
- `VUTRON_RELEASE_STORE_PASSWORD`：签名库密码。
- `VUTRON_RELEASE_KEY_ALIAS`：别名。
- `VUTRON_RELEASE_KEY_PASSWORD`：可选，缺省同签名库密码。

```powershell
./scripts/build-mobile.ps1 -Configuration Release -Edition Mobile
```

未配置签名时生成 unsigned release APK，需自行签名后安装。仓库不附带签名私钥。覆盖升级要求保持 applicationId `io.github.vutronmusic.personal.webshell` 与原签名，并使用递增 versionCode。

1.2.1 与已发布的 1.2.0、1.1.0、1.0.0 / 1.0.1 / 1.0.2 继续使用同一证书：

```text
Subject: C=US, O=Android, CN=Android Debug
SHA-256: d879659d80b689de9be73f419d3ccd01f4bee96f9725a08896b420037688d6d8
```

`Android Debug` 是历史证书主题，与 APK 是否可调试是不同信息。正式包使用关闭调试的 Release 构建，不开启 WebView 调试。证书主题或有效期不能单独证明密钥来源；若更换证书，必须另外说明签名轮换或重新安装、数据迁移方式，不能静默替换。

## 来源、账号与能力

内置来源随安装包提供。新登记连接默认关闭；升级保留已有开关、账号和附加实例。外部 JavaScript 仍可显式导入，附加实例和外部插件可删除。可用方法以插件实际声明及宿主能力过滤为准，不把无条件返回的占位接口当作完整功能。

关闭来源时，读取、登录、二维码和退出等插件调用被拒绝，其来源 Worker 停止。开关本身不联网；关闭状态填写地址只更新该实例本机存储，下次明确读取时再使用新配置。共享 Node 运行时可能仍供其他来源或自动音频匹配使用，因此不将关闭单个来源解释为整个 Node 进程立即退出。

“清除插件数据并关闭”需要确认，只清当前来源正常私有路径中的账号、配置和插件内资料，不清主音乐库、其他实例、共享音频缓存或原文件。历史孤立状态会被隔离而不挂载；此操作不承诺安全擦除所有历史隔离副本。

Emby、Jellyfin、Navidrome 依赖用户自己的服务器、账号和接口版本。酷狗音乐库连接需要兼容 API 服务。来源是否提供推荐、搜索、歌单写操作、评论、MV 或 FM，由实际能力决定；支持原版接口不等于任意桌面插件、第三方代码或平台服务都可运行。

平台及 API 差异见[来源兼容说明](../../docs/PLUGIN_COMPATIBILITY.md)。

原生网易云歌单写操作使用 `OnlineLibraryManager` / `NeteaseApi`，不为这些操作启动 Node 插件运行时。原生喜欢状态单独读取 `likelist`；插件内喜欢状态按实例和账号读取可确认的列表，不能确认时保留未知状态。写操作禁止重复提交，旧账号读取失效；未确认或刷新失败时保留原界面资料。

## 播放策略与网络边界

原生网易云与已验证的原版网易云实例共用完整音频取址规则：已匹配本机音频或独立完整缓存优先；在线先请求当前入口账号的官方完整音频；仅在官方不可用且允许自动匹配时使用既有备用匹配规则。匹配先确认歌曲身份，再选择可用音质。账号、队列和缓存身份仍按入口及实例隔离。

播放策略卡展示运行时共用 `source-policy.json` 中的真实候选集合，不提供手动音频排序。音乐库连接开关管理账号、歌单和插件功能，不能用它悄悄禁用同名备用音频候选。歌词与评论分别按自己的优先级读取，关闭来源不参与；这两份顺序不控制音频取址。其他平台与自建流媒体继续使用自己的音频来源。

Android 默认禁止任意明文连接。网易云及自动音频匹配的旧 HTTP 媒体兼容代理，会限制目标和转发头，不向任意地址转发网易云账号会话。**自建流媒体是另一条边界**：用户明确配置的内网或 HTTP 服务器可以使用，认证头按当前来源实例及目标范围处理。不能把旧兼容代理的“拒绝私网”规则，或“不转发网易云 Cookie”，概括为全部插件网络请求的行为。HTTP 服务链路不保证端到端加密，服务器选择和认证规则需按来源区分。

本机文件及已完成缓存播放不会仅为音频兜底启动 Node。来源信息、错误日志和诊断不得包含可复用 Cookie、完整认证地址或本机绝对文件路径。更多数据处理说明见[隐私说明](../../legal/PRIVACY.md)与[使用说明](../../legal/USE_POLICY.md)。

## 本机音乐、缓存与备份

本机目录使用 SAF 授权，可选择多个文件夹。扫描只读原文件；移除目录释放授权，重新选择后可再扫描。扫描失败或子目录读取失败时保留该目录旧索引；只有成功扫描到空目录才清空。成功目录仍可更新，手动重新扫描不受自动重试等待限制。

“从应用移除”只移除索引或歌单条目。扫描曲目写入排除项，设置可恢复；删除导入歌单只删除应用私有副本。扫描和导入有进度及取消，取消扫描不提交半截索引。

列表按每批 80 项渐进呈现，分页不截断实际播放队列。本机及缓存歌曲支持排序；继续加载会增加 DOM，目前不宣称已经实现固定窗口虚拟化。

歌单资料、封面和歌词可保存在设备中；音频缓存只在下载完整后作为完整离线音频使用。缓存有容量限制和单项删除，当前播放项删除前需处理播放状态。来源缓存和账号身份保持隔离，未缓存内容不因切换离线而自动可用。

JSON 备份保存界面、歌词、音量及本地歌单资料和顺序；队列可作为资料歌单保存。账号、Cookie、缓存音频、封面、绝对路径和目录授权不导出。恢复保留现有库，重新授权目录或导入原包后按唯一匹配关联音频；不能确认的曲目保持待关联，不自动替换成在线歌曲。

单次 JSON 导入限制为 8 MiB，本机累计恢复资料限制为 64 MiB。恢复前检查合并后的完整资料，超限保留原资料，不提交本次恢复。系统备份采用指定设置白名单，不等同于本地歌单和音频的手动导出；恢复后仍需重新授权目录。

桌面导出工具位于 [tools](../../tools/)，提供 GUI 与 CLI，可读取已登录网易云账号的歌单。新歌单包校验导出来源，已导入旧包仍可读取。普通音频 ZIP 可选择仅本地导入，或登录后补全在线资料；失败不会替换本地音频。

## 歌词、评论与播放控制

共享核心 `packages/core/src/lyrics.ts` 与原生 `LyricTimeline` 支持 LRC、增强 LRC、WRC 和 YRC，统一为现有词时间结构。真实词时间优先，估算逐字默认关闭；同名 `.eslrc` / `.lrc` 保留编码兼容和 256 KiB 限制，翻译配对、offset 与 seek 使用同一时间线。

本地 CUE 支持同目录、单音频 `FILE`，以 `INDEX 01` 创建虚拟曲目，保留整轨文件。分轨拥有独立进度、音量、排除项和队列身份。坏 CUE、缺文件、多 `FILE`、相对子目录或超限内容回退整轨；CUE 曲目暂不显示整轨同名歌词。目录文本暂存上限按 UTF-16 占用计 2 MiB，匹配后用真实时长完整解析，不重复解析整个目录。

原生网易云入口提供歌曲评论；来源插件可按各自能力提供歌曲或其他实体评论、MV、FM 等，不能承诺全平台一致。评论按纯文本显示，原生歌曲评论每页 30 条，自动追加到 300 条后保留手动继续加载；楼层回复手动加载并可收起，不因收起丢失已载内容。

播放页右上角提供 0.5–2.0× 倍速与音高控制，显示设定值及当前实际生效值；设备或编码不支持时解释兼容回退。歌词按实际速度推进，切后台等生命周期会提交尚未松手的改动。设置页不重复摆放这组播放控件。

Wi-Fi 下一首地址预取位于缓存设置，默认关闭。在接近曲尾时只解析下一首地址及所需来源头，短暂保留内存；队列、模式、网络或来源变化会失效，不预下载音频，也不承诺无缝播放。

睡眠定时、通知、悬浮歌词及耳机断开暂停由原生适配处理。耳机重新连接不主动恢复；不同厂商的权限、后台和音频事件行为仍需设备验证。

## 界面与更新验证

国际化使用原版 vue-i18n Composition API 和三语词库；移动端词条在 `src/locales` 与 `src/plugins/locales`。简中、繁中和英文可立即切换并保存。歌曲、歌单名称、歌词和构建品牌不作界面翻译；缺失译文回退中文，部分服务原始错误可能保留来源语言。

界面使用共享主题、图标、选择器、滑条、折叠卡片和弹层。新增动效须遵守完整、跟随系统和减少动效三种设置；拖动即时反馈，关闭后恢复焦点与返回层级。屏幕截图与实际动效、Android 运行是不同验证范围。

```sh
cd apps/android-vutron
node --test
npm run typecheck
npx playwright install chromium
npx playwright test
```

固定像素基线使用 Windows、锁定的 Playwright / Chromium 与字体夹具。修改界面时先查看预期差异再更新对应基线；不应为使测试通过而批量接受未知变化。字体和浏览器测试依赖仅供开发，不作为应用运行库分发。

应用内更新只读取本仓库符合契约的 Mobile ARM64 Release。自动检查默认关闭，本地模式暂停自动检查；明确手动检查可以联网。下载后验证大小、SHA-256、包名、版本码、证书及通道，再调用 Android 安装器。构建不附带 GitHub token，也不向 GitHub 发送音乐账号 Cookie，不会回退旧仓库。

“关于”页面的版本和品牌来自同一构建身份；隐私、使用和许可文本可离线读取。法律资源位于 APK 的 `assets/legal`，运行库原许可证随 `assets/sources-runtime` 分发。

## 兼容性与许可

主要目标为 Android 13 / HyperOS ARM64；Android 15 平板模拟器已进行定向横竖屏、系统栏、播放恢复与更新安装检查。最低声明为 API 23，标准库降级使用 `desugar_jdk_libs_nio` 2.1.5；这些配置不等于所有旧设备或厂商系统已完整验收。

Release 当前保持 R8 / 资源收缩关闭。涉及 Capacitor 反射与 JNA 的裁剪需要另行建立保留规则并验证，不能仅凭包体变小判断功能保持完整。

项目为非官方移植，不附带音乐文件、账号、平台会员权益或服务背书。许可见根 [LICENSE](../../LICENSE)、[NOTICE](../../NOTICE)、[第三方声明](../../THIRD_PARTY_NOTICES.md)、[第三方许可](../../legal/THIRD_PARTY_LICENSES.txt)和[再分发说明](../../legal/REDISTRIBUTION.md)。
