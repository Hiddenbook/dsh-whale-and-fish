# 打包成 App（离线可用）

## 先明确一点

这个项目是**纯静态前端**（`index.html` / `style.css` / `app.js` / `assets/`），没有后端、没有网络请求，
所以「离线能进去」本身是成立的 —— 只要这些文件已经在设备上：

| 方式 | 离线能开 | 说明 |
|---|---|---|
| 双击本地文件 | ✅ | 电脑上可以，手机拷过去不推荐（iOS 的 `file://` 限制 `localStorage`） |
| 局域网 `http://IP:8080` | ❌ | 文件在电脑上，手机断网就连不上 |
| **PWA（加到主屏幕）** | ✅ | 需要 **HTTPS**（`sw.js` 才会生效），局域网 `http` 不行 |
| **APK（Capacitor / PWABuilder）** | ✅ | 资源打进安装包，最接近「真 App」 |

消息的「离线 → 红色感叹号 → 点击重发」逻辑**已经写好了**（见文末），跟打包方式无关。

---

## 路线 A'：Flutter 壳 + WebView（**已落地，见 `../flutter_app/`**）

你的机器上已经装了 Flutter（`E://Hermit_MoShu//3//Flutter_SDK//flutter`，3.35.5），
所以实际采用的是这条：Flutter 只当容器，网页原样塞进 `assets/web/`，系统返回键接给网页 history。

```
cd flutter_app
flutter pub get
flutter build apk --release     # 需要先装 Android SDK（当前缺）
```

改了网页之后双击 `flutter_app\同步网页.bat` 再重新构建。细节见 `flutter_app/README.md`。

---

## 路线 A：Capacitor 打 APK（备选）

### 前置

- **JDK 17 或 21**（AGP 不支持 25，本机现在是 25，需要另装一个）
- **Android Studio**（自带 SDK / Gradle），或命令行装 `cmdline-tools` + `platform-tools` + `build-tools`

### 一、把网页资源整理成 `www/`

Capacitor 要求一个「只放网页文件」的目录。**不要把 `node_modules` 一起塞进去**：

```powershell
cd E:\Hermit_MoShu\1\DHS·鲸与鱼
mkdir www
copy index.html,style.css,app.js,sw.js,manifest.json www\
xcopy assets www\assets /E /I
```

### 二、初始化

```powershell
npm init -y
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/android
npx cap init "鲸与鱼" com.dsh.whale --web-dir=www
npx cap add android
npx cap sync
```

### 三、出包

```powershell
npx cap open android     # 打开 Android Studio → Build → Build APK(s)
# 或者命令行：
cd android
.\gradlew assembleDebug
# 产物：android\app\build\outputs\apk\debug\app-debug.apk
```

改成网页后要重新同步：`npx cap sync`（`www/` 里的文件被拷进 `android/app/src/main/assets/public/`）。

### 四、让系统返回键走 WebView 的 history

页面里已经用 `history` 压好了栈（首页→一级页→二级页），但原生壳默认会把返回键当成「退出 App」。
Capacitor 里加一段监听即可：

```js
// 装 @capacitor/app 后
import { App } from '@capacitor/app';
App.addListener('backButton', ({ canGoBack }) => {
  if (canGoBack || window.history.length > 1) window.history.back();
  else App.exitApp();
});
```

这样就是：二级页返回上一页 → 一级页返回首页 → 首页才退出 App。

### 装到手机

APK 传到手机（数据线 / 微信文件传输 / 局域网下载）→ 允许「安装未知来源」→ 装。

---

## 路线 B：PWABuilder（云端一键出 APK，最省事）

1. 先让页面有一个 **HTTPS 地址**（任选）
   - GitHub Pages / Vercel / Netlify 部署这个文件夹
   - 或本机跑 `cloudflared tunnel --url http://localhost:8080` / `ngrok http 8080` 得到临时 https 域名
2. 打开 <https://www.pwabuilder.com>，粘网址 → 它会读 `manifest.json` → **Package for stores → Android**
3. 下载生成的包（本质是 TWA，外面套一层 Android 壳），装到手机

优点：不用装 Android Studio。缺点：包名/签名由它生成，上架商店要再处理。

---

## 路线 C：PWA 加到主屏幕（最快，验证离线用）

需要 **HTTPS**（`localhost` 也算安全上下文，但手机访问不到电脑的 localhost）。

- **iPhone Safari**：打开 https 地址 → 分享 → 添加到主屏幕 → 桌面图标打开（无地址栏）
- **Android Chrome**：https 地址 → 菜单 → 安装应用 / 添加到主屏幕

第一次打开后 `sw.js` 会把外壳缓存（`dsh-whale-v1`），之后**断网也能打开**，界面、图片、交互全在。

> 局域网 `http://10.x.x.x:8080` 下 Service Worker **不会注册**（非安全上下文），这是浏览器硬规则，
> 所以现在手机上看 http 预览时，断网行为只能用 DevTools 模拟验证。

---

## 已经做好的离线消息逻辑

`app.js`：

- `isOnline()` 读 `navigator.onLine`；聊天头部状态行在「正在输入… / 离线 / 在线」之间切换
- 发送时如果离线：消息**照样进列表**，`state = 'failed'` → 气泡左边出现**红色感叹号**
  - 点感叹号：仍离线 → 提示「还是没有网络，等一下再试」
  - 已联网：变转圈（`sending`）→ 600ms 后变正常，并触发对方回复
- `online` / `offline` 事件：状态行自动更新，恢复网络时提示「网络恢复了，点红色感叹号重发」
- 语音消息同样走这套（`pushMine()` 是唯一入口）

接真实后端后，把 `pushMine()` 里「按 `navigator.onLine` 判成败」换成真实请求结果即可：
请求失败 → `state='failed'`，`retryMessage()` 里重发同一个 payload。
