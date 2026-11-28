# 联网状态与悬浮歌词接口

以下 TypeScript 路径相对 `apps/android-vutron/src/`。原生桥接实现位于 `android/app/src/main/java/io/github/vutronmusic/personal/VutronMusicPlugin.java`，相对于 `apps/android-vutron/`。

## 网络状态与重试

`platform/vutronPlugin.ts` 中的 `VutronNetworkState`：

```ts
interface VutronNetworkState {
  enabled: boolean
  manual?: boolean
  connected?: boolean
  reason?: 'system' | 'unreachable' | null
}
```

- `enabled`：本地模式当前是否生效；`manual`：用户是否主动选择本地模式。
- `connected`：有效联网状态。`reason=null` 表示在线，`system` 表示系统没有可用联网状态，`unreachable` 表示真实请求失败后触发了离线熔断。
- `getLocalOnly()` 和 `musicNetworkChanged` 均提供上述状态；不要只根据设备连接了 Wi-Fi 或蜂窝网络判断应用可以联网。
- 新增可选桥接 `retryConnectivity(): Promise<VutronNetworkState>`，无入参，执行一次不携带账号资料的轻量探测，总截止时间为 3 秒。结果仍保留用户手动本地模式选择。

`stores/domains/authSession.ts` 实现并由 `stores/androidShell.ts` 导出：

```ts
retryConnectivity(): Promise<VutronNetworkState | undefined>
networkReason: 'system' | 'unreachable' | null | undefined
connectivityRetrying: boolean
connectivityError: string
```

调用前清除本次检查错误，重复点击不会并发发起 Store 请求，结束后恢复可重试状态。异常返回 `undefined` 并设置 `connectivityError`；探测正常完成但仍不通时返回离线状态。旧原生包缺少此桥接时，Store 兼容回退到读取网络状态。

网络切换、系统重新验证可解除熔断；应用回到前台且达到 30 秒冷却时间时自动复检。旧网络的迟到请求和探测结果不能覆盖当前网络状态。在线恢复不会擅自关闭手动本地模式。

## 歌单离线回退

`stores/androidShell.ts` 的 `openPlaylist()` 在在线读取失败且存在完整快照时，返回缓存曲目，并设置：

```ts
selectedPlaylist.offlineSnapshot === true
selectedPlaylist.offlineReason // 'system' | 'unreachable' | 'request'
selectedPlaylist.tracksIncomplete === false
selectedPlaylist.tracksLoadError === ''
```

`request` 表示在线读取失败，但尚未判定整个网络离线。无完整快照时保留错误或部分列表状态，不将部分结果标为完整离线歌单。手动切换模式或账号会拒绝迟到的旧请求结果。

## 悬浮歌词

`VutronLyricOverlaySettings` 新增 `motionPreference?: 'full' | 'system' | 'reduced'` 与兼容字段 `reducedMotion?: boolean`；非法 `motionPreference` 会以 `INVALID_OVERLAY_SETTINGS` 拒绝。`stores/domains/shellOverlay.ts` 已将应用内动效偏好与解析后的减少动效状态成对同步到原生，原生备份导入导出也会保持两者一致，无需新增重复设置入口。

前奏和歌词空白行显示曲名；自然切句时原文、译文与下一句预告共用同一轨道的上下滚动进度与边缘羽化遮罩。默认切句时长约 420ms；`full` 在系统关闭动画缩放时仍保留应用内与桌面歌词切句滚动，`system` 跟随系统动画缩放与减弱动画设置，`reduced` 关闭滚动动画。悬浮窗恢复首帧直接显示当前句，避免重新展示隐藏前的旧句。

## 界面对接

根据 `networkReason` 提供简中、繁中、英文的离线原因和离线快照提示；增加调用 Store action 的重试入口，检查期间避免重复提交。`networkReason`、检查 busy/error 为临时状态，不加入备份或持久化。
