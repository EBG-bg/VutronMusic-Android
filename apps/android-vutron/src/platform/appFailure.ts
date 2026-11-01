// Only known failure signals select a recovery action. Never replay a write operation.
export function describeAppFailure(message: string) {
  const rules = [
    ['folders', /SecurityException|persisted.*permission|permission.*(?:uri|folder)|目录.*(?:授权|权限|失效)|文件夹.*(?:授权|权限|失效)/i],
    ['storage', /ENOSPC|no space left|存储空间不足|磁盘空间不足|空间不够/i],
    ['auth', /(?:登录|会话).*(?:失效|过期)|需要.*登录|请先登录|未登录|not logged|unauthori[sz]ed|login required|HTTP\s*401\b/i],
    ['timeout', /timed?\s*out|timeout|超时/i],
    ['network', /UnknownHostException|ConnectException|network|connection (?:refused|reset)|unable to resolve host|failed to fetch|网络|无法连接|连接失败|断网/i]
  ] as const
  const kind = rules.find(([, pattern]) => pattern.test(message))?.[0] || 'unknown'
  return { kind, messageKey: `mobile.errorNotice.${kind}`, hintKey: `mobile.errorNotice.${kind}Hint` }
}
