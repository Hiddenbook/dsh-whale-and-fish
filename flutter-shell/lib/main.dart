import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'update.dart';

/// 更新源仓库（换仓库只改这一行）
const String kRepo = 'Hiddenbook/dsh-whale-and-fish';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 内容铺满整屏（含状态栏区域），状态栏透明 —— 这样顶部不会留一条浅色空条
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
      systemNavigationBarColor: Color(0xFFF6FAFF),
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const DshApp());
}

class DshApp extends StatelessWidget {
  const DshApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '鲸与鱼',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF4C86DB),
        scaffoldBackgroundColor: const Color(0xFFE8F1FD),
      ),
      home: const WebShell(),
    );
  }
}

/// 整个界面是 assets/web 里的那套 HTML。
/// 原生这层只管三件事：承载 WebView、系统返回键、应用内更新。
class WebShell extends StatefulWidget {
  const WebShell({super.key});

  @override
  State<WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<WebShell> {
  static const String _assetPath = 'assets/web/index.html';

  late final WebViewController _web;
  final AppUpdater _updater = AppUpdater(repository: kRepo);
  bool _checking = false;

  /// 上一次告诉网页的键盘高度，相同就不重复发
  double? _lastKb;

  /// 网页弹窗里点「立即更新」时要下载的那个版本
  UpdateInfo? _pendingUpdate;


  @override
  void initState() {
    super.initState();

    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFE8F1FD))
      ..addJavaScriptChannel(
        'DshNative',
        onMessageReceived: (JavaScriptMessage message) {
          final text = message.message;
          if (text.startsWith('notify:')) {
            _showNotification(text.substring(7));
            return;
          }
          // 复制消息：走系统剪贴板，网页那边不用管权限
          if (text.startsWith('copy:')) {
            Clipboard.setData(ClipboardData(text: text.substring(5)));
            return;
          }
          // 后台接收开关：peerPoll:1|http://192.168.1.5:8080
          if (text.startsWith('peerPoll:')) {
            _togglePeerPoll(text.substring(9));
            return;
          }

          switch (message.message) {
            case 'requestMic':
              _requestMicPermission();
              break;
            case 'requestNotify':
              _requestNotifyPermission();
              break;
            case 'openAppSettings':
              _native('openAppSettings');
              break;
            case 'checkUpdate':
              _checkUpdate(manual: true);
              break;
            // 网页里点了「立即更新」：原生只负责下载 + 拉起安装器
            case 'updateDownload':
              _startUpdateDownload();
              break;
            // 网页说"进全屏"：这里就是铺满整屏（状态栏透明覆盖），不隐藏系统栏，
            // 这样顶部既有背景色、时间电量也还在
            case 'fullscreen':
            case 'exitFullscreen':
              SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
              break;
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            // 页面（重）加载后重新告诉它状态栏有多高
            _lastTopInset = null;
            _pushSafeTop(MediaQuery.of(context).viewPadding.top);
          },
          onWebResourceError: (WebResourceError error) {
            debugPrint('[webview] ${error.errorCode} ${error.description}');
          },
        ),
      )
      ..loadFlutterAsset(_assetPath);

    // WebView 里的 getUserMedia 要用的录音资源：交给系统授权，不在网页层拦
    final platform = _web.platform;
    if (platform is AndroidWebViewController) {
      platform.setOnPlatformPermissionRequest((request) async {
        await request.grant();
      });
    }

    // 启动 2 秒后静默查一次，有新版才弹窗
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Future<void>.delayed(const Duration(seconds: 2), () {
        if (mounted) _checkUpdate(manual: false);
      });
    });
  }

  static const MethodChannel _channel = MethodChannel('cn.jingyuyu.dsh_whale/install');

  Future<void> _native(String method, [Map<String, dynamic>? args]) async {
    try {
      await _channel.invokeMethod<void>(method, args);
    } catch (_) {
      /* 原生不支持就算了 */
    }
  }

  Future<void> _showNotification(String payload) async {
    String title = '鲸与鱼';
    String body = '';
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      title = (data['title'] as String?) ?? title;
      body = (data['body'] as String?) ?? '';
    } catch (_) {
      body = payload;
    }
    await _native('notify', {'title': title, 'body': body});
  }

  /// 网页说「后台接收开/关」，交给原生前台服务去做轮询
  Future<void> _togglePeerPoll(String payload) async {
    final parts = payload.split('|');
    final on = parts.isNotEmpty && parts[0] == '1';
    final base = parts.length > 1 ? parts[1].trim() : '';

    if (!on || base.isEmpty) {
      await _native('stopPeerPoll');
      return;
    }

    try {
      final granted = await _channel.invokeMethod<bool>('requestNotify');
      if (granted == false) {
        // 没有通知权限就没有意义，把开关状态回传给网页
        await _web.runJavaScript('window.DshNotifyDenied && window.DshNotifyDenied()');
        return;
      }
    } catch (_) {
      /* 老版本没有这方法，继续尝试启动 */
    }

    await _native('startPeerPoll', {'base': base});
  }

  Future<void> _requestNotifyPermission() async {
    await _native('requestNotify');
  }

  /// 网页要录音时会先发消息过来，这里申请系统麦克风权限再回传结果
  Future<void> _requestMicPermission() async {
    bool ok = false;
    try {
      const channel = MethodChannel('cn.jingyuyu.dsh_whale/install');
      final granted = await channel.invokeMethod<bool>('requestMic');
      ok = granted ?? false;
    } catch (_) {
      ok = false;
    }
    await _web.runJavaScript('window.DshMicAnswer && window.DshMicAnswer($ok)');
  }

  /// 键盘高度：直接用系统的 IME insets（每帧变就每帧发），
  /// 网页拿它平移输入栏——这条时间线跟键盘动画同步，不用等 WebView 自己 resize 完。
  Future<void> _pushKeyboard(double bottom) async {
    final px = bottom.round().clamp(0, 400).toDouble();
    if (_lastKb == px) return;
    _lastKb = px;

    try {
      await _web.runJavaScript('window.DshKeyboard && window.DshKeyboard(${px.toInt()})');
    } catch (_) {
      /* 页面还没加载好 */
    }
  }

  /// 状态栏高度：WebView 里 env(safe-area-inset-top) 一般是 0，
  /// 所以由原生把真实高度写成 CSS 变量，网页用它做顶部内边距
  double? _lastTopInset;
  double? _lastBottomInset;

  void _pushSafeTop(double top) {
    final double bottom = MediaQuery.of(context).viewPadding.bottom;
    if (_lastTopInset == top && _lastBottomInset == bottom) return;
    _lastTopInset = top;
    _lastBottomInset = bottom;
    _web.runJavaScript(
      "document.documentElement.style.setProperty('--safe-top', '${top.round()}px');"
      "document.documentElement.style.setProperty('--safe-bottom', '${bottom.round()}px');",
    );
  }

  /// 返回键：先在网页里退一层（二级页 → 一级页 → 首页），退无可退才退出 App
  Future<void> _handleBack() async {
    // 先问网页：有浮层 / 多选 / 引用 / 语音面板时，让它吃掉这次返回
    bool consumed = false;
    try {
      final result = await _web.runJavaScriptReturningResult(
        'window.DshHandleBack ? window.DshHandleBack() : false',
      );
      consumed = result.toString().replaceAll('"', '').trim() == 'true';
    } catch (_) {
      consumed = false;
    }
    if (consumed) return;

    if (await _web.canGoBack()) {
      await _web.goBack();
      return;
    }
    await SystemNavigator.pop();
  }

  // ---------------- 检查更新 ----------------

  /// 给网页发一条更新事件；网页没加载好/没有这个函数就静默跳过
  Future<void> _upd(String js) async {
    try {
      await _web.runJavaScript('window.DshUpdate && $js');
    } catch (_) {
      /* 页面还没好，忽略 */
    }
  }

  String _q(String? s) => jsonEncode(s ?? '');

  /// 查版本。界面全部交给网页（原生 AlertDialog 太丑，而且跟那套浅蓝不搭）
  Future<void> _checkUpdate({required bool manual}) async {
    if (_checking) return;
    _checking = true;

    final info = await PackageInfo.fromPlatform();
    final current = info.version;
    if (!mounted) {
      _checking = false;
      return;
    }

    if (manual) await _upd("DshUpdate('checking')");

    try {
      final update = await _updater.check(current);

      if (update == null) {
        if (manual) {
          await _upd("DshUpdate('latest', {version: ${_q(current)}})");
        }
        return;
      }

      _pendingUpdate = update;
      await _upd(
        "DshUpdate('available', {"
        "version: ${_q(update.version)}, "
        "current: ${_q(current)}, "
        "size: ${_q(update.sizeText)}, "
        "notes: ${_q(update.notes)}})",
      );
    } on UpdateException catch (e) {
      if (manual) {
        await _upd("DshUpdate('error', {message: ${_q('检查更新失败：${e.message}')}})");
      }
    } catch (_) {
      if (manual) {
        await _upd("DshUpdate('error', {message: ${_q('检查更新失败，请检查网络')}})");
      }
    } finally {
      _checking = false;
    }
  }

  /// 网页点了「立即更新」：下载、回报进度、拉起系统安装器
  Future<void> _startUpdateDownload() async {
    final update = _pendingUpdate;
    if (update == null) return;
    _pendingUpdate = null;

    var lastPct = -1;
    try {
      final path = await _updater.downloadApk(
        update,
        onProgress: (double p) {
          // 进度回调很密，只在百分比变了才发，别把桥挤爆
          final pct = (p * 100).round();
          if (pct == lastPct) return;
          lastPct = pct;
          _upd("DshUpdate('progress', {percent: ${p.toStringAsFixed(3)}})");
        },
      );

      await _upd("DshUpdate('done')");
      await _updater.installApk(path);
    } catch (e) {
      await _upd("DshUpdate('fail', {message: ${_q('更新失败：$e')}})");
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) return;
        _handleBack();
      },
      child: Builder(
        builder: (BuildContext ctx) {
          final media = MediaQuery.of(ctx);

          // 不用 SafeArea：让 WebView 顶到屏幕最上面，顶部空白由网页自己的 padding 处理
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            _pushSafeTop(media.viewPadding.top);
            _pushKeyboard(media.viewInsets.bottom);
          });

          return Scaffold(
            backgroundColor: const Color(0xFFE8F1FD),
            // 键盘弹出时不要让 Scaffold 缩body：WebView 一被 resize 就要整页重排，
            // 那正是"掉帧"的来源。窗口（adjustNothing）和 body 尺寸都保持不变，
            // 键盘高度只用来平移网页里的输入栏。
            resizeToAvoidBottomInset: false,
            body: WebViewWidget(controller: _web),
          );
        },
      ),
    );
  }
}
