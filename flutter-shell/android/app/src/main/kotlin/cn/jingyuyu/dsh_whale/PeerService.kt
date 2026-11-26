package cn.jingyuyu.dsh_whale

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * 后台接收「我的电脑」发来的消息。
 *
 * 网页里的轮询在 App 退到后台后会被系统冻结（WebView 停摆），所以这里用前台服务
 * 在原生侧每 15 秒拉一次局域网中继，有新消息直接弹系统通知。
 *
 * 只在用户打开「设置 → 后台推送」且填过电脑地址时启动；关掉开关就 stopSelf。
 */
class PeerService : Service() {

    private var executor: ScheduledExecutorService? = null
    private var base: String = ""
    private var since: Long = 0L
    private var running = false
    private var prefs: android.content.SharedPreferences? = null

    companion object {
        const val CHANNEL_ID = "dsh_messages"
        const val SERVICE_NOTIF_ID = 9001
        const val MESSAGE_NOTIF_ID = 9002
        const val PREFS = "dsh_peer"
        const val KEY_BASE = "base"
        const val KEY_SINCE = "since"
        private const val INTERVAL_SECONDS = 15L
        private const val ROLE = "phone"

        /** App 是否在前台：在的话网页自己会处理未读，服务就别再弹通知了 */
        @Volatile
        var appVisible = false

        /** 由 Activity 调用：记住地址并（重新）启动服务 */
        fun start(context: Context, base: String) {
            val clean = base.trim().trimEnd('/')
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_BASE, clean).apply()

            val intent = Intent(context, PeerService::class.java)
            intent.putExtra("base", clean)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** 关掉开关时调用：停服务并清掉地址 */
        fun stop(context: Context) {
            context.stopService(Intent(context, PeerService::class.java))
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_BASE, "").apply()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val store = prefs ?: getSharedPreferences(PREFS, MODE_PRIVATE)
        val wanted = intent?.getStringExtra("base")?.takeIf { it.isNotBlank() }
            ?: store.getString(KEY_BASE, "").orEmpty()

        // 没地址就不该跑（用户关了开关重启手机时也会走到这里）
        if (wanted.isBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        // 前台通知必须尽快挂上，否则系统 5 秒后杀服务
        startForegroundCompat()

        var clean = wanted.trim().trimEnd('/')
        if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
            clean = "http://$clean"
        }
        if (running && clean == base) return START_STICKY

        base = clean
        since = store.getLong(KEY_SINCE, 0L)
        running = true

        executor?.shutdownNow()
        val pool = Executors.newSingleThreadScheduledExecutor()
        executor = pool
        pool.scheduleWithFixedDelay({ tick() }, 0L, INTERVAL_SECONDS, TimeUnit.SECONDS)
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        executor?.shutdownNow()
        executor = null
        super.onDestroy()
    }

    // ---------------------------------------------------------------- 轮询

    private fun tick() {
        try {
            val store = prefs ?: return

            // 第一次跑：先问服务端"现在到几号了"，不然会把历史消息全弹一遍
            if (since <= 0L) {
                val last = fetchLastSeq()
                if (last > 0L) {
                    since = last
                    store.edit().putLong(KEY_SINCE, since).apply()
                }
                return
            }

            val body = httpGet("$base/messages?role=$ROLE&since=$since")
            if (body.isBlank()) return

            val arr = JSONObject(body).optJSONArray("messages") ?: return
            var count = 0
            var lastText = ""
            var lastSeq = since

            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val seq = item.optLong("seq", 0L)
                val text = item.optString("text", "")
                if (seq > lastSeq) lastSeq = seq
                if (text.isNotBlank()) {
                    count += 1
                    lastText = text
                }
            }

            if (lastSeq > since) {
                since = lastSeq
                store.edit().putLong(KEY_SINCE, since).apply()
            }
            if (count > 0) notifyMessage(count, lastText)
        } catch (e: Exception) {
            // 电脑关机 / 换网时静默失败，下一轮再试
        }
    }

    private fun fetchLastSeq(): Long {
        return try {
            val body = httpGet("$base/info")
            if (body.isBlank()) 0L else JSONObject(body).optLong("last", 0L)
        } catch (e: Exception) {
            0L
        }
    }

    private fun httpGet(urlStr: String): String {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 8000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "dsh-whale-app")
            }
            if (conn.responseCode != 200) return ""
            conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn?.disconnect()
        }
    }

    // ---------------------------------------------------------------- 通知

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "消息通知",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "她发来的消息、我的电脑发来的消息"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun allowed(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return checkSelfPermission("android.permission.POST_NOTIFICATIONS") ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private fun launchIntent(): PendingIntent? {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** 常驻的"正在后台接收"通知，Android 要求前台服务必须有 */
    private fun startForegroundCompat() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("鲸与鱼")
            .setContentText("后台接收中，有新消息会提醒你")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .build()

        val type = when {
            Build.VERSION.SDK_INT >= 34 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            else -> 0
        }

        if (type != 0) {
            startForeground(SERVICE_NOTIF_ID, notification, type)
        } else {
            startForeground(SERVICE_NOTIF_ID, notification)
        }
    }

    private fun notifyMessage(count: Int, text: String) {
        if (appVisible) return   // 正在用 App，网页里会有未读提示，不用系统通知打扰
        if (!allowed()) return

        val title = if (count > 1) "我的电脑 · $count 条新消息" else "我的电脑"
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)

        launchIntent()?.let { builder.setContentIntent(it) }

        try {
            NotificationManagerCompat.from(this)
                .notify(MESSAGE_NOTIF_ID, builder.build())
        } catch (e: SecurityException) {
            // 没授权就算了
        }
    }
}
