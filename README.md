# DSH · 鲸与鱼 · App 源文件

AI 陪伴类 App 的**界面原型**：手机尺寸的四个页面 + 聊天详情 + 设置等二级页，
纯 HTML / CSS / 原生 JS，没有框架、没有构建步骤、没有外链资源。

后来用 Flutter + WebView 把同一套页面装成了安卓 App，所以这里有两部分：
界面本身（`web/`）和外壳（`flutter-shell/`）。装好的 APK 在同级目录 `DHS·鲸与鱼 - 安装包/`。

## 目录

```
.
├─ web/                     ← 界面本体，双击 index.html 就能看
│  ├─ index.html
│  ├─ style.css
│  ├─ app.js                ← 假数据、渲染、所有交互都在这一个文件里
│  ├─ sw.js                 ← 离线缓存（只在 https / localhost 生效）
│  ├─ manifest.json         ← PWA：加到主屏幕后无地址栏
│  └─ assets/               ← 立绘、头像、应用图标
├─ docs/
│  ├─ DEV-NOTES.md          ← 页面结构、交互清单、自测记录、改过哪些地方
│  ├─ BUILD-APK.md          ← 打包成 App 的几条路线（Capacitor / PWABuilder / PWA）
│  └─ RELEASE.md            ← 发版流程 + 应用内「检查更新」怎么工作
├─ tools/
│  ├─ serve.py              ← 局域网静态服务，打印手机能访问的地址
│  └─ serve-phone.bat       ← 双击运行（Windows）
└─ flutter-shell/           ← Flutter 壳源码（WebView + 返回键 + 图标）
```

## 怎么看

**电脑**：直接双击 `web/index.html`。

**手机**（推荐，能看出真实手感）：双击 `tools/serve-phone.bat`，窗口里会打印
`http://192.168.x.x:8080` 这类地址，手机连同一个 WiFi 后打开即可。
服务关了缓存，改完代码手机上刷新就是新的。

## 更新机制

App 内置「检查更新」：读 GitHub Releases 的 `latest`，比版本号，有新版就下载 apk
并拉起系统安装器（覆盖安装，数据保留）。所以发新版不用再发文件给人，
只要在 Releases 里传包即可。细节见 `docs/RELEASE.md`。

## 装成 App

`flutter-shell/` 是 Flutter 壳的源码，编译出来就是 APK。
预编译包不在仓库里（见 Releases），构建步骤见 `flutter-shell/README.md`。

一个坑先说在前面：**Windows 下工程路径不能含中文**，否则会出现
`impellerc Could not write file` 或 `source file or directory not found` 之类莫名其妙的报错。

## 现在是什么状态

- 所有数据都是假的：会话、消息、动态、用量都在 `web/app.js` 顶部，等插件 / 后端接
- 发消息是本地模拟：0.9 秒后返回固定回复；断网时消息会标红感叹号，点一下重发
- 计价按 ¥0.9 / 千 token 估算，只影响界面上的数字
- 峰谷倒计时按**北京时间固定 UTC+8** 计算，纯本地，断网照走
- 详情见 `docs/DEV-NOTES.md` 里的「假数据在哪」「自测结果」

## 许可

个人项目，未选开源协议。
