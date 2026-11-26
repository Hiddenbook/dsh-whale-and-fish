# -*- coding: utf-8 -*-
"""手机预览用的静态服务：双击 serve-phone.bat 启动。

它会把仓库里的 ../web 目录跑起来，并打印所有可用的局域网地址。
"""

import http.server
import os
import socket
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(os.path.dirname(HERE), "web")
DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085]


def local_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass

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


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def end_headers(self):
        # 手机浏览器缓存凶，改完直接刷新就能看到新版本
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))


def main():
    if not os.path.exists(os.path.join(BASE, "index.html")):
        print("找不到 web/index.html")
        return 1

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
        print("端口都被占用了: %s" % ports)
        return 1

    ips = local_ips()

    print("")
    print("=" * 52)
    print("  DSH - phone preview (serving ../web)")
    print("=" * 52)
    print("")
    print("  Folder: %s" % BASE)
    print("")
    if ips:
        print("  Phone browser (same Wi-Fi / hotspot):")
        for ip in ips:
            print("      http://%s:%d" % (ip, port))
    else:
        print("  No LAN address. Connect Wi-Fi or a hotspot first.")
    print("")
    print("  This PC:  http://127.0.0.1:%d" % port)
    print("")
    print("  Keep this window open. Ctrl+C to stop.")
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
