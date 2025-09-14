/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { createClient, RedisClientType } from 'redis';

import { AdminConfig } from './admin.types';
import { Favorite, IStorage, PlayRecord, SkipConfig, ChatMessage, Conversation, Friend, FriendRequest } from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 连接配置接口
export interface RedisConnectionConfig {
  url: string;
  clientName: string; // 用于日志显示，如 "Redis" 或 "Pika"
}

// 添加Redis操作重试包装器
function createRetryWrapper(clientName: string, getClient: () => RedisClientType) {
  return async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (err: any) {
        const isLastAttempt = i === maxRetries - 1;
        const isConnectionError =
          err.message?.includes('Connection') ||
          err.message?.includes('ECONNREFUSED') ||
          err.message?.includes('ENOTFOUND') ||
          err.code === 'ECONNRESET' ||
          err.code === 'EPIPE';

        if (isConnectionError && !isLastAttempt) {
          console.log(
            `${clientName} operation failed, retrying... (${i + 1}/${maxRetries})`
          );
          console.error('Error:', err.message);

          // 等待一段时间后重试
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

          // 尝试重新连接
          try {
            const client = getClient();
            if (!client.isOpen) {
              await client.connect();
            }
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr);
          }

          continue;
        }

        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  };
}

// 创建客户端的工厂函数
export function createRedisClient(config: RedisConnectionConfig, globalSymbol: symbol): RedisClientType {
  let client: RedisClientType | undefined = (global as any)[globalSymbol];

  if (!client) {
    if (!config.url) {
      throw new Error(`${config.clientName}_URL env variable not set`);
    }

    // 创建客户端配置
    const clientConfig: any = {
      url: config.url,
      socket: {
        // 重连策略：指数退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(`${config.clientName} reconnection attempt ${retries + 1}`);
          if (retries > 10) {
            console.error(`${config.clientName} max reconnection attempts exceeded`);
            return false; // 停止重连
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指数退避，最大30秒
        },
        connectTimeout: 10000, // 10秒连接超时
        // 设置no delay，减少延迟
        noDelay: true,
      },
      // 添加其他配置
      pingInterval: 30000, // 30秒ping一次，保持连接活跃
    };

    client = createClient(clientConfig);

    // 添加错误事件监听
    client.on('error', (err) => {
      console.error(`${config.clientName} client error:`, err);
    });

    client.on('connect', () => {
      console.log(`${config.clientName} connected`);
    });

    client.on('reconnecting', () => {
      console.log(`${config.clientName} reconnecting...`);
    });

    client.on('ready', () => {
      console.log(`${config.clientName} ready`);
    });

    // 初始连接，带重试机制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log(`${config.clientName} connected successfully`);
      } catch (err) {
        console.error(`${config.clientName} initial connection failed:`, err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (global as any)[globalSymbol] = client;
  }

  return client;
}

// 抽象基类，包含所有通用的Redis操作逻辑
export abstract class BaseRedisStorage implements IStorage {
  protected client: RedisClientType;
  protected withRetry: <T>(operation: () => Promise<T>, maxRetries?: number) => Promise<T>;

  constructor(config: RedisConnectionConfig, globalSymbol: symbol) {
    this.client = createRedisClient(config, globalSymbol);
    this.withRetry = createRetryWrapper(config.clientName, () => this.client);
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (JSON.parse(val) as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.prKey(userName, key), JSON.stringify(record))
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await this.withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await this.withRetry(() => this.client.mGet(keys));
    const result: Record<string, PlayRecord> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const rec = JSON.parse(raw) as PlayRecord;
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = rec;
      }
    });
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (JSON.parse(val) as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.favKey(userName, key), JSON.stringify(favorite))
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await this.withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await this.withRetry(() => this.client.mGet(keys));
    const result: Record<string, Favorite> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const fav = JSON.parse(raw) as Favorite;
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = fav;
      }
    });
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await this.withRetry(() => this.client.set(this.userPwdKey(userName), password));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    // 确保比较时都是字符串类型
    return ensureString(stored) === password;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await this.withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), newPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await this.withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await this.withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await this.withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await this.withRetry(() => this.client.del(playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await this.withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await this.withRetry(() => this.client.del(favoriteKeys));
    }

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await this.withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await this.withRetry(() => this.client.del(skipConfigKeys));
    }
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await this.withRetry(() =>
      this.client.lRange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await this.withRetry(() => this.client.lPush(key, ensureString(keyword)));
    // 限制最大长度
    await this.withRetry(() => this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    } else {
      await this.withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await this.withRetry(() => this.client.keys('u:*:pwd'));
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? ensureString(match[1]) : undefined;
      })
      .filter((u): u is string => typeof u === 'string');
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await this.withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (JSON.parse(val) as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.adminConfigKey(), JSON.stringify(config))
    );
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id))
    );
    return val ? (JSON.parse(val) as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(
        this.skipConfigKey(userName, source, id),
        JSON.stringify(config)
      )
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await this.withRetry(() => this.client.keys(pattern));

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: SkipConfig } = {};

    // 批量获取所有配置
    const values = await this.withRetry(() => this.client.mGet(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = JSON.parse(value as string) as SkipConfig;
        }
      }
    });

    return configs;
  }

  // ---------- 用户头像 ----------
  private avatarKey(userName: string) {
    return `u:${userName}:avatar`;
  }

  async getUserAvatar(userName: string): Promise<string | null> {
    const val = await this.withRetry(() => this.client.get(this.avatarKey(userName)));
    return val ? ensureString(val) : null;
  }

  async setUserAvatar(userName: string, avatarBase64: string): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.avatarKey(userName), avatarBase64)
    );
  }

  async deleteUserAvatar(userName: string): Promise<void> {
    await this.withRetry(() =>
      this.client.del(this.avatarKey(userName))
    );
  }

  // ---------- 弹幕管理 ----------
  private danmuKey(videoId: string) {
    return `video:${videoId}:danmu`;
  }

  async getDanmu(videoId: string): Promise<any[]> {
    const val = await this.withRetry(() => this.client.lRange(this.danmuKey(videoId), 0, -1));
    return val ? val.map(item => JSON.parse(ensureString(item))) : [];
  }

  async saveDanmu(videoId: string, userName: string, danmu: {
    text: string;
    color: string;
    mode: number;
    time: number;
    timestamp: number;
  }): Promise<void> {
    const danmuData = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userName,
      ...danmu
    };
    await this.withRetry(() =>
      this.client.rPush(this.danmuKey(videoId), JSON.stringify(danmuData))
    );
  }

  async deleteDanmu(videoId: string, danmuId: string): Promise<void> {
    // 获取所有弹幕
    const danmuList = await this.getDanmu(videoId);
    // 过滤掉要删除的弹幕
    const filteredList = danmuList.filter(item => item.id !== danmuId);

    // 清除原有弹幕列表
    await this.withRetry(() => this.client.del(this.danmuKey(videoId)));

    // 重新插入过滤后的弹幕
    if (filteredList.length > 0) {
      const danmuStrings = filteredList.map(item => JSON.stringify(item));
      await this.withRetry(() =>
        this.client.rPush(this.danmuKey(videoId), danmuStrings)
      );
    }
  }

  // ---------- 机器码管理 ----------
  private machineCodeKey(userName: string) {
    return `u:${userName}:machine_code`;
  }

  private machineCodeListKey() {
    return 'system:machine_codes';
  }

  async getUserMachineCode(userName: string): Promise<string | null> {
    const val = await this.withRetry(() => this.client.get(this.machineCodeKey(userName)));
    if (!val) return null;

    try {
      const data = JSON.parse(ensureString(val));
      return data.machineCode || null;
    } catch {
      return null;
    }
  }

  async setUserMachineCode(userName: string, machineCode: string, deviceInfo?: string): Promise<void> {
    const data = {
      machineCode,
      deviceInfo: deviceInfo || '',
      bindTime: Date.now()
    };

    // 保存用户的机器码
    await this.withRetry(() =>
      this.client.set(this.machineCodeKey(userName), JSON.stringify(data))
    );

    // 在机器码列表中记录绑定关系
    await this.withRetry(() =>
      this.client.hSet(this.machineCodeListKey(), machineCode, userName)
    );
  }

  async deleteUserMachineCode(userName: string): Promise<void> {
    // 先获取用户的机器码
    const userMachineCode = await this.getUserMachineCode(userName);

    // 删除用户的机器码记录
    await this.withRetry(() =>
      this.client.del(this.machineCodeKey(userName))
    );

    // 从机器码列表中删除绑定关系
    if (userMachineCode) {
      await this.withRetry(() =>
        this.client.hDel(this.machineCodeListKey(), userMachineCode)
      );
    }
  }

  async getMachineCodeUsers(): Promise<Record<string, { machineCode: string; deviceInfo?: string; bindTime: number }>> {
    const result: Record<string, { machineCode: string; deviceInfo?: string; bindTime: number }> = {};

    try {
      // 获取所有用户的机器码信息
      const pattern = 'u:*:machine_code';
      const keys = await this.withRetry(() => this.client.keys(pattern));

      for (const key of keys) {
        const userName = key.replace('u:', '').replace(':machine_code', '');
        const val = await this.withRetry(() => this.client.get(key));

        if (val) {
          try {
            const data = JSON.parse(ensureString(val));
            result[userName] = data;
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (error) {
      console.error('获取机器码用户列表失败:', error);
    }

    return result;
  }

  async isMachineCodeBound(machineCode: string): Promise<string | null> {
    const val = await this.withRetry(() => this.client.hGet(this.machineCodeListKey(), machineCode));
    return val ? ensureString(val) : null;
  }

  // ---------- 聊天功能 ----------
  // 私有键生成方法
  private messageKey(messageId: string) {
    return `msg:${messageId}`;
  }

  private conversationKey(conversationId: string) {
    return `conv:${conversationId}`;
  }

  private conversationMessagesKey(conversationId: string) {
    return `conv:${conversationId}:messages`;
  }

  private userConversationsKey(userName: string) {
    return `u:${userName}:conversations`;
  }

  private userFriendsKey(userName: string) {
    return `u:${userName}:friends`;
  }

  private userFriendRequestsKey(userName: string) {
    return `u:${userName}:friend_requests`;
  }

  private friendKey(friendId: string) {
    return `friend:${friendId}`;
  }

  private friendRequestKey(requestId: string) {
    return `friend_req:${requestId}`;
  }

  // 消息管理
  async saveMessage(message: ChatMessage): Promise<void> {
    // 保存消息详情
    await this.withRetry(() =>
      this.client.set(this.messageKey(message.id), JSON.stringify(message))
    );

    // 将消息ID添加到对话的消息列表中（按时间排序）
    await this.withRetry(() =>
      this.client.zAdd(this.conversationMessagesKey(message.conversation_id), {
        score: message.timestamp,
        value: message.id
      })
    );
  }

  async getMessages(conversationId: string, limit = 50, offset = 0): Promise<ChatMessage[]> {
    // 从有序集合中获取消息ID列表（按时间倒序）
    const messageIds = await this.withRetry(() =>
      this.client.zRange(this.conversationMessagesKey(conversationId), offset, offset + limit - 1, { REV: true })
    );

    const messages: ChatMessage[] = [];
    for (const messageId of messageIds) {
      const messageData = await this.withRetry(() => this.client.get(this.messageKey(messageId)));
      if (messageData) {
        try {
          messages.push(JSON.parse(ensureString(messageData)));
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      }
    }

    return messages.reverse(); // 返回正序消息
  }

  async markMessageAsRead(messageId: string): Promise<void> {
    const messageData = await this.withRetry(() => this.client.get(this.messageKey(messageId)));
    if (messageData) {
      try {
        const message = JSON.parse(ensureString(messageData));
        message.is_read = true;
        await this.withRetry(() =>
          this.client.set(this.messageKey(messageId), JSON.stringify(message))
        );
      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    }
  }

  // 对话管理
  async getConversations(userName: string): Promise<Conversation[]> {
    const conversationIds = await this.withRetry(() =>
      this.client.sMembers(this.userConversationsKey(userName))
    );

    const conversations: Conversation[] = [];
    for (const conversationId of conversationIds) {
      const conversation = await this.getConversation(conversationId);
      if (conversation) {
        conversations.push(conversation);
      }
    }

    // 按最后更新时间排序
    return conversations.sort((a, b) => b.updated_at - a.updated_at);
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const conversationData = await this.withRetry(() =>
      this.client.get(this.conversationKey(conversationId))
    );

    if (!conversationData) return null;

    try {
      return JSON.parse(ensureString(conversationData));
    } catch (error) {
      console.error('Error parsing conversation:', error);
      return null;
    }
  }

  async createConversation(conversation: Conversation): Promise<void> {
    // 保存对话详情
    await this.withRetry(() =>
      this.client.set(this.conversationKey(conversation.id), JSON.stringify(conversation))
    );

    // 将对话ID添加到每个参与者的对话列表中
    for (const participant of conversation.participants) {
      await this.withRetry(() =>
        this.client.sAdd(this.userConversationsKey(participant), conversation.id)
      );
    }
  }

  async updateConversation(conversationId: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (conversation) {
      Object.assign(conversation, updates);
      await this.withRetry(() =>
        this.client.set(this.conversationKey(conversationId), JSON.stringify(conversation))
      );
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (conversation) {
      // 从每个参与者的对话列表中移除
      for (const participant of conversation.participants) {
        await this.withRetry(() =>
          this.client.sRem(this.userConversationsKey(participant), conversationId)
        );
      }

      // 删除对话详情
      await this.withRetry(() => this.client.del(this.conversationKey(conversationId)));

      // 删除对话的消息列表
      await this.withRetry(() => this.client.del(this.conversationMessagesKey(conversationId)));
    }
  }

  // 好友管理
  async getFriends(userName: string): Promise<Friend[]> {
    const friendIds = await this.withRetry(() =>
      this.client.sMembers(this.userFriendsKey(userName))
    );

    const friends: Friend[] = [];
    for (const friendId of friendIds) {
      const friendData = await this.withRetry(() => this.client.get(this.friendKey(friendId)));
      if (friendData) {
        try {
          friends.push(JSON.parse(ensureString(friendData)));
        } catch (error) {
          console.error('Error parsing friend:', error);
        }
      }
    }

    return friends.sort((a, b) => b.added_at - a.added_at);
  }

  async addFriend(userName: string, friend: Friend): Promise<void> {
    // 保存好友详情
    await this.withRetry(() =>
      this.client.set(this.friendKey(friend.id), JSON.stringify(friend))
    );

    // 将好友ID添加到用户的好友列表中
    await this.withRetry(() =>
      this.client.sAdd(this.userFriendsKey(userName), friend.id)
    );
  }

  async removeFriend(userName: string, friendId: string): Promise<void> {
    // 从用户的好友列表中移除
    await this.withRetry(() =>
      this.client.sRem(this.userFriendsKey(userName), friendId)
    );

    // 删除好友详情
    await this.withRetry(() => this.client.del(this.friendKey(friendId)));
  }

  async updateFriendStatus(friendId: string, status: Friend['status']): Promise<void> {
    const friendData = await this.withRetry(() => this.client.get(this.friendKey(friendId)));
    if (friendData) {
      try {
        const friend = JSON.parse(ensureString(friendData));
        friend.status = status;
        await this.withRetry(() =>
          this.client.set(this.friendKey(friendId), JSON.stringify(friend))
        );
      } catch (error) {
        console.error('Error updating friend status:', error);
      }
    }
  }

  // 好友申请管理
  async getFriendRequests(userName: string): Promise<FriendRequest[]> {
    const requestIds = await this.withRetry(() =>
      this.client.sMembers(this.userFriendRequestsKey(userName))
    );

    const requests: FriendRequest[] = [];
    for (const requestId of requestIds) {
      const requestData = await this.withRetry(() => this.client.get(this.friendRequestKey(requestId)));
      if (requestData) {
        try {
          const request = JSON.parse(ensureString(requestData));
          // 只返回相关的申请（发送给该用户的或该用户发送的）
          if (request.to_user === userName || request.from_user === userName) {
            requests.push(request);
          }
        } catch (error) {
          console.error('Error parsing friend request:', error);
        }
      }
    }

    return requests.sort((a, b) => b.created_at - a.created_at);
  }

  async createFriendRequest(request: FriendRequest): Promise<void> {
    // 保存申请详情
    await this.withRetry(() =>
      this.client.set(this.friendRequestKey(request.id), JSON.stringify(request))
    );

    // 将申请ID添加到双方的申请列表中
    await this.withRetry(() =>
      this.client.sAdd(this.userFriendRequestsKey(request.from_user), request.id)
    );
    await this.withRetry(() =>
      this.client.sAdd(this.userFriendRequestsKey(request.to_user), request.id)
    );
  }

  async updateFriendRequest(requestId: string, status: FriendRequest['status']): Promise<void> {
    const requestData = await this.withRetry(() => this.client.get(this.friendRequestKey(requestId)));
    if (requestData) {
      try {
        const request = JSON.parse(ensureString(requestData));
        request.status = status;
        request.updated_at = Date.now();
        await this.withRetry(() =>
          this.client.set(this.friendRequestKey(requestId), JSON.stringify(request))
        );
      } catch (error) {
        console.error('Error updating friend request:', error);
      }
    }
  }

  async deleteFriendRequest(requestId: string): Promise<void> {
    const requestData = await this.withRetry(() => this.client.get(this.friendRequestKey(requestId)));
    if (requestData) {
      try {
        const request = JSON.parse(ensureString(requestData));

        // 从双方的申请列表中移除
        await this.withRetry(() =>
          this.client.sRem(this.userFriendRequestsKey(request.from_user), requestId)
        );
        await this.withRetry(() =>
          this.client.sRem(this.userFriendRequestsKey(request.to_user), requestId)
        );
      } catch (error) {
        console.error('Error deleting friend request:', error);
      }
    }

    // 删除申请详情
    await this.withRetry(() => this.client.del(this.friendRequestKey(requestId)));
  }

  // 用户搜索
  async searchUsers(query: string): Promise<Friend[]> {
    const allUsers = await this.getAllUsers();
    const matchedUsers = allUsers.filter(username =>
      username.toLowerCase().includes(query.toLowerCase())
    );

    // 转换为Friend格式返回
    return matchedUsers.map(username => ({
      id: username,
      username,
      status: 'offline' as const,
      added_at: 0,
    }));
  }

  // 清空所有数据
  async clearAllData(): Promise<void> {
    try {
      // 获取所有用户
      const allUsers = await this.getAllUsers();

      // 删除所有用户及其数据
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 删除管理员配置
      await this.withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }
}
