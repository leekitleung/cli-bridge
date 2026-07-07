/**
 * 用户友好的错误消息映射
 *
 * 将内部错误代码映射为用户可理解的错误消息。
 * 用于在 UI 和日志中显示友好的错误信息。
 */

export const USER_FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  // 快照相关
  'snapshot-read-failed': '无法读取保存的状态数据，请检查数据目录权限或尝试重启服务',
  'snapshot-missing': '找不到保存的状态数据，服务将使用空状态启动',
  'snapshot-write-failed': '无法保存状态数据，请检查磁盘空间和目录权限',

  // 绑定相关
  'binding-hash-mismatch': '状态数据损坏，请尝试删除数据目录后重启',
  'parent-binding-not-found': '找不到父级绑定配置',

  // 执行相关
  'executor-error': '执行器发生错误，请检查执行器配置',
  'no-available-executor': '没有可用的执行器，请检查执行器服务状态',
  'workbuddy-timeout': '执行超时，请检查 WorkBuddy 服务或增加超时时间',
  'execution-timeout': '执行超时，请稍后重试',

  // 端点相关
  'endpoint-not-found': '找不到指定的端点',
  'endpoint-offline': '端点已离线，请检查目标服务状态',
  'endpoint-mismatch': '端点配置不匹配，请检查端点设置',
  'endpoint-already-offline': '端点已经是离线状态',

  // 配对相关
  'invalid-pairing-token': '配对令牌无效或已过期，请重新获取',
  'pairing-session-expired': '配对会话已过期，请重新发起配对',

  // 执行相关 (补充)
  'executor-unavailable': '执行器暂时不可用，请稍后重试',

  // 通用
  'inbound-consume-failed': '处理入站消息失败',
  'chatgpt-fill-failed': '无法填入 ChatGPT，请检查扩展连接状态',
  'claim-lease-expired': '会话已过期，请刷新页面重试',
  'duplicate-endpoint-id': '端点 ID 已存在，请使用不同的 ID',
};

/**
 * 获取用户友好的错误消息
 */
export function getUserFriendlyErrorMessage(errorCode: string): string {
  return USER_FRIENDLY_ERROR_MESSAGES[errorCode] ?? `发生了未知错误 (${errorCode})，请查看日志获取更多信息`;
}
