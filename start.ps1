# StoryForge Studio 启动脚本（Windows PowerShell 5.1+ 兼容）
#
# 用法：
#   .\start.ps1                    # 默认：启动桌面应用（npm run tauri dev）
#   .\start.ps1 -Mode web          # 浏览器开发模式（mock 后端）http://localhost:1420
#   .\start.ps1 -Mode export       # 无 GUI 导出：节点式演示项目 → MP4
#   .\start.ps1 -Mode export -Out D:\out\demo.mp4
#   .\start.ps1 -Mode verify       # 导出 + ffprobe 全项验收
#   .\start.ps1 -Mode test         # 运行 vitest + cargo test
#   .\start.ps1 -Mode help         # 显示本帮助

param(
    [ValidateSet("tauri", "web", "export", "verify", "test", "help")]
    [string]$Mode = "tauri",
    [string]$Out = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Info($msg) { Write-Host "[..] $msg" -ForegroundColor Cyan }
function Write-OK($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "[ERR] $msg" -ForegroundColor Red }

# ---------------------------------------------------------------- 环境检查
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
        $env:PATH = "$cargoBin;$env:PATH"
        Write-OK "cargo 已加入 PATH: $cargoBin"
    } else {
        Write-Err "未找到 cargo（Rust 工具链）。请先安装：https://rustup.rs"
        exit 1
    }
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Err "未找到 npm。请先安装 Node.js ≥ 20。"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Info "首次运行：安装 npm 依赖（可能需要几分钟）..."
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install 失败"; exit 1 }
    Write-OK "npm 依赖安装完成"
}

# ---------------------------------------------------------------- 各模式
switch ($Mode) {
    "tauri" {
        Write-Info "启动 StoryForge Studio 桌面应用（首次编译约 5-10 分钟，请耐心等待）..."
        & npm.cmd run tauri dev
        exit $LASTEXITCODE
    }

    "web" {
        Write-Info "浏览器开发模式（mock 后端）：http://localhost:1420"
        & npm.cmd run dev
        exit $LASTEXITCODE
    }

    "export" {
        if ([string]::IsNullOrWhiteSpace($Out)) {
            $Out = Join-Path $root "e2e\.tmp\storyforge-export.mp4"
        }
        $outDir = Split-Path -Parent $Out
        if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

        Write-Info "构建导出 CLI（sf_export）..."
        & cargo build --manifest-path "src-tauri\Cargo.toml" --bin sf_export
        if ($LASTEXITCODE -ne 0) { Write-Err "cargo build 失败"; exit 1 }

        Write-Info "离线渲染节点式演示项目 → $Out（1080p30，360 帧，约 10-20 分钟）..."
        & "src-tauri\target\debug\sf_export.exe" --demo --out $Out
        if ($LASTEXITCODE -ne 0) { Write-Err "导出失败"; exit 1 }
        Write-OK "导出完成：$Out"
        exit 0
    }

    "verify" {
        Write-Info "运行导出验收（演示项目 → MP4 → ffprobe/音频/字幕校验）..."
        & node.exe "scripts\verify-export.mjs"
        exit $LASTEXITCODE
    }

    "test" {
        Write-Info "vitest（TS 领域层）..."
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { Write-Err "vitest 失败"; exit 1 }
        Write-Info "cargo test（Rust 核心）..."
        & cargo test -p studio-core --manifest-path "src-tauri\Cargo.toml"
        if ($LASTEXITCODE -ne 0) { Write-Err "cargo test 失败"; exit 1 }
        Write-OK "全部测试通过"
        exit 0
    }

    "help" {
        Write-Host ""
        Write-Host "StoryForge Studio 启动脚本" -ForegroundColor White
        Write-Host "------------------------------"
        Write-Host "  .\start.ps1                    启动桌面应用（默认）"
        Write-Host "  .\start.ps1 -Mode web          浏览器开发模式 http://localhost:1420"
        Write-Host "  .\start.ps1 -Mode export       无 GUI 导出演示项目为 MP4"
        Write-Host "  .\start.ps1 -Mode export -Out D:\out\demo.mp4   指定输出路径"
        Write-Host "  .\start.ps1 -Mode verify       导出 + ffprobe 全项验收"
        Write-Host "  .\start.ps1 -Mode test         vitest + cargo test"
        Write-Host "  .\start.ps1 -Mode help         本帮助"
        Write-Host ""
        Write-Host "命令行直接导出（无需 GUI）："
        Write-Host "  src-tauri\target\debug\sf_export.exe --demo --out D:\out\demo.mp4"
        Write-Host "  src-tauri\target\debug\sf_export.exe --project <项目目录> --out D:\out\out.mp4"
        Write-Host ""
        exit 0
    }
}
