# 发版与「检查更新」

App 内置了更新检查：点「设置 → 检查更新」，或启动 2 秒后自动静默查一次。
数据源是**本仓库的 GitHub Releases**，不需要服务器。

## 已发布的版本

| 版本 | 时间 | 内容 | 资产 |
|---|---|---|---|
| `v0.1.0` | 2026-11-26 | 初始版本：界面原型 + WebView 壳 + 应用内更新 | `app-arm64-v8a-release.apk`（16.6MB）、`app-armeabi-v7a-release.apk`（14.1MB） |
| `v0.1.1` | 2026-11-26 | 全屏改为自动识别环境（App 内默认全屏、浏览器内不动），移除设置页的全屏开关 | 同上 |
| `v0.1.2` | 2026-11-26 | 修顶部状态栏空条（壳改 edge-to-edge、原生下发 --safe-top/--safe-bottom）、形状改圆润；占位功能的提示按用途分成「敬请期待 / 暂未开发 / 暂未开放」 | 同上 |

> 这台机器上 `github.com` 网页有时连不通（`000`），但 `api.github.com` 和
> `uploads.github.com` 是通的，所以发版可以全用 API 完成（见下）。

## 发一个新版本的完整流程

### 1. 改版本号

`flutter-shell/pubspec.yaml`：

```yaml
version: 0.1.1+2      # 前半是 versionName（界面上显示的），+ 后面是 versionCode
```

版本号规则：修 bug 加末位（0.1.1 → 0.1.2），加功能加中位（0.1 → 0.2），大改加首位。
**每次发版必须比上一次大**，否则用户端不会提示更新。

### 2. 打包

```bat
cd flutter-shell
sync-web.bat
flutter build apk --release --split-per-abi
```

产物在 `build\app\outputs\flutter-apk\`，要上传的是 **`app-arm64-v8a-release.apk`**。

### 3. 上传 Release

GitHub 仓库 → **Releases** → **Draft a new release**：

| 字段 | 填什么 |
|---|---|
| Choose a tag | 新建 `v0.1.1`（**必须是 `v` + 版本号**，程序靠它比对） |
| Target | `main` |
| Release title | 随便，如 `0.1.1` |
| Describe this release | **这里写的内容会原样显示在更新弹窗里**（支持 Markdown） |
| Attach binaries | `app-arm64-v8a-release.apk`（需要的话再传 `-v7a`） |

> ⚠️ 文件名里**必须有 `arm64`**，程序优先挑它；没有就退而取第一个 `.apk`。
> **不要勾 Pre-Release** —— 程序查的是 `releases/latest`，预发布不算。

### 4. 验证

手机上旧版 → 设置 → 检查更新 → 应弹出「发现新版本 0.1.1」+ 更新说明 → 立即更新 →
下载进度 → 系统安装界面 → 覆盖安装（数据保留）。

## 第一次上线怎么测整条链路

1. 把当前 `0.1.0` 的包发 Release：tag `v0.1.0`
2. 装上这个包 → 点检查更新 → 应提示「已是最新版本 0.1.0」
3. 把 `pubspec.yaml` 改成 `0.1.1+2` → 重新打包 → 发 Release `v0.1.1`
4. 手机上再点检查更新 → 这次应该真的走完下载 + 安装

## 用 API 发版（不用打开网页）

```bash
TOKEN=你的个人访问令牌          # 勾 public_repo 即可
R=Hiddenbook/dsh-whale-and-fish

# 1. 建 release
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/$R/releases \
  -d '{"tag_name":"v0.1.1","name":"0.1.1","body":"更新说明","draft":false,"prerelease":false}'

# 2. 传包（name 参数决定 asset 文件名，必须带 arm64）
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @app-arm64-v8a-release.apk \
  "https://uploads.github.com/repos/$R/releases/<release_id>/assets?name=app-arm64-v8a-release.apk"
```

## 实现位置

| 文件 | 作用 |
|---|---|
| `lib/update.dart` | 查 `api.github.com/repos/Hiddenbook/dsh-whale-and-fish/releases/latest`、比对版本、下载 apk |
| `lib/main.dart` | 启动静默检查、更新弹窗、下载进度、设置页「检查更新」的 JS 桥（`DshNative`） |
| `MainActivity.kt` | MethodChannel `installApk`，用 FileProvider + `ACTION_VIEW` 拉起系统安装器 |
| `AndroidManifest.xml` | `INTERNET`、`REQUEST_INSTALL_PACKAGES` 权限 + FileProvider 声明 |
| `res/xml/file_paths.xml` | 允许安装器读取 cache 目录里的 apk |
| `web/app.js` | 设置页「检查更新」→ 有 `DshNative` 就走原生，浏览器里只提示 |

## 几个坑

- **签名必须前后一致**：现在用 Flutter 模板的 debug 签名，换电脑或改正式签名后，
  老用户覆盖安装会失败（必须先卸载，数据会丢）。正式发布前先把 keystore 定下来。
- **仓库必须 public**：私有仓库的 Releases API 需要 token，token 放客户端等于公开。
- **`INTERNET` 权限**：Flutter 只在 debug/profile 的 manifest 里自动加，release 包必须自己声明，
  否则真机联网直接失败（已加）。
- **首次安装会弹「允许安装未知应用」**：系统行为，用户点一次同意即可，之后不再问。
- 下载走 GitHub 的 release 资源域名，国内可能慢；介意的话可以换自己的 OSS 地址
  （改 `update.dart` 里的 `downloadUrl` 来源即可）。
