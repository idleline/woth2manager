#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webp": "image/webp"}


if __name__ == "__main__":
    address = ("127.0.0.1", 7000)
    print(f"New Laurentia offline map: http://{address[0]}:{address[1]}")
    ThreadingHTTPServer(address, Handler).serve_forever()
