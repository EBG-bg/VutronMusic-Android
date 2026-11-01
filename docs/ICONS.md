# 移动端图标

控件统一使用 OriginalIcon 的单色 mask，通常为 20 或 24 px。品牌图标保持上游原样。

| 用途 | 图标来源 | 当前入口 |
| --- | --- | --- |
| 排序 | 移动端新增 sort.svg | 歌单排序 |
| 拖动 | 移动端新增 drag.svg，两条圆角竖线 | 歌单拖动手柄 |
| 播放顺序 | 移动端 playback-repeat.svg / playback-repeat-one.svg / playback-shuffle.svg | 列表循环、单曲循环、随机播放按钮 |
| 本地目录 | 上游 folder.svg / local-music.svg | 本地目录与本机音乐 |
| 缓存 / 存储 | 移动端新增 storage.svg | 缓存设置 |
| 睡眠定时 | 移动端新增 timer.svg | 定时设置，替换此前借用的暂停图标 |
| 新建歌单 | 上游 plus.svg | 音乐库工具栏 |
| 检查更新 | 移动端新增 update.svg | 更新设置 |
| 空状态 | 移动端新增 empty.svg | 歌单空状态 |
| 错误 | 移动端新增 error.svg | 播放错误提示 |

新增图形使用圆角和一致的线宽，继承主题文字或强调色。不引入字体图标、emoji 或新图标依赖。

播放顺序图标使用有效的 SVG 根元素。上游 repeat.svg 与 repeat-1.svg 外层含 HTML span，不可直接作为图片 mask 加载；移动端补齐同一套 24 px、1.9 px 圆角线条图形，保留三种模式各自的辨识标记。
