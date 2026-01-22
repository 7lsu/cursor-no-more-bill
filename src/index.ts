/**
 * Cursor 按量付费监控 Worker
 * 每小时检查账号的按量付费状态，如果开启则自动关闭并发送通知
 */

interface Env {
  CURSOR_KV: KVNamespace;
  WECHAT_WEBHOOK_KEY: string;
}

interface Account {
  email: string;
  cookie: string;
}

// Cursor API 响应类型
interface GetHardLimitResponse {
  noUsageBasedAllowed?: boolean;
  hardLimit?: number;
}

// 关闭按量付费的请求体
const DISABLE_HARD_LIMIT_BODY = {
  hardLimit: 0,
  noUsageBasedAllowed: true,
  preserveHardLimitPerUser: false,
  perUserMonthlyLimitDollars: 0,
  clearPerUserMonthlyLimitDollars: false,
  isDynamicTeamLimit: false,
};

/**
 * 发送企业微信通知
 */
async function sendWeChatNotification(webhookKey: string, message: string): Promise<boolean> {
  if (!webhookKey) {
    console.error('企业微信 Webhook Key 未配置');
    return false;
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${webhookKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'text',
        text: {
          content: message,
        },
      }),
    });

    if (!response.ok) {
      console.error(`发送通知失败: HTTP ${response.status}`);
      return false;
    }

    const result = await response.json() as { errcode: number; errmsg: string };
    if (result.errcode !== 0) {
      console.error(`发送通知失败: ${result.errmsg}`);
      return false;
    }

    console.log(`通知发送成功: ${message}`);
    return true;
  } catch (error) {
    console.error(`发送通知异常: ${error}`);
    return false;
  }
}

/**
 * 检查账号的按量付费状态
 */
async function checkHardLimit(cookie: string): Promise<GetHardLimitResponse | null> {
  const url = 'https://cursor.com/api/dashboard/get-hard-limit';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://cursor.com',
        'Referer': 'https://cursor.com/settings',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      console.error(`检查状态失败: HTTP ${response.status}`);
      return null;
    }

    return await response.json() as GetHardLimitResponse;
  } catch (error) {
    console.error(`检查状态异常: ${error}`);
    return null;
  }
}

/**
 * 关闭账号的按量付费
 */
async function disableHardLimit(cookie: string): Promise<boolean> {
  const url = 'https://cursor.com/api/dashboard/set-hard-limit';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://cursor.com',
        'Referer': 'https://cursor.com/settings',
      },
      body: JSON.stringify(DISABLE_HARD_LIMIT_BODY),
    });

    if (!response.ok) {
      console.error(`关闭按量付费失败: HTTP ${response.status}`);
      return false;
    }

    console.log('按量付费已关闭');
    return true;
  } catch (error) {
    console.error(`关闭按量付费异常: ${error}`);
    return false;
  }
}

/**
 * 处理单个账号
 */
async function processAccount(account: Account, webhookKey: string): Promise<void> {
  console.log(`检查账号: ${account.email}`);

  const status = await checkHardLimit(account.cookie);

  if (status === null) {
    console.error(`账号 ${account.email} 检查失败，可能 Cookie 已过期`);
    await sendWeChatNotification(
      webhookKey,
      `账号 ${account.email} 检查失败，可能 Cookie 已过期，请更新 Cookie`
    );
    return;
  }

  // 检查是否开启了按量付费
  if (status.noUsageBasedAllowed === true) {
    console.log(`账号 ${account.email} 按量付费未开启，状态正常`);
    return;
  }

  // hardLimit 存在且不为 0 表示按量付费已开启
  if (status.hardLimit !== undefined && status.hardLimit > 0) {
    console.warn(`账号 ${account.email} 按量付费已开启 (限额: $${status.hardLimit})，正在关闭...`);

    const success = await disableHardLimit(account.cookie);

    if (success) {
      await sendWeChatNotification(
        webhookKey,
        `账号 ${account.email} 按量付费被开启（限额 $${status.hardLimit}），已自动关闭`
      );
    } else {
      await sendWeChatNotification(
        webhookKey,
        `账号 ${account.email} 按量付费被开启，但自动关闭失败，请手动处理！`
      );
    }
    return;
  }

  console.log(`账号 ${account.email} 状态正常`);
}

/**
 * 主处理函数
 */
async function handleScheduled(env: Env): Promise<void> {
  console.log('=== Cursor 按量付费监控任务开始 ===');
  console.log(`执行时间: ${new Date().toISOString()}`);

  // 从 KV 读取账号列表
  const accountsJson = await env.CURSOR_KV.get('cursor_accounts');

  if (!accountsJson) {
    console.error('未找到账号配置，请在 KV 中添加 cursor_accounts');
    await sendWeChatNotification(
      env.WECHAT_WEBHOOK_KEY,
      '脚本因错误停止：未找到账号配置，请在 KV 中添加 cursor_accounts'
    );
    return;
  }

  let accounts: Account[];
  try {
    accounts = JSON.parse(accountsJson) as Account[];
  } catch (error) {
    console.error(`解析账号配置失败: ${error}`);
    await sendWeChatNotification(
      env.WECHAT_WEBHOOK_KEY,
      '脚本因错误停止：账号配置 JSON 格式错误，请检查'
    );
    return;
  }

  if (accounts.length === 0) {
    console.log('账号列表为空');
    return;
  }

  console.log(`共有 ${accounts.length} 个账号需要检查`);

  // 逐个处理账号
  for (const account of accounts) {
    try {
      await processAccount(account, env.WECHAT_WEBHOOK_KEY);
    } catch (error) {
      console.error(`处理账号 ${account.email} 时发生错误: ${error}`);
      await sendWeChatNotification(
        env.WECHAT_WEBHOOK_KEY,
        `处理账号 ${account.email} 时发生错误，请查看日志`
      );
    }
  }

  console.log('=== Cursor 按量付费监控任务完成 ===');
}

export default {
  /**
   * Cron Trigger 入口
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },

  /**
   * HTTP 请求入口（用于手动测试）
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 手动触发检查
    if (url.pathname === '/check') {
      ctx.waitUntil(handleScheduled(env));
      return new Response(JSON.stringify({
        status: 'ok',
        message: '检查任务已触发，请查看日志'
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 健康检查
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      name: 'Cursor 按量付费监控',
      endpoints: {
        '/check': '手动触发检查',
        '/health': '健康检查',
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
