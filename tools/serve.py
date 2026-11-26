# -*- coding: utf-8 -*-
"""Start a tiny static server for phone preview.

Double-click 启动手机预览.bat instead of running this directly.

It prints every LAN address the page can be opened from, and disables
caching so a hard refresh is not needed after every change.
"""

import http.server
import json
import os
import socket
import sys
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
# 仓库里本脚本在 tools/ 下，网页在 ../web；直接放在网页目录里的情况就退回自身目录
_SIBLING = os.path.join(os.path.dirname(HERE), "web")
BASE = _SIBLING if os.path.exists(os.path.join(_SIBLING, "index.html")) else HERE
DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085]


def local_ips():
    ips = set()

    # 1) whatever the host name resolves to
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass

    # 2) ask the routing table which source address it would use
    for target in ("10.255.255.255", "192.168.255.255", "8.8.8.8"):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect((target, 1))
            ips.add(sock.getsockname()[0])
        except OSError:
            pass
        finally:
            sock.close()

    return sorted(
        ip for ip in ips if not ip.startswith("127.") and not ip.startswith("169.254.")
    )


# ---------------------------------------------------------------- 消息中继
# 「我的电脑 / 我的手机」互发消息用：极简队列 + 长轮询，不引第三方库。
# POST /send   {role, text, time}          → 追加到队列
# GET  /poll?role=phone&since=12&wait=20   → 返回别人发的、序号 > since 的消息
_LOCK = threading.Lock()
_MESSAGES = []          # [{seq, role, text, time}]
_SEQ = [0]


def push_message(role, text, stamp, client_id=""):
    with _LOCK:
        _SEQ[0] += 1
        item = {"seq": _SEQ[0], "role": role, "text": text, "time": stamp, "cid": client_id}
        _MESSAGES.append(item)
        if len(_MESSAGES) > 200:
            del _MESSAGES[: len(_MESSAGES) - 200]
        return item


def take_messages(role, since, client_id=""):
    """别人发的、序号大于 since 的消息。优先按 client id 排除自己；
    没带 id 的老客户端退回按 role 排除。"""
    with _LOCK:
        out = []
        for m in _MESSAGES:
            if m["seq"] <= since:
                continue
            if client_id:
                if m.get("cid") == client_id:
                    continue
            elif m["role"] == role:
                continue
            out.append(m)
        return out


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def end_headers(self):
        # phone browsers cache aggressively; keep every reload fresh
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))

    # ---------- 中继接口 ----------
    def _json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/send"):
            return self._json({"error": "not found"}, 404)

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            return self._json({"error": "bad json"}, 400)

        role = (data.get("role") or "unknown")[:16]
        text = (data.get("text") or "")[:2000]
        if not text:
            return self._json({"error": "empty text"}, 400)

        item = push_message(
            role, text, data.get("time") or time.strftime("%H:%M"), str(data.get("cid") or "")[:40]
        )
        sys.stdout.write("  [relay] %s -> %s\n" % (role, text[:40]))
        return self._json({"ok": True, "seq": item["seq"]})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path in ("/messages", "/poll"):
            query = urllib.parse.parse_qs(parsed.query)
            role = (query.get("role", ["unknown"])[0])[:16]
            try:
                since = int(query.get("since", query.get("after", ["0"])[0])[0])
            except ValueError:
                since = 0
            cid = (query.get("cid", [""])[0])[:40]
            return self._json(
                {"messages": take_messages(role, since, cid), "last": _SEQ[0]}
            )

        if parsed.path == "/info":
            return self._json(
                {
                    "ok": True,
                    "ips": local_ips(),
                    "port": self.server.server_address[1],
                    "count": len(_MESSAGES),
                    "last": _SEQ[0],
                }
            )

        return super().do_GET()


def main():
    ports = [int(os.environ["PORT"])] if os.environ.get("PORT") else list(DEFAULT_PORTS)

    httpd = None
    port = None
    for candidate in ports:
        try:
            httpd = http.server.ThreadingHTTPServer(("0.0.0.0", candidate), Handler)
            port = candidate
            break
        except OSError:
            continue

    if httpd is None:
        print("No free port in %s" % ports)
        return 1

    ips = local_ips()

    print("")
    print("=" * 52)
    print("  DSH - phone preview server")
    print("=" * 52)
    print("")
    print("  Folder: %s" % BASE)
    print("")
    if ips:
        print("  Open on your phone (same Wi-Fi / hotspot):")
        for ip in ips:
            print("      http://%s:%d" % (ip, port))
    else:
        print("  No LAN address found. Connect Wi-Fi or a hotspot first.")
    print("")
    print("  This PC:")
    print("      http://127.0.0.1:%d" % port)
    print("")
    print("  Keep this window open. Press Ctrl+C to stop.")
    print("")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
