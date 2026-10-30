# Debian 13 amd64 用户目录离线包

目标：Debian GNU/Linux 13.x、x86_64/amd64、系统 glibc 2.41。包含 Linux Node.js 24.22.1、从锁文件单独安装的 Linux GNU 原生模块（含 sharp/libvips）、固定 Noto 字体、Chromium 156.0.8078.4 revision 1248、FFmpeg，以及 Debian 浏览器共享库。使用宿主 Debian 的内核、POSIX shell/coreutils 和 glibc 基线，不安装或覆盖系统组件。

## 解压后直接运行

先核对压缩包外部 SHA-256，再以普通用户解压到有写权限、允许执行程序的目录：

```sh
sha256sum -c tweet-zh-compositor-0.1.3-debian13-amd64-offline.tar.gz.sha256
tar -xzf tweet-zh-compositor-0.1.3-debian13-amd64-offline.tar.gz
cd tweet-zh-compositor-0.1.3-debian13-amd64-offline
./self-check.sh
./start.sh
```

`self-check.sh` 先验证包内所有只读文件和符号链接，再实际生成测试 PNG。`start.sh` 通过同样的完整性检查和出图预检后，监听 `http://127.0.0.1:4317`。保持终端运行，Ctrl+C 停止。

```sh
./test-offline.sh
./render.sh --input examples/batch.json --out "$HOME/tweet-rendered" --mode preview
```

启动、预检、测试、渲染脚本不运行安装命令、不下载浏览器、不调用翻译 API。无需 sudo、Docker/Podman，不注册服务。Node、共享库和字体路径仅在当前脚本进程内设置，不修改系统环境。不会使用现有 Chromium 155 替代锁定版本。

## 文件及检查

- `runtime/node`：经 Node 官方 SHA-256 核对的 Linux Node；不依赖宿主 Node/npm。
- `node_modules`：按 linux/x64/glibc 从 package-lock.json 安装的包；不是 Windows node_modules 的复制品。
- `runtime/browsers`：固定 Chromium/FFmpeg 的 Linux 文件。
- `runtime/lib`：用户目录内的 Debian 共享库；glibc/动态加载器保留使用系统 2.41，避免覆盖系统 C 库。
- `assets/fonts`：固定 Noto 字体及许可；`runtime/fontconfig` 指定包内字体和用户目录字体缓存。
- `OFFLINE-BUILD-REPORT.json`：包版本、原生模块、Debian 包来源及 SHA-256、ELF 依赖闭包和构建验证范围。
- `OFFLINE-MANIFEST.json`、`SHA256SUMS`：文件哈希和符号链接清单；压缩包自身的哈希在包外 `.sha256` 文件。

`workspace`、`outputs`、`test-results` 和预检目录在运行后于当前用户目录内创建；原素材、草稿和真实输出不预置进包。六个测试样例会产生明确警告的预览，不能发布。

此文件随自行构建的离线包分发。构建报告记录来源哈希、Linux ELF 架构、链接目标和依赖闭包检查；静态检查不代表已在 Debian 上执行通过。请在目标机器断网后运行 `self-check.sh`、`test-offline.sh` 和六个样例，并按实际退出码及 PNG 结果报告。图形界面检查可在服务运行时，用包内 Node 执行 `scripts/ui-smoke.mjs`。

遇到缺失库或沙箱限制时，保留错误和 `OFFLINE-BUILD-REPORT.json`；不要通过联网补装、sudo 或更换浏览器版本掩盖离线验收问题。SHA-256 清单不包含之后生成的可变数据；需要改代码或模板时应重新构建离线包。
