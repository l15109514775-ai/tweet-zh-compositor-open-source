# 第三方许可与素材

根目录 MIT 许可证适用于本项目自有排版、校验、网页、CLI、构建/测试代码、自制几何测试素材及文档，不改变第三方组件的原许可证。

## 随源码提供的字体

- Noto Sans CJK SC Regular/Bold 2.004：SIL Open Font License 1.1；原文见 `assets/fonts/OFL-CJK.txt`，来源与文件哈希见 `assets/fonts/manifest.json`。
- Noto Color Emoji 2.051：SIL Open Font License 1.1；原文见 `assets/fonts/OFL-Emoji.txt`，来源与文件哈希同上。

字体文件未改名、未修改，不将字体文件改授 MIT。保留字体版权、许可和保留字体名称条款。

## 安装时或离线构建时下载的组件

Node.js、npm、Playwright、Chromium/FFmpeg、sharp/libvips、fontkit、Ajv、fflate 及其依赖适用各自许可证。`package-lock.json` 锁定 npm 依赖及完整性；安装后的每个包保留其版权和许可证文件。

Debian 离线构建脚本保留所提取包的 `copyright`、版本、下载来源和 SHA-256 到 `licenses/debian`、`OFFLINE-BUILD-REPORT.json`。这些第三方二进制不以本项目 MIT 重新许可。本公开仓库只提供构建脚本，未发布原私人离线包；如再分发完整运行时，请逐项满足适用许可，包含要求的版权声明、许可、源码或源码提供方式。

## 图片和账号

公开仓库里的头像、海报色块和版式示例由程序用自制测试数据生成，不对应真实账号。未分发原始用户参考截图、真实头像裁切或私人工作截图。用户另行导入的头像、配图和原帖截图不因使用本程序而改变权属或获得本项目许可。
