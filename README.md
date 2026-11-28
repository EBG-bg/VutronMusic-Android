<div align="center">
  <img src="src/renderer/assets/images/vutronmusic-icon.png" width="84" height="84" alt="Vutron Music - Mobile 图标" />
  <h1>🎵 Vutron Music - Mobile</h1>
  <p>基于 <a href="https://github.com/stark81/VutronMusic">VutronMusic</a> 的非官方 Android 音乐播放器，支持在线音乐库、本机文件与离线播放。</p>
  <p>
    <a href="https://github.com/EBG-bg/VutronMusic-Android/releases"><img src="https://img.shields.io/badge/Release-v1.4.1-2ea44f?style=flat-square" alt="Release v1.4.1" /></a>
    <img src="https://img.shields.io/badge/Android-6.0%2B%20(ARM64)-3ddc84?style=flat-square" alt="Android 6.0+ ARM64" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT%20%2B%20LGPL--3.0--only-blue?style=flat-square" alt="License" /></a>
  </p>
  <p>
    <a href="https://github.com/EBG-bg/VutronMusic-Android/releases"><strong>⬇️ 下载安装包</strong></a> ·
    <a href="CHANGELOG.md">📝 更新记录</a> ·
    <a href="apps/android-vutron/README.md">🛠️ 使用与构建说明</a> ·
    <a href="#faq">❓ 常见问题</a>
  </p>
</div>

> [!NOTE]
> 本项目与上游作者及各音乐平台均无官方隶属或背书关系，不提供任何音乐资源、账号或平台会员权益。

## 📌 用前须知

本移植为纯 vibe-coding 项目，移植代码 by 6.1sol，检查与建议、改进 by deepseek v4.1 1017、6 astra、gemini 4 neon/hydrogen 和我自己。

移植中塞了比较多私货，主要是添加了我想用的功能和小部分ai觉得可以优化的功能。

因本人为学生，所以大部分优化、Issue 和 PR 会在周末或假期处理和更新。

## ✨ 主要功能

| 模块 | 说明 |
| --- | --- |
| ☁️ 在线音乐库 | 网易云扫码 / Cookie 登录、推荐、搜索、歌单与评论；支持弱网自动熔断、手动“重新检查网络”与歌单离线快照；可选酷狗及 Emby、Jellyfin、Navidrome 等来源，账号与服务器实例独立。 |
| 📂 本机与离线 | 多文件夹（SAF 授权）、音频 ZIP、桌面歌单包、单文件 CUE 分轨；自动缓存歌曲、歌单资料、封面和歌词，支持容量管理；无需账号也可进入“仅本地模式”。 |
| 📃 歌单与队列 | 列表 / 卡片布局、排序与续播；自定义顺序预览、命名和永久保留，长按拖选、多选入队、下一首插队、可撤销移除；支持指定单曲播放音源并选择立即重播或下次生效。 |
| 🎛️ 播放工具 | 循环 / 随机、倍速与音高调节、单曲和歌单独立音量、A/B 区间循环、睡眠定时及淡出、恢复播放进度。 |
| 🎤 歌词与悬浮窗 | 原文与译文滚动、真实逐字、逐曲延迟；桌面悬浮歌词整轨上下滚动与边缘渐隐，可调位置、颜色、透明度与阴影；外观“完整动效”可绕过系统 `0x` 动画限制（估算逐字默认关闭）。 |
| 🎨 界面与数据 | 简中 / 繁中 / 英文即时切换、主题强调色、大字号（100%–150%）与滑动导航；支持密码保护账号的 JSON / ZIP 备份（含大缓存空间校验与失败回退）、GitHub 更新检查。 |

## 📱 设备与权限要求

- **系统与架构**：**Android 6.0 及以上**（`minSdk 23` / `targetSdk 35`），当前仅提供 **ARM64（`arm64-v8a`）** Release 安装包，暂不支持纯 32 位旧设备或未转译的 x86 环境。
- **按需使用的权限**：
  - **显示在其他应用上层（悬浮窗）**：仅在开启桌面悬浮歌词时申请。
  - **通知权限**：用于系统媒体播控栏、悬浮歌词 30 秒临时隐藏恢复与定时状态通知。
  - **允许安装应用**：仅在应用内手动更新并准备安装 APK 时引导开启。
  - **本机目录读取**：使用 Android 系统文件选择器（SAF）只读已授权目录，不索取全盘存储权限。

## ⬇️ 下载与升级

在 [Releases](https://github.com/EBG-bg/VutronMusic-Android/releases) 下载 **ARM64 `.apk`**；同名 `.sha256` 文件用于校验，`Source code` 为源码包。

保留原包名与签名，支持覆盖升级，无需先卸载。证书主题 `Android Debug` 为历史名称，安装包使用关闭调试的 Release 构建；完整指纹见 [Android 说明](apps/android-vutron/README.md)。旧 `1.0.0 / 1.0.1` 可手动升级，`1.0.2` 及后续版本使用本仓库更新源。

自动检查更新默认关闭，本地模式不自动检查；主动点击“检查更新”仍会联网请求 GitHub Releases。

## 📖 使用说明

- **额外音乐来源**：在设置的“管理音乐来源”开启来源后，可从侧栏或顶部切换。酷狗默认可直接扫码；Emby、Jellyfin、Navidrome 需要自己的服务器和账号。各来源能力及音频、歌词、评论差异见[来源兼容说明](docs/PLUGIN_COMPATIBILITY.md)。
- **本机与离线**：本机音乐只读取授权目录，“从应用移除”不会删除手机原音频。网络歌曲需完整缓存后才能离线播放；桌面歌单包使用[配套导出工具](tools/README.md)生成。
- **备份与迁移**：JSON 备份默认保存设置与本地歌单资料；勾选敏感选项并二次确认后，可用密码加密保存账号和网络隐私设置（密码仅保护账号资料）。ZIP 备份可一并打包已完成的离线缓存；目录授权及本机原始音频不随备份导出，换机后需重新授权目录关联文件。
- **使用边界**：在线内容、音质及功能取决于账号权限和接口状态，本项目不提供音乐资源或会员权益。具体规范与数据处理见[使用说明](legal/USE_POLICY.md)及[隐私说明](legal/PRIVACY.md)。

<a id="faq"></a>

## ❓ 常见问题

<details>
<summary>点击展开常见使用问题解答（桌面歌词不动 / 弱网断线 / 安装与后台）</summary>

1. **为什么开启了悬浮歌词，切句却没有上下滚动动画？**
   若你在系统“开发者选项”或“无障碍”中关闭了动画（动画时长缩放设为 `0x`），跟随系统模式会按系统设置跳过动画。前往应用 **设置 → 外观与强调色 → 界面动效**，将其切换为「**完整动效**」，即可让应用内与桌面悬浮歌词独立保持滚动动画。
2. **手机有信号或连着 Wi-Fi，但实际没网，一直加载失败怎么办？**
   请求不可达时应用会自动熔断切入离线状态，并保留你的登录状态与本地/离线歌单快照。网络恢复后会自动复检切回，也可以在歌单页面或设置里点击「**重新检查网络**」手动恢复。
3. **锁屏或切到后台后桌面歌词消失、播歌被杀怎么办？**
   请确认已授予系统「显示在其他应用上层」与通知权限，并在手机系统的电池优化 / 后台管理策略中允许应用后台运行（各手机厂商后台策略不同，权限与保活表现以本机实测为准）。
4. **下载后提示“安装包损坏”或“与现有应用签名冲突”？**
   本仓库正式版均保留原包名与 `D879` 证书；若先前装过其他包名版本、自定义签名版或较早的历史测试包，需先导出 JSON / ZIP 备份后卸载再重装。

</details>

## 💬 反馈

问题和建议请提交到 [Issues](https://github.com/EBG-bg/VutronMusic-Android/issues)，附上**版本号、手机型号 / Android 版本和复现步骤**；分享日志或截图前请务必移除账号凭据、媒体签名地址与本机个人路径。桌面版问题请反馈到上游仓库。

## ❗ 关于预览版
从1.4.2更新后正式版将降低更新频率约3-4周一更  您可体验预览版 但不对功能及前端做保证 回退或更新正式版失败可能有导出数据重新下载的风险  目前1.4.1版本还未评估

## 📄 许可与致谢

基于 [stark81/VutronMusic](https://github.com/stark81/VutronMusic) 与 [jooy2/vutron](https://github.com/jooy2/vutron)，感谢上游作者及所有第三方组件贡献者。Android 适配与维护：**EBG-bg and contributors**。

根许可证为 MIT，包含 LGPL-3.0-only 等第三方组件。详见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md)及[再分发说明](legal/REDISTRIBUTION.md)。

## 🌐 English summary

An unofficial Android port (Android 6.0+, ARM64) of [VutronMusic](https://github.com/stark81/VutronMusic) featuring online music libraries, local/offline playback, custom playlists, synchronized & floating desktop lyrics, and playback tools. Download the signed ARM64 APK from [Releases](https://github.com/EBG-bg/VutronMusic-Android/releases); see [Android documentation](apps/android-vutron/README.md) for architecture and build instructions. This project is not affiliated with music providers and supplies no music accounts, files or membership access.
