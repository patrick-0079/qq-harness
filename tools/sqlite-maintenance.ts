import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const [command, source, target] = process.argv.slice(2);
if (!source || !path.isAbsolute(source))
  throw new Error('用法：sqlite-maintenance integrity|backup <数据库绝对路径> [备份绝对路径]');
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (command === 'integrity') console.log(db.prepare('PRAGMA integrity_check').get());
  else if (command === 'backup') {
    if (!target || !path.isAbsolute(target) || fs.existsSync(target))
      throw new Error('备份目标必须是不存在的绝对文件路径');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await backup(db, target);
    console.log('SQLite 一致性备份已完成。配置文件需另外备份。');
  } else throw new Error('未知命令');
} finally {
  db.close();
}
