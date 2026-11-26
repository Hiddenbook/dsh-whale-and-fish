import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:permission_handler/permission_handler.dart';
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

  @override
  void initState() {
    super.initState();

    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFE8F1FD))
      ..addJavaScriptChannel(
        'DshNative',
        onMessageReceived: (JavaScriptMessage message) {
          switch (message.message) {
            case 'requestMic':
              _requestMicPermission();
              break;
            case 'checkUpdate':
              _checkUpdate(manual: true);
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

  /// 网页要录音时会先发消息过来，这里申请系统麦克风权限再回传结果
  Future<void> _requestMicPermission() async {
    bool ok = false;
    try {
      final status = await Permission.microphone.request();
      ok = status.isGranted;
    } catch (_) {
      ok = false;
    }
    await _web.runJavaScript('window.DshMicAnswer && window.DshMicAnswer($ok)');
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

  Future<void> _checkUpdate({required bool manual}) async {
    if (_checking) return;
    _checking = true;

    final info = await PackageInfo.fromPlatform();
    final current = info.version;
    if (!mounted) {
      _checking = false;
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();

    if (manual) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('正在检查更新…'),
          duration: Duration(seconds: 1),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }

    try {
      final update = await _updater.check(current);

      if (update == null) {
        if (manual) {
          messenger.showSnackBar(
            SnackBar(
              content: Text('已是最新版本 $current'),
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
        return;
      }

      if (!mounted) return;
      final go = await _showUpdateDialog(update, current);
      if (go == true && mounted) {
        await _downloadAndInstall(update);
      }
    } on UpdateException catch (e) {
      if (manual && mounted) {
        messenger.showSnackBar(
          SnackBar(
            content: Text('检查更新失败：${e.message}'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (_) {
      if (manual && mounted) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text('检查更新失败，请检查网络'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      _checking = false;
    }
  }

  Future<bool?> _showUpdateDialog(UpdateInfo info, String current) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext ctx) {
        final hasNotes = info.notes.isNotEmpty;
        return AlertDialog(
          title: Text('发现新版本 ${info.version}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '当前 $current'
                '${info.sizeText.isEmpty ? '' : ' · 安装包 ${info.sizeText}'}',
                style: const TextStyle(fontSize: 12.5, color: Color(0xFF6B7E9B)),
              ),
              if (hasNotes) ...[
                const SizedBox(height: 12),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 220),
                  child: SingleChildScrollView(
                    child: Text(info.notes, style: const TextStyle(fontSize: 13)),
                  ),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('稍后'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('立即更新'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _downloadAndInstall(UpdateInfo info) async {
    final progress = ValueNotifier<double>(0);
    var dialogClosed = false;

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext ctx) {
        return AlertDialog(
          title: const Text('正在下载更新'),
          content: ValueListenableBuilder<double>(
            valueListenable: progress,
            builder: (_, double value, __) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LinearProgressIndicator(value: value == 0 ? null : value),
                  const SizedBox(height: 10),
                  Text(
                    value == 0 ? '准备中…' : '${(value * 100).toStringAsFixed(0)}%',
                    style: const TextStyle(fontSize: 12.5),
                  ),
                ],
              );
            },
          ),
        );
      },
    );

    try {
      final path = await _updater.downloadApk(
        info,
        onProgress: (double p) => progress.value = p,
      );

      // 先关掉进度框，再拉起系统安装界面
      if (mounted) {
        Navigator.of(context, rootNavigator: true).pop();
        dialogClosed = true;
      }
      await _updater.installApk(path);
    } catch (e) {
      if (!dialogClosed && mounted) {
        Navigator.of(context, rootNavigator: true).pop();
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('更新失败：$e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      progress.dispose();
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
          // 不用 SafeArea：让 WebView 顶到屏幕最上面，顶部空白由网页自己的 padding 处理
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _pushSafeTop(MediaQuery.of(ctx).viewPadding.top);
          });
          return Scaffold(
            backgroundColor: const Color(0xFFE8F1FD),
            body: WebViewWidget(controller: _web),
          );
        },
      ),
    );
  }
}
