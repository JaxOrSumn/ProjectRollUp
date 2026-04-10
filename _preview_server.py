"""Minimal preview server: remaps /web/* → /* so index.html loads its assets."""
import http.server, os, sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/web/'):
            path = '/' + path[5:]
        return super().translate_path(path)
    def log_message(self, fmt, *args):
        pass  # suppress noise

port = int(sys.argv[1]) if len(sys.argv) > 1 else 7820
http.server.HTTPServer(('', port), Handler).serve_forever()
