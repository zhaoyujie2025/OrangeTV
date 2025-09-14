'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketMessage } from '../lib/types';
import { getAuthInfoFromBrowserCookie } from '../lib/auth';

// 全局连接计数器，用于调试
let globalConnectionCount = 0;

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  enabled?: boolean; // 是否启用WebSocket连接
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const isConnectingRef = useRef(false); // 添加连接状态标志，防止重复连接
  const optionsRef = useRef(options); // 使用 ref 存储 options，避免依赖项问题

  // 为每个 useWebSocket 实例创建唯一标识符
  const instanceIdRef = useRef<string>('');
  if (!instanceIdRef.current) {
    globalConnectionCount++;
    instanceIdRef.current = `ws-${globalConnectionCount}-${Date.now()}`;
    console.log(`🔌 创建 WebSocket 实例: ${instanceIdRef.current}`);
  }

  // 更新 options ref
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 获取WebSocket URL
  const getWebSocketUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;

    // 在生产环境中，WebSocket运行在不同的端口
    // 可以通过环境变量或配置来设置
    let wsPort = '3001'; // 默认WebSocket端口

    // 如果在开发环境，WebSocket运行在3001端口
    if (process.env.NODE_ENV === 'development') {
      return `${protocol}//${hostname}:3001/ws?_=${Date.now()}`;
    }

    // 生产环境，使用独立的WebSocket端口
    // 如果通过反向代理，可能需要特殊的路径
    if (window.location.port && window.location.port !== '80' && window.location.port !== '443') {
      // 本地测试环境
      return `${protocol}//${hostname}:${wsPort}/ws?_=${Date.now()}`;
    } else {
      // 生产环境，可能通过nginx反向代理
      // 如果使用反向代理，通常会将WebSocket映射到特定路径
      // 例如: /ws -> localhost:3001
      return `${protocol}//${hostname}/ws-api?_=${Date.now()}`;
    }
  };

  // 连接WebSocket
  const connect = useCallback(() => {
    // 防止重复连接
    if (wsRef.current?.readyState === WebSocket.OPEN || isConnectingRef.current) {
      console.log('🚫 防止重复连接 - 当前状态:', {
        readyState: wsRef.current?.readyState,
        isConnecting: isConnectingRef.current,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 清理之前的定时器
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }

    // 关闭任何现有连接
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // 忽略关闭错误
      }
    }

    isConnectingRef.current = true;
    setConnectionStatus('connecting');

    const wsUrl = getWebSocketUrl();

    try {
      console.log(`🔄 [${instanceIdRef.current}] 正在连接 WebSocket:`, wsUrl);
      wsRef.current = new WebSocket(wsUrl);

      // 设置超时处理
      const connectionTimeout = setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          console.warn('WebSocket 连接超时，正在关闭...');
          wsRef.current.close();
        }
      }, 10000); // 10秒超时

      wsRef.current.onopen = () => {
        clearTimeout(connectionTimeout);
        isConnectingRef.current = false; // 重置连接标志

        console.log(`✅ [${instanceIdRef.current}] WebSocket 连接成功:`, wsUrl);
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;

        // 发送用户连接消息
        const authInfo = getAuthInfoFromBrowserCookie();
        if (authInfo && authInfo.username) {
          sendMessage({
            type: 'user_connect',
            data: { userId: authInfo.username },
            timestamp: Date.now(),
          });
          console.log(`📤 [${instanceIdRef.current}] 已发送用户连接消息:`, authInfo.username);
        }

        // 清理之前的保持活动定时器（如果存在）
        if (keepAliveIntervalRef.current) {
          clearInterval(keepAliveIntervalRef.current);
        }

        // 设置保持活动的定期消息
        keepAliveIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            // console.log('已发送保持活动消息');
          } else {
            if (keepAliveIntervalRef.current) {
              clearInterval(keepAliveIntervalRef.current);
              keepAliveIntervalRef.current = null;
            }
          }
        }, 25000); // 每25秒发送一次

        optionsRef.current.onConnect?.();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('收到 WebSocket 消息:', message);
          optionsRef.current.onMessage?.(message);
        } catch (error) {
          console.error('解析 WebSocket 消息错误:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log(`❌ [${instanceIdRef.current}] WebSocket 断开连接:`, event.code, event.reason);
        isConnectingRef.current = false; // 重置连接标志
        setIsConnected(false);
        setConnectionStatus('disconnected');

        // 清理保持活动定时器
        if (keepAliveIntervalRef.current) {
          clearInterval(keepAliveIntervalRef.current);
          keepAliveIntervalRef.current = null;
        }

        // 关闭代码含义解释
        let closeReason = '';
        switch (event.code) {
          case 1000:
            closeReason = '正常关闭';
            break;
          case 1001:
            closeReason = '离开页面';
            break;
          case 1002:
            closeReason = '协议错误';
            break;
          case 1003:
            closeReason = '不支持的数据类型';
            break;
          case 1005:
            closeReason = '未提供关闭代码';
            break;
          case 1006:
            closeReason = '异常关闭'; // 通常表示连接突然中断
            break;
          case 1007:
            closeReason = '无效的数据';
            break;
          case 1008:
            closeReason = '违反策略';
            break;
          case 1009:
            closeReason = '消息过大';
            break;
          case 1010:
            closeReason = '客户端要求扩展';
            break;
          case 1011:
            closeReason = '服务器内部错误';
            break;
          case 1012:
            closeReason = '服务重启';
            break;
          case 1013:
            closeReason = '服务器临时问题';
            break;
          case 1015:
            closeReason = 'TLS握手失败';
            break;
          default:
            closeReason = '未知原因';
        }

        console.log(`WebSocket 关闭原因: ${closeReason}`);
        optionsRef.current.onDisconnect?.();

        // 自动重连（除非是正常关闭）
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          // 增加最小延迟时间，避免太频繁的重连
          const baseDelay = 2000; // 最小2秒
          const delay = Math.max(baseDelay, Math.min(Math.pow(2, reconnectAttemptsRef.current) * 1000, 30000)); // 指数退避，最少2秒，最多30秒
          console.log(`准备重新连接，等待 ${delay / 1000} 秒... (尝试 ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);

          // 清除之前的重连定时器
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            console.log(`正在尝试重新连接... (尝试 ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
            connect();
          }, delay);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket 错误:', error);
        isConnectingRef.current = false; // 重置连接标志
        optionsRef.current.onError?.(error);
        setConnectionStatus('disconnected');
      };
    } catch (error) {
      console.error(`❌ [${instanceIdRef.current}] 创建 WebSocket 连接失败:`, error);
      isConnectingRef.current = false; // 重置连接标志
      setConnectionStatus('disconnected');

      // 如果是在开发环境，给出更友好的错误提示
      if (process.env.NODE_ENV === 'development') {
        console.log('💡 开发环境WebSocket连接失败，请检查：');
        console.log('  1. WebSocket服务器是否已启动 (pnpm dev:ws)');
        console.log('  2. 端口3001是否被占用');
        console.log('  3. 防火墙是否阻止连接');
      }
    }
  }, []); // 空依赖项数组，因为我们使用 optionsRef 避免了依赖问题

  // 断开连接
  const disconnect = () => {
    console.log(`🔌 [${instanceIdRef.current}] 执行断开连接`);

    // 重置连接状态标志
    isConnectingRef.current = false;

    // 清除所有计时器
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }

    setIsConnected(false);
    setConnectionStatus('disconnected');
  };

  // 发送消息
  const sendMessage = (message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      console.log('通过 WebSocket 发送消息:', message);
      return true;
    } else {
      console.warn('WebSocket 未连接，无法发送消息:', message);
      return false;
    }
  };

  // 监听enabled状态变化，动态连接或断开
  useEffect(() => {
    const enabled = options.enabled ?? true; // 默认启用

    if (enabled) {
      console.log(`🎯 [${instanceIdRef.current}] WebSocket 已启用，开始连接`);
      connect();
    } else {
      console.log(`⏸️ [${instanceIdRef.current}] WebSocket 已禁用，断开现有连接`);
      disconnect();
    }

    return () => {
      console.log(`🧹 [${instanceIdRef.current}] WebSocket effect 清理，断开连接`);
      disconnect();
    };
  }, [options.enabled, connect]); // 监听 enabled 状态变化

  return {
    isConnected,
    connectionStatus,
    sendMessage,
    connect,
    disconnect,
  };
}