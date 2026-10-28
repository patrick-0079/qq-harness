const runLabels: Record<string, string> = {
  completed: '已完成',
  running: '执行中',
  queued: '排队中',
  failed: '失败',
  cancelled: '已取消',
  silent: '静默结束',
  unverified: '未验证发言',
  exhausted: '已达轮数上限',
  interrupted: '重启中断',
  skipped: '已跳过',
};
const pluginLabels: Record<string, string> = {
  active: '运行中',
  disabled: '已停用',
  waiting: '等待依赖',
  failed: '失败',
  starting: '启动中',
  stopping: '停止中',
  stopped: '已停止',
  registered: '已注册',
};
export const runStatusLabel = (value: string) => runLabels[value] ?? value;
export const pluginStatusLabel = (value: string) => pluginLabels[value] ?? value;
