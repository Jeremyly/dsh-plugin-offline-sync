# dsh-plugin-offline-sync

将本地 DSH 插件打包为便携 ZIP，并在其他机器上离线安装。即使目标机器没装过本插件也能用。

## 功能

1. **选择打包哪些插件** — 设置页里勾选。
2. **增量打包检测** — 自动对比上次打包的指纹（文件路径+大小+mtime），有更新的标记为「有更新」。
3. **目标机器版本检测** — 安装器逐个展示打包版本 vs 目标机器已安装版本，由用户决定是否更新。
4. **目标机器无本插件也能装** — 安装器是独立的 `install.cjs`，只依赖 Node 内置模块，不需要 DSH 运行时。

## 安装

```bash
dsh plugin add Jeremyly/dsh-plugin-offline-sync
```

## 打包流程

设置 → Plugins → 离线打包同步 → 勾选插件 → 打包选中 → 输出目录生成 `dsh-plugins-<时间戳>.zip`。

## 安装流程（目标机器）

```
unzip dsh-plugins-*.zip
cd <解压目录>
node install.cjs
```

安装器会：
- 定位 DSH profile（默认 `desktop`，可用 `--profile <name>` 或 `DSH_PROFILE_DIR` 覆盖）
- 逐个显示打包版本 vs 已安装版本
- 询问是否安装/覆盖
- 拷贝文件、更新 `package.json`、合并 `cordis.patch.yml`

重启 DSH 生效。

## 配置

在 `cordis.patch.yml` 里：

```yaml
- insert:
    - id: dsh-plugin-offline-sync
      name: 'dsh-plugin-offline-sync'
      config:
        profile: desktop
        outputDir: 'C:\\path\\to\\output'   # 可选，默认 <profile>/dsh-plugin-offline-sync-output
```

## License

MIT
