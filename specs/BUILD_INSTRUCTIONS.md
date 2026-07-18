# Build Instructions - Cowork GHC

## System Configuration

**Visual Studio Build Tools:** 2022  
**MSVC Location:** `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64`

## Building the Backend (Go)

```bash
.\scripts\build-backend.bat
```

**Output:** `app\backend\bin\m365-knowledge-graph.exe`

**Requirements:**
- Go 1.22+
- No additional setup needed

## Building the LLM Service (Rust)

### Option 1: Automatic Setup (Recommended)

```bash
.\scripts\build-llm-svc-auto.bat
```

This script will:
1. Check for cargo installation
2. Automatically find and configure MSVC environment
3. Build the LLM service with the correct toolchain

**Output:** `app\llm-svc\target\x86_64-pc-windows-msvc\release\llm-svc.exe`

### Option 2: Manual Environment Setup

If the automatic script fails, run:

```bash
.\scripts\setup-env-2022.bat
```

Then build:

```bash
cd app\llm-svc
cargo build --release --bin llm-svc --target x86_64-pc-windows-msvc
```

## Troubleshooting

### Issue: `cl.exe` not found

**Solution 1 - Run setup script:**
```bash
.\scripts\setup-env-2022.bat
```

**Solution 2 - Manual PATH setup:**
```cmd
set PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;%PATH%
```

### Issue: `ort-sys` build failure

**Ensure you're using MSVC toolchain:**
```bash
rustup target add x86_64-pc-windows-msvc
```

The build script already specifies `--target x86_64-pc-windows-msvc`, so this should work.

## Environment Details

**Rust Targets Configured:**
- `x86_64-pc-windows-msvc` (default for this project)

**Build Configuration:**
- Profile: Release (optimized)
- Target architecture: x86_64
- Windows MSVC toolchain

## Full Build

To build everything:

```bash
.\scripts\build-backend.bat
.\scripts\build-llm-svc-auto.bat
```

Or use any project-specific build orchestration script if available.
