import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// 应用内更新：查 GitHub Releases → 下载 apk → 交给系统安装器。
///
/// 仓库必须是 public，否则 API 需要 token（放进客户端等于泄露）。
class AppUpdater {
  AppUpdater({
    required this.repository,
    this.channelName = 'cn.jingyuyu.dsh_whale/install',
  });

  /// 形如 Hiddenbook/dsh-whale-and-fish
  final String repository;

  /// 和 MainActivity 里注册的 MethodChannel 名字保持一致
  final String channelName;

  static const _apiBase = 'https://api.github.com';

  MethodChannel get _channel => MethodChannel(channelName);

  /// 查最新 release；没有更新返回 null，网络/接口出错抛异常由调用方处理
  Future<UpdateInfo?> check(String currentVersion) async {
    final uri = Uri.parse('$_apiBase/repos/$repository/releases/latest');
    final res = await http.get(
      uri,
      headers: const {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'dsh-whale-app',
      },
    );

    if (res.statusCode == 404) return null; // 还没发过 release
    if (res.statusCode != 200) {
      throw UpdateException('GitHub 返回 ${res.statusCode}');
    }

    final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    final tag = (data['tag_name'] as String? ?? '').trim();
    final latest = _parseVersion(tag);
    if (latest == null) return null;

    final current = _parseVersion(currentVersion) ?? [0, 0, 0];
    if (!_isNewer(latest, current)) return null;

    final asset = _pickApkAsset(data['assets'] as List?);
    if (asset == null) return null;

    return UpdateInfo(
      version: tag.startsWith('v') ? tag.substring(1) : tag,
      notes: (data['body'] as String? ?? '').trim(),
      sizeText: _sizeText((asset['size'] as num?)?.toInt() ?? 0),
      downloadUrl: asset['browser_download_url'] as String,
    );
  }

  /// 下载到缓存目录并拉起系统安装界面
  Future<void> downloadAndInstall(
    UpdateInfo info, {
    void Function(double progress)? onProgress,
  }) async {
    final path = await downloadApk(info, onProgress: onProgress);
    await installApk(path);
  }

  /// 只下载，返回本地 apk 路径（缓存目录）
  Future<String> downloadApk(
    UpdateInfo info, {
    void Function(double progress)? onProgress,
  }) async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/update-${info.version}.apk');
    if (await file.exists()) await file.delete();

    final client = http.Client();
    try {
      final req = http.Request('GET', Uri.parse(info.downloadUrl));
      req.headers['User-Agent'] = 'dsh-whale-app';
      final res = await client.send(req);
      if (res.statusCode != 200) {
        throw UpdateException('下载失败 ${res.statusCode}');
      }

      final total = res.contentLength ?? 0;
      var received = 0;
      final sink = file.openWrite();
      try {
        await for (final chunk in res.stream) {
          sink.add(chunk);
          received += chunk.length;
          if (total > 0) onProgress?.call(received / total);
        }
      } finally {
        await sink.flush();
        await sink.close();
      }

      if (received < 1024) {
        throw UpdateException('下载的包不完整');
      }
    } finally {
      client.close();
    }

    return file.path;
  }

  /// 交给原生：FileProvider + ACTION_VIEW，走系统安装器（覆盖安装，保留数据）
  Future<void> installApk(String path) async {
    await _channel.invokeMethod<void>('installApk', {'path': path});
  }

  // ---------- 内部：版本号与资源挑选 ----------

  Map<String, dynamic>? _pickApkAsset(List? assets) {
    if (assets == null) return null;
    final apks = assets
        .whereType<Map>()
        .where((a) => ((a['name'] as String?) ?? '').toLowerCase().endsWith('.apk'))
        .toList();
    if (apks.isEmpty) return null;

    for (final a in apks) {
      final name = ((a['name'] as String?) ?? '').toLowerCase();
      if (name.contains('arm64') || name.contains('v8a')) {
        return Map<String, dynamic>.from(a);
      }
    }
    return Map<String, dynamic>.from(apks.first);
  }

  List<int>? _parseVersion(String raw) {
    final match = RegExp(r'(\d+)\.(\d+)\.(\d+)').firstMatch(raw);
    if (match == null) return null;
    return [
      int.parse(match.group(1)!),
      int.parse(match.group(2)!),
      int.parse(match.group(3)!),
    ];
  }

  bool _isNewer(List<int> a, List<int> b) {
    for (var i = 0; i < 3; i++) {
      if (a[i] != b[i]) return a[i] > b[i];
    }
    return false;
  }

  String _sizeText(int bytes) {
    if (bytes <= 0) return '';
    final mb = bytes / (1024 * 1024);
    return '${mb.toStringAsFixed(1)} MB';
  }
}

class UpdateInfo {
  UpdateInfo({
    required this.version,
    required this.notes,
    required this.sizeText,
    required this.downloadUrl,
  });

  final String version;
  final String notes;
  final String sizeText;
  final String downloadUrl;
}

class UpdateException implements Exception {
  UpdateException(this.message);
  final String message;

  @override
  String toString() => message;
}
