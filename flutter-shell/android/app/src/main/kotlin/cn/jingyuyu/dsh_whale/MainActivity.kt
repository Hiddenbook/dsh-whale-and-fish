package cn.jingyuyu.dsh_whale

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.ActivityCompat
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
    }

    /** 等结果的麦克风授权请求 */
    private var micResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

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

                    else -> result.notImplemented()
                }
            }
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
        if (requestCode != REQ_MIC) return

        val ok = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        micResult?.success(ok)
        micResult = null
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
