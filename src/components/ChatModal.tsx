'use client';

import { MessageCircle, Search, Users, X, Send, UserPlus, Smile, Image as ImageIcon, Paperclip } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ChatMessage, Conversation, Friend, FriendRequest, WebSocketMessage } from '../lib/types';
import { getAuthInfoFromBrowserCookie } from '../lib/auth';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from './Toast';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMessageCountChange?: (count: number) => void;
  onChatCountReset?: (resetCount: number) => void;
  onFriendRequestCountReset?: (resetCount: number) => void;
}

export function ChatModal({
  isOpen,
  onClose,
  onMessageCountChange,
  onChatCountReset,
  onFriendRequestCountReset
}: ChatModalProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'friends'>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [unreadFriendRequestCount, setUnreadFriendRequestCount] = useState(0);
  const [conversationUnreadCounts, setConversationUnreadCounts] = useState<{ [key: string]: number }>({});
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [userAvatars, setUserAvatars] = useState<{ [username: string]: string | null }>({});
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [dragStartPosition, setDragStartPosition] = useState({ x: 0, y: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUser = getAuthInfoFromBrowserCookie();
  const { showError, showSuccess } = useToast();

  // 拖动相关事件处理
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键
    setIsDragging(true);
    setDragStartPosition({
      x: e.clientX - dragPosition.x,
      y: e.clientY - dragPosition.y
    });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const newX = e.clientX - dragStartPosition.x;
    const newY = e.clientY - dragStartPosition.y;

    // 限制拖动范围，确保模态框不会完全移出视口
    const maxX = window.innerWidth - 400; // 模态框最小宽度
    const maxY = window.innerHeight - 200; // 模态框最小高度

    setDragPosition({
      x: Math.max(-200, Math.min(maxX, newX)),
      y: Math.max(0, Math.min(maxY, newY))
    });
  }, [isDragging, dragStartPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 添加全局鼠标事件监听
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // 实时搜索功能
  useEffect(() => {
    const timer = setTimeout(() => {
      if (friendSearchQuery.trim()) {
        searchUsers();
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [friendSearchQuery]);

  // 常用表情列表
  const emojis = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
    '🙂', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝',
    '🤗', '🤔', '😐', '😑', '😶', '🙄', '😏', '😣', '😥', '😮',
    '🤐', '😯', '😴', '😫', '😪', '😵', '🤯', '🤠', '🥳', '😎',
    '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '👐',
    '❤️', '💙', '💚', '💛', '💜', '🧡', '🖤', '🤍', '🤎', '💕',
    '💖', '💗', '💘', '💝', '💞', '💟', '❣️', '💔', '❤️‍🔥', '💯'
  ];

  // 获取用户真实头像
  const fetchUserAvatar = useCallback(async (username: string) => {
    // 如果已经缓存了该用户的头像（包括 null 值），直接返回
    if (username in userAvatars) {
      return userAvatars[username];
    }

    try {
      const response = await fetch(`/api/avatar?user=${encodeURIComponent(username)}`);
      if (response.ok) {
        const data = await response.json();
        const avatar = data.avatar || null;

        // 缓存头像结果
        setUserAvatars(prev => ({
          ...prev,
          [username]: avatar
        }));

        return avatar;
      }
    } catch (error) {
      console.error('获取用户头像失败:', error);
    }

    // 获取失败时缓存 null
    setUserAvatars(prev => ({
      ...prev,
      [username]: null
    }));

    return null;
  }, [userAvatars]);

  // 预加载用户头像
  const preloadUserAvatars = useCallback(async (usernames: string[]) => {
    const promises = usernames
      .filter(username => !(username in userAvatars)) // 只加载未缓存的头像
      .map(username => fetchUserAvatar(username));

    await Promise.allSettled(promises);
  }, [userAvatars, fetchUserAvatar]);

  // 使用 useCallback 稳定 onMessage 函数引用
  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'message':
        const conversationId = message.data.conversation_id;

        // 预加载消息发送者的头像
        if (message.data.sender_id) {
          preloadUserAvatars([message.data.sender_id]);
        }

        // 收到新消息的处理逻辑
        if (selectedConversation && conversationId === selectedConversation.id && isOpen) {
          // 只有当模态框打开且用户正在查看这个对话时，才只刷新消息列表
          loadMessages(selectedConversation.id);
        } else if (conversationId) {
          // 所有其他情况都增加未读消息计数（包括模态框关闭时的当前对话）
          setConversationUnreadCounts(prev => {
            const newCounts = {
              ...prev,
              [conversationId]: (prev[conversationId] || 0) + 1
            };
            return newCounts;
          });

          // 如果用户正在查看这个对话且模态框是打开的，同时刷新消息列表
          if (selectedConversation && conversationId === selectedConversation.id && isOpen) {
            loadMessages(selectedConversation.id);
          }
        }
        loadConversations();
        break;
      case 'friend_request':
        // 收到好友申请

        // 预加载好友申请发送者的头像
        if (message.data.from_user) {
          preloadUserAvatars([message.data.from_user]);
        }

        setUnreadFriendRequestCount(prev => prev + 1);
        loadFriendRequests();
        break;
      case 'friend_accepted':
        // 好友申请被接受
        loadFriends();
        break;
      case 'user_status':
        // 用户状态变化
        setFriends(prevFriends =>
          prevFriends.map(friend =>
            friend.username === message.data.userId
              ? { ...friend, status: message.data.status }
              : friend
          )
        );
        break;
      case 'online_users':
        // 更新在线用户列表
        setOnlineUsers(message.data.users || []);
        break;
      case 'connection_confirmed':
        // 连接确认，请求在线用户列表
        break;
      default:
        break;
    }
  }, [selectedConversation, preloadUserAvatars]);

  // WebSocket 连接 - 始终保持连接以接收实时消息
  const { isConnected, sendMessage: sendWebSocketMessage } = useWebSocket({
    onMessage: handleWebSocketMessage,
    enabled: true, // 始终启用WebSocket以接收实时消息
  });

  useEffect(() => {
    if (isOpen) {
      loadConversations();
      loadFriends();
      loadFriendRequests();

      // 预加载当前用户的头像
      if (currentUser?.username) {
        preloadUserAvatars([currentUser.username]);
      }

      // 开发模式下创建一些测试数据
      if (process.env.NODE_ENV === 'development') {
        createTestDataIfNeeded();
      }
    }
  }, [isOpen, currentUser?.username, preloadUserAvatars]);

  // 创建测试数据（仅开发模式）
  const createTestDataIfNeeded = async () => {
    if (!currentUser) return;

    try {
      // 检查是否已有对话
      const response = await fetch('/api/chat/conversations');
      if (response.ok) {
        const existingConversations = await response.json();
        if (existingConversations.length === 0) {
          // 创建一个测试对话
          const testConversation = {
            name: '测试对话',
            participants: [currentUser.username, 'test-user'],
            type: 'private',
            created_at: Date.now(),
            updated_at: Date.now(),
          };

          const createResponse = await fetch('/api/chat/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testConversation),
          });

          if (createResponse.ok) {
            loadConversations(); // 重新加载对话列表
          }
        }
      }
    } catch (error) {
      console.error('创建测试数据失败:', error);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 点击外部关闭表情选择器
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showEmojiPicker && !target.closest('.emoji-picker-container')) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  // 计算总的未读聊天消息数量
  useEffect(() => {
    const totalChatCount = Object.values(conversationUnreadCounts).reduce((sum, count) => sum + count, 0);
    setUnreadChatCount(totalChatCount);
  }, [conversationUnreadCounts]);

  // 通知父组件消息数量变化
  useEffect(() => {
    const totalCount = unreadChatCount + unreadFriendRequestCount;
    onMessageCountChange?.(totalCount);
  }, [unreadChatCount, unreadFriendRequestCount, onMessageCountChange]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 生成头像URL（优先使用真实头像，回退到默认头像）
  const getAvatarUrl = (username: string) => {
    const realAvatar = userAvatars[username];
    if (realAvatar) {
      return realAvatar; // 返回Base64格式的真实头像
    }
    // 使用Dicebear API生成默认头像
    return `https://api.dicebear.com/7.x/initials/svg?seed=${username}&backgroundColor=3B82F6,8B5CF6,EC4899,10B981,F59E0B&textColor=ffffff`;
  };

  // 获取用户显示名称
  const getDisplayName = (username: string) => {
    if (username === currentUser?.username) return '我';
    const friend = friends.find(f => f.username === username);
    return friend?.nickname || username;
  };

  // 格式化消息时间显示
  const formatMessageTime = (timestamp: number) => {
    const messageDate = new Date(timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const messageDay = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());

    const timeStr = messageDate.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    if (messageDay.getTime() === today.getTime()) {
      // 今天的消息：只显示时分秒
      return timeStr;
    } else if (messageDay.getTime() === yesterday.getTime()) {
      // 昨天的消息：昨天-时分秒
      return `昨天-${timeStr}`;
    } else {
      // 更早的消息：年月日-时分秒
      const dateStr = messageDate.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return `${dateStr}-${timeStr}`;
    }
  };

  // 处理表情选择
  const handleEmojiSelect = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // 处理图片上传
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      showError('文件类型错误', '请选择图片文件');
      return;
    }

    // 验证文件大小 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      showError('文件过大', '图片大小不能超过5MB');
      return;
    }

    setUploadingImage(true);

    try {
      // 转换为base64
      const base64 = await fileToBase64(file);

      // 发送图片消息
      if (selectedConversation && currentUser) {
        const message: Omit<ChatMessage, 'id'> = {
          conversation_id: selectedConversation.id,
          sender_id: currentUser.username || '',
          sender_name: currentUser.username || '',
          content: base64,
          message_type: 'image',
          timestamp: Date.now(),
          is_read: false,
        };

        const response = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        });

        if (response.ok) {
          const sentMessage = await response.json();
          await loadMessages(selectedConversation.id);
          await loadConversations();

          // 通过WebSocket通知其他参与者
          if (isConnected) {
            sendWebSocketMessage({
              type: 'message',
              data: {
                ...sentMessage,
                conversation_id: selectedConversation.id,
                participants: selectedConversation.participants,
              },
              timestamp: Date.now(),
            });
          }
        } else {
          showError('发送失败', '图片发送失败，请重试');
        }
      }
    } catch (error) {
      console.error('Image upload failed:', error);
      showError('发送失败', '图片处理失败，请重试');
    } finally {
      setUploadingImage(false);
      // 清除文件选择
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 文件转base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const loadConversations = async () => {
    try {
      const response = await fetch('/api/chat/conversations');
      if (response.ok) {
        const data = await response.json();
        setConversations(data);

        // 预加载所有对话参与者的头像
        const allParticipants = data.reduce((acc: string[], conv: Conversation) => {
          return [...acc, ...conv.participants];
        }, []);
        const uniqueParticipants = Array.from(new Set<string>(allParticipants));
        preloadUserAvatars(uniqueParticipants);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadFriends = async () => {
    try {
      const response = await fetch('/api/chat/friends');
      if (response.ok) {
        const data = await response.json();
        setFriends(data);

        // 预加载所有好友的头像
        const friendUsernames = data.map((friend: Friend) => friend.username);
        preloadUserAvatars(friendUsernames);
      }
    } catch (error) {
      console.error('Failed to load friends:', error);
    }
  };

  const loadFriendRequests = async () => {
    try {
      const response = await fetch('/api/chat/friend-requests');
      if (response.ok) {
        const data = await response.json();
        setFriendRequests(data);

        // 预加载好友请求发送者的头像
        const requestSenders = data.map((request: FriendRequest) => request.from_user);
        const uniqueSenders = Array.from(new Set<string>(requestSenders));
        preloadUserAvatars(uniqueSenders);
      }
    } catch (error) {
      console.error('Failed to load friend requests:', error);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/chat/messages?conversationId=${conversationId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);

        // 预加载所有发送者的头像
        const senderIds = Array.from(new Set<string>(data.map((msg: ChatMessage) => msg.sender_id)));
        preloadUserAvatars(senderIds);
      } else {
        // 处理非200状态码
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to load messages - Status:', response.status, 'Error:', errorData);

        if (response.status === 401) {
          showError('未授权', '请重新登录');
        } else if (response.status === 403) {
          showError('无权限', '您没有权限访问此对话');
        } else if (response.status === 404) {
          showError('对话不存在', '该对话可能已被删除');
        } else {
          showError('加载消息失败', errorData.error || '服务器错误');
        }

        // 清空消息列表
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      showError('加载消息失败', '网络错误，请稍后重试');
      setMessages([]);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || !currentUser) return;

    const message: Omit<ChatMessage, 'id'> = {
      conversation_id: selectedConversation.id,
      sender_id: currentUser.username || '',
      sender_name: currentUser.username || '',
      content: newMessage.trim(),
      message_type: 'text',
      timestamp: Date.now(),
      is_read: false,
    };

    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      if (response.ok) {
        const sentMessage = await response.json();
        setNewMessage('');
        await loadMessages(selectedConversation.id);
        await loadConversations();

        // 通过WebSocket通知其他参与者
        if (isConnected) {
          sendWebSocketMessage({
            type: 'message',
            data: {
              ...sentMessage,
              conversation_id: selectedConversation.id,
              participants: selectedConversation.participants,
            },
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const searchUsers = async () => {
    if (!friendSearchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await fetch(`/api/chat/search-users?q=${encodeURIComponent(friendSearchQuery)}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);

        // 预加载搜索结果用户的头像
        const searchUsernames = data.map((user: Friend) => user.username);
        preloadUserAvatars(searchUsernames);
      }
    } catch (error) {
      console.error('Failed to search users:', error);
    }
  };

  const sendFriendRequest = async (toUser: string) => {
    if (!currentUser) return;

    const request: Omit<FriendRequest, 'id'> = {
      from_user: currentUser.username || '',
      to_user: toUser,
      message: '请求添加您为好友',
      status: 'pending',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    try {
      const response = await fetch('/api/chat/friend-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (response.ok) {
        const sentRequest = await response.json();
        showSuccess('好友申请已发送', '等待对方确认');

        // 清空搜索结果和搜索框
        setFriendSearchQuery('');
        setSearchResults([]);

        // 通过WebSocket通知目标用户
        if (isConnected) {
          sendWebSocketMessage({
            type: 'friend_request',
            data: sentRequest,
            timestamp: Date.now(),
          });
        }
      } else {
        showError('发送失败', '请稍后重试');
      }
    } catch (error) {
      console.error('Failed to send friend request:', error);
      showError('发送失败', '网络错误，请稍后重试');
    }
  };

  const handleFriendRequest = async (requestId: string, status: 'accepted' | 'rejected') => {
    try {
      const response = await fetch('/api/chat/friend-requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, status }),
      });

      if (response.ok) {
        await loadFriendRequests();
        if (status === 'accepted') {
          await loadFriends();
        }
        // 处理好友申请后，减少好友请求计数
        onFriendRequestCountReset?.(1);
      }
    } catch (error) {
      console.error('Failed to handle friend request:', error);
    }
  };

  const filteredConversations = conversations.filter(conv =>
    conv.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isFriend = (username: string) => {
    return friends.some(friend => friend.username === username);
  };

  const isUserOnline = (username: string) => {
    return onlineUsers.includes(username);
  };

  // 创建或获取与好友的对话
  const startConversationWithFriend = async (friendUsername: string) => {
    try {
      // 尝试查找现有对话
      const existingConv = conversations.find(conv =>
        conv.participants.includes(friendUsername) &&
        conv.participants.includes(currentUser?.username || '')
      );

      if (existingConv) {
        setSelectedConversation(existingConv);
        setActiveTab('chat');
        loadMessages(existingConv.id);
        return;
      }

      // 创建新对话
      const newConv = {
        name: friendUsername,
        participants: [currentUser?.username || '', friendUsername],
        type: 'private' as const,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const response = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConv),
      });

      if (response.ok) {
        const createdConv = await response.json();
        setSelectedConversation(createdConv);
        setActiveTab('chat');
        await loadConversations();
        loadMessages(createdConv.id);
      }
    } catch (error) {
      console.error('Failed to start conversation:', error);
      showError('创建对话失败', '请稍后重试');
    }
  };

  // 处理标签切换
  const handleTabChange = (tab: 'chat' | 'friends') => {
    setActiveTab(tab);

    // 清除相应的未读计数
    if (tab === 'friends') {
      const currentFriendRequestCount = unreadFriendRequestCount;
      setUnreadFriendRequestCount(0);
      // 通知父组件重置好友请求计数
      onFriendRequestCountReset?.(currentFriendRequestCount);
    }
  };

  // 处理对话选择
  const handleConversationSelect = (conv: Conversation) => {
    setSelectedConversation(conv);
    loadMessages(conv.id);

    // 清除该对话的未读消息计数
    const resetCount = conversationUnreadCounts[conv.id] || 0;
    if (resetCount > 0) {
      setConversationUnreadCounts(prev => ({
        ...prev,
        [conv.id]: 0
      }));
      // 通知父组件重置聊天计数
      onChatCountReset?.(resetCount);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black bg-opacity-50" style={{ zIndex: '99999' }}>
      <div
        className="w-full max-w-6xl h-[80vh] bg-white dark:bg-gray-900 rounded-lg shadow-xl flex relative"
        style={{
          transform: `translate(${dragPosition.x}px, ${dragPosition.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out'
        }}
      >
        {/* 拖动头部 */}
        <div
          className="absolute top-0 left-0 right-0 h-8 bg-gray-100 dark:bg-gray-800 rounded-t-lg cursor-grab active:cursor-grabbing flex items-center justify-center"
          onMouseDown={handleMouseDown}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
          </div>
        </div>
        {/* 左侧面板 */}
        <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 flex flex-col mt-8">
          {/* 头部 */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold">聊天</h2>
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'
                  }`} title={isConnected ? '已连接' : '未连接'} />
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 标签页 */}
            <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => handleTabChange('chat')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors relative ${activeTab === 'chat'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
              >
                <MessageCircle className="w-4 h-4 inline-block mr-1" />
                对话
                {unreadChatCount > 0 && activeTab !== 'chat' && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {unreadChatCount > 99 ? '99+' : unreadChatCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => handleTabChange('friends')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors relative ${activeTab === 'friends'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
              >
                <Users className="w-4 h-4 inline-block mr-1" />
                好友
                {unreadFriendRequestCount > 0 && activeTab !== 'friends' && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {unreadFriendRequestCount > 99 ? '99+' : unreadFriendRequestCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 搜索栏 */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            {activeTab === 'chat' ? (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索对话..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索用户..."
                    value={friendSearchQuery}
                    onChange={(e) => {
                      setFriendSearchQuery(e.target.value);
                    }}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* 搜索结果显示在搜索框下方 */}
                {searchResults.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    <div className="p-2">
                      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">搜索结果</h4>
                      {searchResults.map((user) => (
                        <div key={user.id} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors">
                          <div className="flex items-center space-x-3 flex-1">
                            {/* 用户头像 */}
                            <img
                              src={getAvatarUrl(user.username)}
                              alt={user.nickname || user.username}
                              className="w-8 h-8 rounded-full ring-1 ring-gray-200 dark:ring-gray-600"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                target.nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                            <div className="hidden w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-medium ring-1 ring-gray-200 dark:ring-gray-600">
                              {(user.nickname || user.username).charAt(0).toUpperCase()}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                                {user.nickname || user.username}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {isFriend(user.username) ? '已是好友' : '陌生人'}
                              </div>
                            </div>
                          </div>

                          {!isFriend(user.username) && (
                            <button
                              onClick={() => sendFriendRequest(user.username)}
                              className="ml-2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                              title="发送好友申请"
                            >
                              <UserPlus className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 列表内容 */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'chat' ? (
              <div className="space-y-1 p-2">
                {filteredConversations.map((conv) => {
                  // 获取对话头像 - 私人对话显示对方头像，群聊显示群组图标
                  const getConversationAvatar = () => {
                    if (conv.participants.length === 2) {
                      // 私人对话：显示对方用户的头像
                      const otherUser = conv.participants.find(p => p !== currentUser?.username);
                      return otherUser ? (
                        <div className="relative">
                          <img
                            src={getAvatarUrl(otherUser)}
                            alt={getDisplayName(otherUser)}
                            className="w-12 h-12 rounded-full ring-2 ring-white dark:ring-gray-700 shadow-sm"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold ring-2 ring-white dark:ring-gray-700 shadow-sm">
                            {getDisplayName(otherUser).charAt(0).toUpperCase()}
                          </div>
                          {/* 在线状态指示器 */}
                          <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white dark:border-gray-700 ${isUserOnline(otherUser) ? 'bg-green-400' : 'bg-gray-400'
                            }`} />
                        </div>
                      ) : null;
                    } else {
                      // 群聊：显示群组图标和参与者头像叠加
                      const firstThreeParticipants = conv.participants.slice(0, 3);
                      return (
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white font-bold shadow-sm ring-2 ring-white dark:ring-gray-700">
                            <Users className="w-6 h-6" />
                          </div>
                          {/* 群聊成员数量指示 */}
                          <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-bold border-2 border-white dark:border-gray-700">
                            {conv.participants.length}
                          </div>
                        </div>
                      );
                    }
                  };

                  return (
                    <button
                      key={conv.id}
                      onClick={() => handleConversationSelect(conv)}
                      className={`w-full p-3 rounded-lg text-left transition-all duration-200 relative ${selectedConversation?.id === conv.id
                        ? 'bg-blue-100 dark:bg-blue-900/50 shadow-md'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800 hover:shadow-sm'
                        }`}
                    >
                      <div className="flex items-center space-x-3">
                        {/* 对话头像 */}
                        <div className="flex-shrink-0">
                          {getConversationAvatar()}
                        </div>

                        {/* 对话信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-medium text-gray-900 dark:text-white truncate">
                              {conv.name}
                            </div>
                            {/* 最后消息时间 */}
                            {conv.last_message?.timestamp && (
                              <div className="text-xs text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">
                                {new Date(conv.last_message.timestamp).toLocaleTimeString('zh-CN', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1 mr-2">
                              {conv.last_message?.message_type === 'image'
                                ? '[图片]'
                                : (conv.last_message?.content || '暂无消息')
                              }
                            </div>

                            {/* 未读消息数量 */}
                            {conversationUnreadCounts[conv.id] > 0 && (
                              <div className="flex-shrink-0">
                                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                                  {conversationUnreadCounts[conv.id] > 99 ? '99+' : conversationUnreadCounts[conv.id]}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2 p-2">
                {/* 好友申请 */}
                {friendRequests.filter(req => req.to_user === currentUser?.username && req.status === 'pending').length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">好友申请</h3>
                    {friendRequests
                      .filter(req => req.to_user === currentUser?.username && req.status === 'pending')
                      .map((request) => (
                        <div key={request.id} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow">
                          <div className="flex items-center space-x-3 mb-3">
                            {/* 申请者头像 */}
                            <div className="flex-shrink-0">
                              <img
                                src={getAvatarUrl(request.from_user)}
                                alt={request.from_user}
                                className="w-10 h-10 rounded-full ring-2 ring-white dark:ring-gray-700 shadow-sm"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  target.nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                              <div className="hidden w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold ring-2 ring-white dark:ring-gray-700 shadow-sm">
                                {request.from_user.charAt(0).toUpperCase()}
                              </div>
                            </div>

                            {/* 申请者信息 */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {request.from_user}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {new Date(request.created_at).toLocaleString('zh-CN', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="text-xs text-gray-600 dark:text-gray-300 mb-3 pl-13">
                            {request.message}
                          </div>

                          <div className="flex space-x-2 pl-13">
                            <button
                              onClick={() => handleFriendRequest(request.id, 'accepted')}
                              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors font-medium"
                            >
                              接受
                            </button>
                            <button
                              onClick={() => handleFriendRequest(request.id, 'rejected')}
                              className="px-3 py-1.5 bg-gray-500 text-white text-xs rounded-lg hover:bg-gray-600 transition-colors font-medium"
                            >
                              拒绝
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {/* 好友列表 */}
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">我的好友</h3>
                {friends.map((friend) => (
                  <button
                    key={friend.id}
                    onClick={() => startConversationWithFriend(friend.username)}
                    className="w-full p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      {/* 好友头像 */}
                      <div className="relative">
                        <img
                          src={getAvatarUrl(friend.username)}
                          alt={friend.nickname || friend.username}
                          className="w-10 h-10 rounded-full"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            target.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                        <div className="hidden w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                          {(friend.nickname || friend.username).charAt(0).toUpperCase()}
                        </div>
                        {/* 在线状态指示器 */}
                        <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 ${isUserOnline(friend.username) ? 'bg-green-400' : 'bg-gray-400'
                          }`} />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {friend.nickname || friend.username}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {isUserOnline(friend.username) ? '在线' : '离线'}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}

              </div>
            )}
          </div>
        </div>

        {/* 右侧聊天区域 */}
        <div className="flex-1 flex flex-col mt-8">
          {selectedConversation ? (
            <>
              {/* 聊天头部 */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="flex items-center space-x-3">
                  {/* 对话头像（显示对方用户的头像，如果是群聊则显示群组图标） */}
                  <div className="flex-shrink-0">
                    {selectedConversation.participants.length === 2 ? (
                      // 私人对话：显示对方的头像
                      (() => {
                        const otherUser = selectedConversation.participants.find(p => p !== currentUser?.username);
                        return otherUser ? (
                          <div className="relative">
                            <img
                              src={getAvatarUrl(otherUser)}
                              alt={getDisplayName(otherUser)}
                              className="w-12 h-12 rounded-full"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                target.nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                            <div className="hidden w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-medium">
                              {getDisplayName(otherUser).charAt(0).toUpperCase()}
                            </div>
                            {/* 在线状态 */}
                            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 ${isUserOnline(otherUser) ? 'bg-green-400' : 'bg-gray-400'
                              }`} />
                          </div>
                        ) : null;
                      })()
                    ) : (
                      // 群聊：显示群组图标
                      <div className="w-12 h-12 rounded-full bg-purple-500 flex items-center justify-center text-white font-medium">
                        <Users className="w-6 h-6" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                      {selectedConversation.name}
                    </h3>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {selectedConversation.participants.length === 2 ? (
                        // 私人对话：显示在线状态
                        (() => {
                          const otherUser = selectedConversation.participants.find(p => p !== currentUser?.username);
                          return otherUser ? (
                            <span className="flex items-center space-x-1">
                              <span>{isUserOnline(otherUser) ? '在线' : '离线'}</span>
                              <span>•</span>
                              <span>{selectedConversation.participants.length} 人</span>
                            </span>
                          ) : `${selectedConversation.participants.length} 人`;
                        })()
                      ) : (
                        // 群聊：显示参与者数量
                        `${selectedConversation.participants.length} 人`
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 消息列表 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-gray-50/30 to-white/50 dark:from-gray-800/30 dark:to-gray-900/50">
                {messages.map((message, index) => {
                  const isOwnMessage = message.sender_id === currentUser?.username;
                  const prevMessage = index > 0 ? messages[index - 1] : null;
                  const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
                  // 每条消息都显示头像
                  const showName = !prevMessage || prevMessage.sender_id !== message.sender_id;
                  const isSequential = prevMessage && prevMessage.sender_id === message.sender_id;

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} ${isSequential ? 'mt-1' : 'mt-4'}`}
                    >
                      <div className={`flex items-end space-x-3 max-w-xs lg:max-w-md xl:max-w-lg ${isOwnMessage ? 'flex-row-reverse space-x-reverse' : ''}`}>
                        {/* 头像 - 每条消息都显示 */}
                        <div className="flex-shrink-0">
                          <div className="relative">
                            <img
                              src={getAvatarUrl(message.sender_id)}
                              alt={getDisplayName(message.sender_id)}
                              className="w-10 h-10 rounded-full ring-2 ring-white dark:ring-gray-600 shadow-md"
                              onError={(e) => {
                                // 头像加载失败时显示文字头像
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                target.nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                            <div className="hidden w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold ring-2 ring-white dark:ring-gray-600 shadow-md">
                              {getDisplayName(message.sender_id).charAt(0).toUpperCase()}
                            </div>
                            {/* 在线状态指示器 */}
                            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full ring-2 ring-white dark:ring-gray-700"></div>
                          </div>
                        </div>

                        {/* 消息内容 */}
                        <div className="flex flex-col min-w-0">
                          {/* 发送者名称（仅在非连续消息时显示） */}
                          {!isOwnMessage && showName && (
                            <div className="mb-2 px-1">
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {getDisplayName(message.sender_id)}
                              </span>
                            </div>
                          )}

                          {/* 消息气泡 */}
                          <div
                            className={`relative px-5 py-3 rounded-2xl shadow-lg backdrop-blur-sm transition-all duration-200 hover:shadow-xl ${isOwnMessage
                              ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-blue-500/25 rounded-br-md'
                              : 'bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white shadow-gray-900/10 dark:shadow-black/20 ring-1 ring-gray-200/50 dark:ring-gray-600/50 rounded-bl-md'
                              }`}
                          >
                            {message.message_type === 'image' ? (
                              <div className="group">
                                <img
                                  src={message.content}
                                  alt="图片消息"
                                  className="max-w-full h-auto rounded-xl cursor-pointer transition-transform group-hover:scale-[1.02] shadow-md"
                                  style={{ maxHeight: '300px' }}
                                  onClick={() => {
                                    // 点击图片放大查看
                                    const img = new Image();
                                    img.src = message.content;
                                    const newWindow = window.open('');
                                    if (newWindow) {
                                      newWindow.document.write(`
                                        <html>
                                          <head>
                                            <title>图片查看</title>
                                            <style>
                                              body { margin:0; padding:20px; background:#000; display:flex; align-items:center; justify-content:center; }
                                              img { max-width:100%; max-height:100vh; object-fit:contain; border-radius:8px; box-shadow:0 20px 25px -5px rgb(0 0 0 / 0.4); }
                                            </style>
                                          </head>
                                          <body>
                                            <img src="${message.content}" />
                                          </body>
                                        </html>
                                      `);
                                    }
                                  }}
                                />
                                {/* 图片遮罩 */}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 rounded-xl transition-colors pointer-events-none"></div>
                              </div>
                            ) : (
                              <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                {message.content}
                              </div>
                            )}

                            {/* 消息气泡装饰尾巴 */}
                            <div
                              className={`absolute bottom-2 w-3 h-3 ${isOwnMessage
                                ? 'right-0 -mr-1.5 bg-gradient-to-br from-blue-500 to-blue-600'
                                : 'left-0 -ml-1.5 bg-white/90 dark:bg-gray-700/90 ring-1 ring-gray-200/50 dark:ring-gray-600/50'
                                } transform rotate-45`}
                            ></div>
                          </div>

                          {/* 时间戳显示在消息气泡下方 */}
                          <div className={`mt-1 px-1 ${isOwnMessage ? 'flex justify-end' : 'flex justify-start'}`}>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {formatMessageTime(message.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />

                {/* 消息列表底部装饰 */}
                <div className="h-4"></div>
              </div>

              {/* 消息输入区域 */}
              <div className="border-t border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900">
                {/* 表情选择器 */}
                {showEmojiPicker && (
                  <div className="emoji-picker-container mx-4 mt-3 mb-2 p-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl shadow-xl">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">选择表情</h3>
                      <button
                        onClick={() => setShowEmojiPicker(false)}
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-9 gap-1 max-h-40 overflow-y-auto custom-scrollbar">
                      {emojis.map((emoji, index) => (
                        <button
                          key={index}
                          onClick={() => handleEmojiSelect(emoji)}
                          className="p-2 text-xl hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 主输入区域 */}
                <div className="p-4">
                  <div className="bg-white dark:bg-gray-700 rounded-2xl shadow-sm border border-gray-200/80 dark:border-gray-600/80 backdrop-blur-sm">
                    {/* 顶部工具栏 */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-600">
                      {/* 左侧功能按钮组 */}
                      <div className="flex items-center space-x-1">
                        {/* 表情按钮 */}
                        <button
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className={`emoji-picker-container p-2.5 rounded-xl transition-all duration-200 transform hover:scale-105 ${showEmojiPicker
                            ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                            : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                            }`}
                          title="表情"
                        >
                          <Smile className="w-5 h-5" />
                        </button>

                        {/* 图片上传按钮 */}
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingImage}
                          className="p-2.5 text-gray-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                          title="上传图片"
                        >
                          {uploadingImage ? (
                            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <ImageIcon className="w-5 h-5" />
                          )}
                        </button>

                        {/* 隐藏的文件输入 */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageUpload}
                        />

                        {/* 附件按钮（预留） */}
                        <button
                          className="p-2.5 text-gray-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-xl transition-all duration-200 transform hover:scale-105"
                          disabled
                          title="附件（即将开放）"
                        >
                          <Paperclip className="w-5 h-5" />
                        </button>
                      </div>

                      {/* 右侧状态指示 */}
                      <div className="flex items-center space-x-2">
                        {/* 字符计数 */}
                        <span className="text-xs text-gray-400">
                          {newMessage.length > 0 && (
                            <span className={newMessage.length > 500 ? 'text-red-500' : ''}>
                              {newMessage.length}/1000
                            </span>
                          )}
                        </span>
                        {/* 连接状态 */}
                        <div className="flex items-center space-x-1">
                          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                          <span className="text-xs text-gray-400">
                            {isConnected ? '在线' : '离线'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 消息输入区域 */}
                    <div className="p-4">
                      <div className="relative">
                        <textarea
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          placeholder="输入消息内容... 按Enter发送，Shift+Enter换行"
                          className="w-full px-4 py-3 pr-16 bg-gray-50 dark:bg-gray-600 border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white dark:focus:bg-gray-500 placeholder-gray-400 dark:placeholder-gray-400 resize-none min-h-[48px] max-h-32 transition-all duration-200"
                          rows={1}
                          maxLength={1000}
                          style={{ height: 'auto' }}
                          onInput={(e) => {
                            // 自动调整高度
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = Math.min(target.scrollHeight, 128) + 'px';
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                        />

                        {/* 发送按钮 */}
                        <button
                          onClick={handleSendMessage}
                          disabled={!newMessage.trim() || uploadingImage}
                          className="absolute right-2 bottom-2 p-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl transition-all duration-200 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-lg hover:shadow-xl"
                          title={!newMessage.trim() ? '请输入消息内容' : '发送消息 (Enter)'}
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* 底部信息栏 */}
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-600/50 rounded-b-2xl border-t border-gray-100 dark:border-gray-600">
                      <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                        <span className="flex items-center space-x-1">
                          <span>📝</span>
                          <span>支持文字</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <span>😊</span>
                          <span>表情</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <span>🖼️</span>
                          <span>图片 (5MB内)</span>
                        </span>
                      </div>

                      <div className="text-xs text-gray-400">
                        {uploadingImage ? (
                          <span className="flex items-center space-x-1 text-blue-500">
                            <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <span>上传中...</span>
                          </span>
                        ) : (
                          <span>Enter发送</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
              选择一个对话开始聊天
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
