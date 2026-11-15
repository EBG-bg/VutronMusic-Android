// Only known failure signals select a recovery action. Never replay a write operation.
export function describeAppFailure(message: string) {
  const playbackRules = [
    ['notReady', /歌曲尚未准备好|^请先播放歌曲$/],
    ['trackChanged', /歌曲已切换.*A\/B/],
    ['abRange', /A\/B 标记(?:超出歌曲范围|位置无效)/],
    ['abSpan', /请设置 A、B 两个位置，间隔至少0\.5秒/],
    ['sleepConflict', /请先取消按歌曲结束的睡眠定时/],
    ['abConflict', /请先关闭 A\/B 循环/],
    ['sleepCount', /歌曲数量应为1至100首/],
    ['sleepDuration', /睡眠定时应为1秒至24小时/],
    ['sleepFade', /淡出时间无效/],
    ['invalidRequest', /睡眠定时模式无效|A\/B 循环(?:操作|开关)无效/]
  ] as const
  const playbackKind = playbackRules.find(([, pattern]) => pattern.test(message))?.[0]
  if (playbackKind) return { kind: 'playbackFeature', messageKey: `mobile.playbackFeatureErrors.${playbackKind}`, hintKey: 'mobile.playbackFeatureErrors.hint' }
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
