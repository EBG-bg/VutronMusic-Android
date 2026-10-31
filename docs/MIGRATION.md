# Android 源码迁移

本仓库继续维护 Vutron Music - Mobile 的 Android 客户端。源码迁入基线为旧仓库最终正式版 1.0.2：

- 原仓库：<https://github.com/EBG-bg/VutronMusic>
- 对应标签：<https://github.com/EBG-bg/VutronMusic/tree/mobile-v1.0.2>
- 源码提交：`e09b23e51d0aeaed256a0354676d8f887096135a`
- 原始桌面项目：<https://github.com/stark81/VutronMusic>

迁入内容包括 Android 应用、原生适配、共享 core/ui、原图标／主题／词库、导出工具、生产运行库与 JNI、Java 兼容库对应源码、构建脚本、测试及许可材料。Android 的功能代码保持该基线；迁移只调整本仓库文档、仓库引用和 CI 分支。

这次迁移沿用新仓库已有的独立 Git 历史，不把旧仓库全部桌面代码和历史导入。旧仓库的源码、版权说明及历史 Release 仍保留；本仓库保留 `LICENSE`、`NOTICE`、`README.upstream.md` 和完整第三方许可。

当前源码版本配置保持 `1.0.2`、`versionCode 30`，用于标识迁入基线。本次不创建 1.1.0 标签、Release 或安装包发布；后续正式发布前统一修改版本并递增版本码。正式包沿用既有 applicationId 和签名，签名私钥不在仓库中。

1.0.2 已将应用内更新切到本仓库，并拒绝旧仓库的更新下载；新仓库暂无可验证的稳定包时只显示提示。旧仓库不再接收提交，现有用户仍可从它的历史 Release 安装 1.0.2。

开发构建与 CI 的 Debug 包用于检查源码，不能替代与已安装正式版相同签名的升级包。构建方法见 [Android README](../apps/android-vutron/README.md)，桌面歌单工具见 [tools/README.md](../tools/README.md)。
