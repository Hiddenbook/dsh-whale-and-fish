# flutter-shell —— 把网页装成 App 的外壳

这里只放**源码**，没有 `build/`、`.dart_tool/`、`android/.gradle/`、`local.properties`，
所以克隆下来不能直接 build，需要先补三样东西（见下）。

```
flutter-shell/
├─ lib/main.dart                 WebView 壳：加载 assets/web、返回键、状态栏、竖屏、更新弹窗
├─ lib/update.dart               查 GitHub Releases、下载 apk、拉起安装器
├─ pubspec.yaml / pubspec.lock   依赖：webview_flutter、flutter_launcher_icons
├─ test/widget_test.dart         冒烟测试：确认网页资源真的被打进包里
├─ android/
│  ├─ app/src/main/              AndroidManifest（应用名「鲸与鱼」、竖屏）、MainActivity、图标 mipmap
│  ├─ build.gradle.kts           仓库换成了阿里云镜像
│  ├─ settings.gradle.kts        同上
│  ├─ gradle.properties          jvm 参数、并行、Gradle 缓存
│  └─ gradle/wrapper/            Gradle 8.12（distributionUrl 指向腾讯镜像）
└─ sync-web.bat                  从 ..\web 同步网页文件到 assets\web
```

## 重建步骤

```bat
:: 1. 放到纯英文路径下（重要，见下面的坑）
cd /d E:\some\ascii\path\flutter-shell

:: 2. 补出缺失的工程文件（android/gradlew、android/app/src/debug 等）
flutter create . --platforms android --org cn.jingyuyu --project-name dsh_whale

:: 3. 装依赖 + 同步网页
flutter pub get
sync-web.bat

:: 4. 出包
flutter build apk --release --split-per-abi
```

产物：`build\app\outputs\flutter-apk\app-*-release.apk`

## 必须注意：路径里不能有中文

在 Windows 上，Flutter / AGP / Kotlin 遇到中文路径会失败，而且报错信息很误导：

| 现象 | 原因 |
|---|---|
| `impellerc ... Could not write file ...ink_sparkle.frag` | 工程路径含中文 |
| `source file or directory not found: C:\Users\u9053u5495u565Cu9053\...` | `PUB_CACHE` 指在中文目录下 |

所以这个仓库建议 clone 到 `D:\code\...`、`E:\src\...` 这类纯英文路径再构建；
本机就是把工程放在 `E:\Hermit_MoShu\3\DSH_whale` 打出来的。

## 还需要本机环境

- Flutter 3.35+（Dart 3.9）
- **JDK 21**（Gradle 8.12 不认 JDK 25）
- Android SDK：`platform-tools`、`platforms;android-35`、`build-tools;35.0.0`、`cmdline-tools;latest`
  （首次构建会自动补 NDK 27 和 CMake 3.22，约 2.3GB）

`flutter doctor` 里 `Android toolchain` 变绿即可，不必装 Android Studio。

## 应用内更新

`kRepo` 常量在 `lib/main.dart` 顶部（`Hiddenbook/dsh-whale-and-fish`）。
查的是 `releases/latest`，比对 `pubspec.yaml` 里的 version，有新版就下载并拉起系统安装器。

发版流程见 `../docs/RELEASE.md`。要点：

- tag 必须是 `v0.1.1` 这种格式
- 上传的 apk 名字里要有 `arm64`
- 不要勾 Pre-Release
- 签名要前后一致（现在是 debug 签名）

## 说明

- `assets/web/` 不在仓库里，由 `sync-web.bat` 从 `../web` 生成 —— 网页只维护一份
- 当前 APK 使用 Flutter 模板默认的 **debug 签名**，能装能跑，上架商店前要自己配 keystore
