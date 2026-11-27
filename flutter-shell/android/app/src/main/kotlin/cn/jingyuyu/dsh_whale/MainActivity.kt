package cn.jingyuyu.dsh_whale

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {

    private val channelName = "cn.jingyuyu.dsh_whale/install"

    private companion object {
        const val REQ_MIC = 4101
        const val REQ_NOTIFY = 4102
        const val CHANNEL_ID = "dsh_messages"
    }

    /** 等结果的麦克风授权请求 */
    private var micResult: MethodChannel.Result? = null

    /** 等结果的通知授权请求 */
    private var pendingNotifyResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        createNotificationChannel()

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "installApk" -> {
                        val path = call.argument<String>("path")
                        if (path.isNullOrEmpty()) {
                            result.error("bad_args", "path is empty", null)
                        } else {
                            try {
                                installApk(path)
                                result.success(null)
                            } catch (e: Exception) {
                                result.error("install_failed", e.message, null)
                            }
                        }
                    }

                    "requestMic" -> requestMic(result)
                    "startPeerPoll" -> {
                        val base = call.argument<String>("base") ?: ""
                        if (base.isNotBlank()) PeerService.start(this, base)
                        result.success(null)
                    }
                    "stopPeerPoll" -> {
                        PeerService.stop(this)
                        result.success(null)
                    }
                    "requestNotify" -> requestNotify(result)
                    "notify" -> {
                        val title = call.argument<String>("title") ?: "鲸与鱼"
                        val body = call.argument<String>("body") ?: ""
                        showNotification(title, body)
                        result.success(null)
                    }
                    "openAppSettings" -> {
                        openAppSettings()
                        result.success(null)
                    }

                    else -> result.notImplemented()
                }
            }
    }

    // ---------------- 通知 ----------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "消息通知",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "她发来的消息、测试通知"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun notifyAllowed(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            this,
            "android.permission.POST_NOTIFICATIONS"
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestNotify(result: MethodChannel.Result) {
        if (notifyAllowed()) {
            result.success(true)
            return
        }
        pendingNotifyResult = result
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf("android.permission.POST_NOTIFICATIONS"),
                REQ_NOTIFY
            )
        } else {
            result.success(true)
            pendingNotifyResult = null
        }
    }

    private fun showNotification(title: String, body: String) {
        if (!notifyAllowed()) return

        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pending = android.app.PendingIntent.getActivity(
            this,
            0,
            intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                android.app.PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        try {
            // 同一个来源反复通知时用固定 id 覆盖，别堆成一串（时间戳当 id 会条条新增）
            val id = 20000 + (Math.abs(title.hashCode()) % 10000)
            NotificationManagerCompat.from(this).notify(id, notification)
        } catch (e: SecurityException) {
            // 没授权就算了
        }
    }

    /** 跳到本应用的系统设置页（省电、通知、权限都在里面） */
    private fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    /** 网页要录音：先确保 App 拿到了 RECORD_AUDIO 运行时权限 */
    private fun requestMic(result: MethodChannel.Result) {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (granted) {
            result.success(true)
            return
        }

        micResult = result
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.RECORD_AUDIO),
            REQ_MIC
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == REQ_NOTIFY) {
            val ok = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingNotifyResult?.success(ok)
            pendingNotifyResult = null
            return
        }

        if (requestCode != REQ_MIC) return

        val ok = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        micResult?.success(ok)
        micResult = null
    }

    override fun onResume() {
        super.onResume()
        PeerService.appVisible = true
    }

    override fun onPause() {
        PeerService.appVisible = false
        super.onPause()
    }

    /**
     * 拉起系统安装器。apk 放在应用缓存目录，通过 FileProvider 授权给安装器读。
     * 覆盖安装（同签名）不会丢应用数据。
     */
    private fun installApk(path: String) {
        val file = File(path)
        if (!file.exists()) {
            throw IllegalStateException("安装包不存在: $path")
        }

        val uri: Uri = FileProvider.getUriForFile(
            this,
            "$packageName.fileprovider",
            file
        )

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }
}
