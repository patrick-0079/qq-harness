import fs from 'node:fs';
import path from 'node:path';
import { importLegacy } from '@qq-harness/legacy-import';
import { openSqliteStorage } from '@qq-harness/storage-sqlite';

const args = process.argv.slice(2);
const sourceArg = args.find((arg) => arg.startsWith('--source='))?.slice(9);
const databaseArg = args.find((arg) => arg.startsWith('--database='))?.slice(11);
if (!sourceArg || !path.isAbsolute(sourceArg)) throw new Error('请用 --source=绝对路径 指定离线旧数据目录');
const source = fs.realpathSync(sourceArg);
if (fs.existsSync(path.join(source, 'qq-agent.lock')))
  throw new Error('旧数据目录存在实例锁，请停止旧实例并使用离线副本');
if (!args.includes('--apply')) {
  console.log(JSON.stringify({ dryRun: true, ...importLegacy(source) }, null, 2));
} else {
  if (!databaseArg || !path.isAbsolute(databaseArg))
    throw new Error('应用导入时必须用 --database=绝对路径 指定新数据库');
  const database = path.resolve(databaseArg);
  const relative = path.relative(source, database);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative)))
    throw new Error('目标数据库不能放在旧数据目录内');
  if (fs.existsSync(database + '-wal') || fs.existsSync(path.join(path.dirname(database), 'harness.lock')))
    throw new Error('目标数据库可能正在使用，请停止目标实例');
  const storage = openSqliteStorage(database);
  try {
    console.log(
      JSON.stringify(
        { dryRun: false, ...importLegacy(source, storage.store), integrity: storage.integrity() },
        null,
        2,
      ),
    );
  } finally {
    storage.close();
  }
}
