/**
 * 结构化路径 API —— 禁止在应用代码中用字符串拼接构造路径。
 * 本模块是前端唯一的路径构造点；后端权威路径构造在 Rust（PathBuf）。
 */

export function joinSegments(...segments: string[]): string {
  const parts = segments.filter((s) => s !== undefined && s !== null && s !== "");
  if (parts.length === 0) return "";
  const isAbs = /^[A-Za-z]:[\\/]/.test(parts[0]) || parts[0].startsWith("/") || parts[0].startsWith("\\\\");
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("/") || p.startsWith("\\")) {
      out += p;
    } else {
      out += (out.endsWith("/") || out.endsWith("\\") ? "" : "\\") + p;
    }
  }
  return isAbs ? out.replace(/\//g, "\\") : out;
}

/** 项目目录路径模型。后端返回的路径均为本机绝对路径（Windows）。 */
export class ProjectPaths {
  constructor(private readonly rootDir: string) {}

  root(): string {
    return this.rootDir;
  }

  /** 项目主文件（project.storyforge）。 */
  projectFile(): string {
    return joinSegments(this.rootDir, "project.storyforge");
  }

  /** 项目备份（i 从 1..3）。 */
  backupFile(i: number): string {
    return `${this.projectFile()}.bak${i}`;
  }

  assetsDir(): string {
    return joinSegments(this.rootDir, "assets");
  }

  /** 素材文件绝对路径（fileName 为 assets/ 内文件名）。 */
  assetFile(fileName: string): string {
    return joinSegments(this.assetsDir(), fileName);
  }
}
