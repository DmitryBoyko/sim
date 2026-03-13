from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"REQ from {self.client_address} path={self.path}")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"OK from Python server\n")

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 3000), Handler)
    print("Listening on 0.0.0.0:3000")
    server.serve_forever()
