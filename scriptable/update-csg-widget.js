// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: cloud-download-alt;
/**
 * 从 GitHub 更新「南方电网.js」小组件脚本
 * 路径：iCloud/Scriptable/南方电网.js
 *
 * 快捷指令：添加「运行脚本」→ 选本脚本即可
 */
const REMOTE =
  "https://raw.githubusercontent.com/m0e16/95598-Widgets/main/scriptable/csg-widget.js";
const TARGET_NAME = "南方电网.js";

async function main() {
  const fm = FileManager.iCloud();
  const path = fm.joinPath(fm.documentsDirectory(), TARGET_NAME);

  const req = new Request(REMOTE);
  req.timeoutInterval = 30;
  const code = await req.loadString();

  if (!code || code.length < 100 || !code.includes("Scriptable")) {
    throw new Error("下载内容异常，请检查网络或仓库地址");
  }

  fm.writeString(path, code);

  // 触发 iCloud 同步（若文件在云盘）
  try {
    if (!fm.isFileDownloaded(path)) {
      await fm.downloadFileFromiCloud(path);
    }
  } catch (_) {}

  const msg = `已更新 ${TARGET_NAME}（${code.length} 字符）`;
  if (config.runsInApp) {
    const n = new Notification();
    n.title = "南方电网";
    n.body = msg;
    await n.schedule();
  }
  console.log(msg);
  Script.setShortcutOutput(msg);
  Script.complete();
}

await main();
