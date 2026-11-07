# 界面基线检查

这里检查真实 Vue 页面，使用固定合成账号、曲目、封面和原生桥，不访问音乐服务，也不读取本机账号。界面固定使用 Mobile 品牌与版本标识。

## 运行

在 `apps/android-vutron` 中执行：

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run test:visual
```

基线使用锁定版本的 Playwright Chromium、Windows 和随测试提供的 Noto Sans SC 字体。GitHub Actions 的 `visual` 任务使用 Windows 2025，同样从 lockfile 安装；不使用自动更新的系统 Edge。当前基线用于 Windows 渲染，不作为 Android 系统界面、真机帧率或性能结论。

八组场景覆盖 320/360/390px、1024/1280px 横屏，浅深色、100%/150% 字号、简中/繁中/英文及三种动效偏好。设置、播放器、歌单库、歌曲菜单、插件管理各有一张截图。完整动效仍正常运行，等待布局稳定后截图；截图证明布局与绘制，拖动连续性、焦点和返回由现有交互检查覆盖。

图片位于 `baselines/`。基线不存在或图片超过允许差异时检查失败，运行不会自动接受新图。失败的实际图、差异图和报告放在仓库 `_analysis/visual-regression/`；CI 仅保留合成资料的失败报告。

## 更新经过确认的基线

改动布局或文案后，在同样环境运行：

```sh
npm run test:visual:update
```

逐张查看新图，确认变化与本次需求相符后，再保留对应基线。更新后重跑 `npm run test:visual` 验证。浏览器版本或字体版本变化也需要重新查看，不能直接批量接受新图来掩盖失败。

可在本地将 `VUTRON_VISUAL_PROBE` 设为 `1`，再使用以下命令筛选一个负例：

```sh
npx playwright test --project=phone --grep "settings$"
```

它会故意移动设置页面，预期产生失败和差异图，并把负例报告单独写入 `_analysis/visual-regression-probe/`；正常比较不会修改原基线。检查后取消该环境变量。该变量本身不筛选场景，普通完整运行会对全部八个设置场景执行负例。
