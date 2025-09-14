const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { createWebSocketServer } = require('./websocket');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

// 当使用Next.js时，需要预准备应用程序
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      // 使用Next.js处理所有请求
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // 初始化 WebSocket 服务器
  const wss = createWebSocketServer(server);

  // 将 WebSocket 服务器实例及相关方法存储到全局对象中，供 API 路由使用
  global.wss = wss;

  // 使用一个标志确保每个连接只被处理一次
  const upgradedSockets = new WeakSet();

  // 直接处理 WebSocket 升级请求
  server.on('upgrade', (request, socket, head) => {
    // 如果这个 socket 已经被处理过，就忽略它
    if (upgradedSockets.has(socket)) {
      return;
    }

    const pathname = parse(request.url).pathname;

    if (pathname === '/ws') {
      console.log('处理 WebSocket 升级请求:', pathname);
      try {
        // 标记这个 socket 已经被处理
        upgradedSockets.add(socket);

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } catch (error) {
        console.error('WebSocket 升级处理错误:', error);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    } else {
      console.log('非 WebSocket 升级请求:', pathname);
      // Next.js 会自己处理这些请求，无需销毁 socket
    }
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket server ready on ws://${hostname}:${port}/ws`);
  });
});